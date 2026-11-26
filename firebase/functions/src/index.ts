import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger, setGlobalOptions } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/scheduler";
import { processTrackers, type AlertMode, type TrackedDoc } from "./alerts.js";
import { fetchPage, FetchError, mapLimit } from "./http.js";
import { COMPARE_TTL_MS, refreshProduct, UnreadableProductError, type ProductDoc } from "./product.js";
import { BlockedError, storeById, type StoreId } from "./stores/index.js";
import { extractUrl, identify, type ProductRef } from "./url.js";

initializeApp();
setGlobalOptions({ region: "asia-south1", maxInstances: 10 });

const MIN_REFRESH_MS = 30 * 60 * 1000; // re-scrape at most every 30 min on user lookups

function requireUid(auth: { uid: string } | undefined): string {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return auth.uid;
}

function toHttpsError(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  if (e instanceof BlockedError) return new HttpsError("unavailable", `${e.message}. Please try again in a few minutes.`);
  if (e instanceof UnreadableProductError) return new HttpsError("failed-precondition", e.message);
  if (e instanceof FetchError) {
    if (e.message.startsWith("Unsupported store")) return new HttpsError("invalid-argument", "This store isn't supported yet.");
    if (e.status === 404) return new HttpsError("not-found", "That product page doesn't exist anymore.");
    return new HttpsError("unavailable", "Couldn't reach the store. Please try again.");
  }
  if (e instanceof Error && e.name === "TimeoutError") return new HttpsError("deadline-exceeded", "The store took too long to respond.");
  logger.error("Unexpected error", e);
  return new HttpsError("internal", "Something went wrong.");
}

/**
 * lookupProduct({ url | text, refresh? }) -> { productId }
 * Accepts a product link (or the whole share text), scrapes the product, records price history,
 * finds the same product at other stores and stores everything in products/{productId}.
 * The app then reads the product doc and its history subcollection directly.
 */
export const lookupProduct = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (req) => {
  requireUid(req.auth);
  const input = String(req.data?.url ?? req.data?.text ?? "").slice(0, 4000);
  const refresh = req.data?.refresh === true;
  const link = extractUrl(input);
  if (!link) throw new HttpsError("invalid-argument", "Paste a product link from Amazon, Flipkart, Myntra, Croma and similar stores.");

  try {
    let ref: ProductRef | null = identify(link);
    let prefetched;
    if (!ref) {
      // Short link (amzn.in/d/…, dl.flipkart.com/s/…) or unusual URL: follow redirects to the product page.
      prefetched = await fetchPage(link);
      ref = identify(prefetched.finalUrl);
      if (!ref) throw new HttpsError("invalid-argument", "That link doesn't look like a product page.");
    }

    const db = getFirestore();
    const existing = await db.collection("products").doc(ref.productId).get();
    if (existing.exists) {
      const p = existing.data() as ProductDoc;
      const age = Date.now() - p.lastChecked.toMillis();
      const comparisonsFresh = p.comparisonsUpdatedAt && Date.now() - p.comparisonsUpdatedAt.toMillis() < COMPARE_TTL_MS;
      if (!p.lastError && age < (refresh ? MIN_REFRESH_MS / 3 : MIN_REFRESH_MS) && comparisonsFresh) {
        return { productId: ref.productId, cached: true };
      }
    }

    const { before, after } = await refreshProduct(ref, { prefetched, comparisons: refresh ? "force" : "if-stale" });
    if (before && before.price !== after.price && after.trackerCount > 0) {
      await processTrackers(ref.productId, before, after);
    }
    return { productId: ref.productId, cached: false };
  } catch (e) {
    throw toHttpsError(e);
  }
});

/** trackProduct({ productId, targetPrice?, alertMode? }) — start (or update) watching a product. */
export const trackProduct = onCall(async (req) => {
  const uid = requireUid(req.auth);
  const productId = String(req.data?.productId ?? "");
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(productId)) throw new HttpsError("invalid-argument", "Bad productId");
  const target = req.data?.targetPrice;
  const targetPrice = target == null || target === "" ? null : Number(target);
  if (targetPrice != null && !(Number.isFinite(targetPrice) && targetPrice > 0)) throw new HttpsError("invalid-argument", "Target price must be a positive number.");
  const mode = String(req.data?.alertMode ?? "drop") as AlertMode;
  if (!["target_only", "drop", "any"].includes(mode)) throw new HttpsError("invalid-argument", "Bad alertMode");

  const db = getFirestore();
  const productRef = db.collection("products").doc(productId);
  const trackedRef = db.collection("users").doc(uid).collection("tracked").doc(productId);

  const perUserLimit = Number(process.env.MAX_TRACKED_PER_USER ?? 50);
  await db.runTransaction(async (tx) => {
    const [pSnap, tSnap] = await Promise.all([tx.get(productRef), tx.get(trackedRef)]);
    if (!pSnap.exists) throw new HttpsError("not-found", "Look up the product first.");
    if (!tSnap.exists) {
      const count = (await tx.get(db.collection("users").doc(uid).collection("tracked").count())).data().count;
      if (count >= perUserLimit) throw new HttpsError("resource-exhausted", `You can track up to ${perUserLimit} products.`);
    }
    const p = pSnap.data() as ProductDoc;
    const doc: Omit<TrackedDoc, "lastAlertAt"> & Record<string, unknown> = {
      productId,
      targetPrice,
      alertMode: mode,
      title: p.title,
      imageUrl: p.imageUrl,
      store: p.store,
      storeName: p.storeName,
      currentPrice: p.price,
      inStock: p.inStock,
      priceWhenAdded: tSnap.exists ? (tSnap.get("priceWhenAdded") ?? p.price) : p.price,
      lastAlertPrice: null, // reset so a new target can fire
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!tSnap.exists) {
      doc.createdAt = FieldValue.serverTimestamp();
      tx.update(productRef, { trackerCount: FieldValue.increment(1), tracked: true });
    }
    tx.set(trackedRef, doc, { merge: true });
  });
  return { ok: true };
});

/** untrackProduct({ productId }) */
export const untrackProduct = onCall(async (req) => {
  const uid = requireUid(req.auth);
  const productId = String(req.data?.productId ?? "");
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(productId)) throw new HttpsError("invalid-argument", "Bad productId");
  const db = getFirestore();
  const productRef = db.collection("products").doc(productId);
  const trackedRef = db.collection("users").doc(uid).collection("tracked").doc(productId);
  await db.runTransaction(async (tx) => {
    const [pSnap, tSnap] = await Promise.all([tx.get(productRef), tx.get(trackedRef)]);
    if (!tSnap.exists) return;
    tx.delete(trackedRef);
    if (pSnap.exists) {
      const remaining = Math.max(0, ((pSnap.get("trackerCount") as number) ?? 1) - 1);
      tx.update(productRef, { trackerCount: remaining, tracked: remaining > 0 });
    }
  });
  return { ok: true };
});

/**
 * Every few hours: re-check prices of all tracked products, record history,
 * refresh comparisons once a day, and push alerts to trackers.
 */
export const refreshTrackedPrices = onSchedule(
  {
    schedule: process.env.REFRESH_SCHEDULE ?? "every 6 hours",
    timeZone: "Asia/Kolkata",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
  },
  async () => {
    const db = getFirestore();
    const batchSize = Number(process.env.REFRESH_BATCH ?? 150);
    const snap = await db
      .collection("products")
      .where("tracked", "==", true)
      .orderBy("lastChecked", "asc")
      .limit(batchSize)
      .get();

    const started = Date.now();
    let ok = 0;
    let failed = 0;
    let alerts = 0;
    await mapLimit(snap.docs, 3, async (doc) => {
      if (Date.now() - started > 480_000) return; // leave headroom before the 540s timeout
      const p = doc.data() as ProductDoc;
      const store = storeById(p.store as StoreId);
      if (!store) return;
      const ref: ProductRef = { store, key: p.storeProductId, productId: doc.id, canonicalUrl: p.url };
      try {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500)); // be polite to stores
        const { before, after } = await refreshProduct(ref, { comparisons: "if-stale" });
        alerts += await processTrackers(doc.id, before, after);
        ok++;
      } catch (e) {
        failed++;
        logger.warn("Refresh failed", { productId: doc.id, error: String(e) });
      }
    });
    logger.info("Price refresh done", { checked: snap.size, ok, failed, alerts });
  },
);

/** Housekeeping: drop price-history points older than 2 years to keep storage small. */
export const pruneOldHistory = onSchedule({ schedule: "every sunday 03:00", timeZone: "Asia/Kolkata", timeoutSeconds: 300 }, async () => {
  const db = getFirestore();
  const cutoff = Timestamp.fromMillis(Date.now() - 730 * 24 * 60 * 60 * 1000);
  const old = await db.collectionGroup("history").where("at", "<", cutoff).limit(400).get();
  const batch = db.batch();
  old.docs.forEach((d) => batch.delete(d.ref));
  if (!old.empty) await batch.commit();
  logger.info("Pruned history points", { count: old.size });
});

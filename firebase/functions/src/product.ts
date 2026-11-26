import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { findComparisons, type Offer } from "./compare.js";
import { fetchKeepaHistory, shouldRecord, writePoints } from "./history.js";
import { fetchPageWithFallback, type Page } from "./http.js";
import type { ScrapedProduct } from "./stores/index.js";
import type { ProductRef } from "./url.js";

const HOUR = 60 * 60 * 1000;
export const COMPARE_TTL_MS = Number(process.env.COMPARE_REFRESH_HOURS ?? 24) * HOUR;

/** Shape of products/{productId} in Firestore. */
export interface ProductDoc {
  store: string;
  storeName: string;
  storeProductId: string;
  url: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  price: number | null;
  mrp: number | null;
  currency: string;
  inStock: boolean;
  rating: number | null;
  ratingCount: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  comparisons: Offer[];
  comparisonsUpdatedAt: Timestamp | null;
  lastChecked: Timestamp;
  lastPointAt: Timestamp | null;
  lastError: string | null;
  failures: number;
  trackerCount: number;
  tracked: boolean;
  createdAt: Timestamp;
}

export class UnreadableProductError extends Error {
  constructor(store: string) {
    super(`Couldn't read product details from ${store}. The page layout may have changed.`);
    this.name = "UnreadableProductError";
  }
}

export async function scrape(ref: ProductRef, prefetched?: Page): Promise<ScrapedProduct> {
  if (prefetched) {
    try {
      const parsed = ref.store.parseProduct(prefetched.html, prefetched.finalUrl);
      if (parsed?.price != null) return parsed;
    } catch {
      // Blocked or unparseable redirect target: fetch the canonical URL (with proxy fallback) below.
    }
  }
  const { result } = await fetchPageWithFallback(ref.canonicalUrl, (p) => ref.store.parseProduct(p.html, p.finalUrl));
  if (!result) throw new UnreadableProductError(ref.store.name);
  return result;
}

export interface RefreshResult {
  before: ProductDoc | null;
  after: ProductDoc;
}

/** Scrape a product, update its Firestore doc + price history, and (optionally) refresh comparisons. */
export async function refreshProduct(
  ref: ProductRef,
  opts: { prefetched?: Page; comparisons: "if-stale" | "force" | "skip" },
): Promise<RefreshResult> {
  const db = getFirestore();
  const docRef = db.collection("products").doc(ref.productId);
  const snap = await docRef.get();
  const before = snap.exists ? (snap.data() as ProductDoc) : null;
  const now = new Date();
  const nowTs = Timestamp.fromDate(now);

  let scraped: ScrapedProduct;
  try {
    scraped = await scrape(ref, opts.prefetched);
  } catch (e) {
    if (before) {
      await docRef.update({ lastChecked: nowTs, lastError: String((e as Error).message ?? e), failures: FieldValue.increment(1) });
    }
    throw e;
  }

  const price = scraped.price;
  const pricesSeen = [before?.lowestPrice, before?.highestPrice, price].filter((p): p is number => p != null);

  const after: ProductDoc = {
    store: ref.store.id,
    storeName: ref.store.name,
    storeProductId: ref.key,
    url: ref.canonicalUrl,
    title: scraped.title,
    brand: scraped.brand,
    imageUrl: scraped.imageUrl,
    price,
    mrp: scraped.mrp,
    currency: scraped.currency,
    inStock: scraped.inStock,
    rating: scraped.rating,
    ratingCount: scraped.ratingCount,
    lowestPrice: pricesSeen.length ? Math.min(...pricesSeen) : null,
    highestPrice: pricesSeen.length ? Math.max(...pricesSeen) : null,
    comparisons: before?.comparisons ?? [],
    comparisonsUpdatedAt: before?.comparisonsUpdatedAt ?? null,
    lastChecked: nowTs,
    lastPointAt: before?.lastPointAt ?? null,
    lastError: null,
    failures: 0,
    trackerCount: before?.trackerCount ?? 0,
    tracked: before?.tracked ?? false,
    createdAt: before?.createdAt ?? nowTs,
  };

  // Price history
  if (price != null && scraped.inStock && shouldRecord(before?.price, before?.lastPointAt?.toDate(), price, now)) {
    await docRef.collection("history").add({ price, at: nowTs, source: "scrape" });
    after.lastPointAt = nowTs;
  }

  // First time we see an Amazon product: optionally backfill a year of history from Keepa.
  if (!before && ref.store.id === "amazon") {
    const points = await fetchKeepaHistory(ref.key);
    if (points.length) {
      await writePoints(docRef, points);
      const all = [...points.map((p) => p.price), ...(price != null ? [price] : [])];
      after.lowestPrice = Math.min(...all);
      after.highestPrice = Math.max(...all);
    }
  }

  // Comparisons across stores
  const stale = !after.comparisonsUpdatedAt || now.getTime() - after.comparisonsUpdatedAt.toMillis() > COMPARE_TTL_MS;
  if (opts.comparisons === "force" || (opts.comparisons === "if-stale" && stale)) {
    try {
      after.comparisons = await findComparisons({ store: ref.store.id, title: scraped.title, brand: scraped.brand, price });
      after.comparisonsUpdatedAt = nowTs;
    } catch (e) {
      logger.warn("Comparison failed", { productId: ref.productId, error: String(e) });
    }
  }

  // trackerCount/tracked are owned by track/untrack transactions; don't overwrite them here.
  const { trackerCount, tracked, ...rest } = after;
  await docRef.set(before ? rest : after, { merge: true });
  return { before, after: { ...after, trackerCount, tracked } };
}

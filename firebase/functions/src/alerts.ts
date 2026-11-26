import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { formatInr } from "./price.js";
import type { ProductDoc } from "./product.js";

export type AlertMode = "target_only" | "drop" | "any";

/** Shape of users/{uid}/tracked/{productId}. */
export interface TrackedDoc {
  productId: string;
  targetPrice: number | null;
  alertMode: AlertMode;
  title: string;
  imageUrl: string | null;
  store: string;
  storeName: string;
  currentPrice: number | null;
  inStock: boolean;
  priceWhenAdded: number | null;
  lastAlertPrice: number | null;
  lastAlertAt: Timestamp | null;
}

export type AlertReason = "target" | "drop" | "rise" | "back_in_stock";

/** Pure decision: should this tracker be alerted about the change from `before` to `after`? */
export function alertReason(
  t: Pick<TrackedDoc, "targetPrice" | "alertMode" | "lastAlertPrice">,
  oldPrice: number | null,
  newPrice: number | null,
  wasInStock: boolean,
  inStock: boolean,
): AlertReason | null {
  if (!inStock || newPrice == null) return null;
  if (t.targetPrice != null && newPrice <= t.targetPrice && (t.lastAlertPrice == null || newPrice < t.lastAlertPrice)) {
    return "target";
  }
  if (!wasInStock && t.alertMode !== "target_only") return "back_in_stock";
  if (oldPrice == null || newPrice === oldPrice) return null;
  if (newPrice < oldPrice && t.alertMode !== "target_only") return "drop";
  if (newPrice > oldPrice && t.alertMode === "any") return "rise";
  return null;
}

export function alertText(reason: AlertReason, p: ProductDoc, oldPrice: number | null, target: number | null) {
  const now = formatInr(p.price!);
  const was = oldPrice != null ? ` (was ${formatInr(oldPrice)})` : "";
  const name = p.title.length > 60 ? p.title.slice(0, 57) + "…" : p.title;
  switch (reason) {
    case "target":
      return { title: `🎯 Target price hit: ${now}`, body: `${name} is now ${now} on ${p.storeName}${target != null ? `, at or below your target of ${formatInr(target)}` : ""}.` };
    case "drop":
      return { title: `📉 Price drop: ${now}${was}`, body: `${name} on ${p.storeName}` };
    case "rise":
      return { title: `📈 Price went up: ${now}${was}`, body: `${name} on ${p.storeName}` };
    case "back_in_stock":
      return { title: `✅ Back in stock at ${now}`, body: `${name} on ${p.storeName}` };
  }
}

const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/** Update every tracker of this product with the new price and send push alerts where due. */
export async function processTrackers(productId: string, before: ProductDoc | null, after: ProductDoc): Promise<number> {
  const db = getFirestore();
  const trackers = await db.collectionGroup("tracked").where("productId", "==", productId).get();
  if (trackers.empty) return 0;

  const oldPrice = before?.price ?? null;
  const wasInStock = before?.inStock ?? true;
  let sent = 0;

  for (const doc of trackers.docs) {
    const t = doc.data() as TrackedDoc;
    const uid = doc.ref.parent.parent!.id;
    const update: Record<string, unknown> = {
      currentPrice: after.price ?? t.currentPrice ?? null, // keep last known price while out of stock
      inStock: after.inStock,
      title: after.title,
      imageUrl: after.imageUrl,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const reason = alertReason(t, oldPrice, after.price, wasInStock, after.inStock);
    if (reason) {
      const ok = await sendToUser(uid, productId, alertText(reason, after, oldPrice, t.targetPrice), reason, after.price!);
      if (ok) {
        sent++;
        update.lastAlertPrice = after.price;
        update.lastAlertAt = FieldValue.serverTimestamp();
      }
    }
    await doc.ref.update(update);
  }
  return sent;
}

async function sendToUser(
  uid: string,
  productId: string,
  text: { title: string; body: string },
  reason: AlertReason,
  price: number,
): Promise<boolean> {
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const tokens = ((await userRef.get()).get("fcmTokens") as string[] | undefined) ?? [];
  if (tokens.length === 0) return false;

  // Data-only message so the app always builds the notification and can deep-link to the product.
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: { type: "price_alert", reason, productId, title: text.title, body: text.body, price: String(price) },
    android: { priority: "high", ttl: 24 * 60 * 60 * 1000 },
  });

  const dead = res.responses
    .map((r, i) => (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code) ? tokens[i] : null))
    .filter((t): t is string => t != null);
  if (dead.length) await userRef.update({ fcmTokens: FieldValue.arrayRemove(...dead) });
  if (res.failureCount) logger.info("Some alert sends failed", { uid, failures: res.failureCount, removed: dead.length });
  return res.successCount > 0;
}

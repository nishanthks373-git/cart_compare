import { getFirestore, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { fetchJson } from "./http.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether a new history point should be written: on every price change,
 * and at least once a day so the chart has a continuous line.
 */
export function shouldRecord(prevPrice: number | null | undefined, lastPointAt: Date | null | undefined, price: number, now: Date): boolean {
  if (prevPrice == null || !lastPointAt) return true;
  if (prevPrice !== price) return true;
  return now.getTime() - lastPointAt.getTime() >= 20 * 60 * 60 * 1000;
}

export interface Point {
  price: number;
  at: Date;
}

/** Keepa encodes time as minutes since 2011-01-01. */
export function keepaToDate(keepaMinutes: number): Date {
  return new Date((keepaMinutes + 21564000) * 60000);
}

/**
 * Turn a Keepa csv array [t0, p0, t1, p1, …] into one point per day (last price of the day).
 * Prices are in paise; -1 means "no offer" and is skipped.
 */
export function parseKeepaCsv(csv: number[] | null | undefined, sinceMs: number): Point[] {
  if (!csv || csv.length < 2) return [];
  const byDay = new Map<string, Point>();
  for (let i = 0; i + 1 < csv.length; i += 2) {
    const at = keepaToDate(csv[i]);
    const raw = csv[i + 1];
    if (raw <= 0 || at.getTime() < sinceMs) continue;
    byDay.set(at.toISOString().slice(0, 10), { price: raw / 100, at });
  }
  return [...byDay.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Optional: backfill up to a year of Amazon.in history from Keepa (needs KEEPA_API_KEY). */
export async function fetchKeepaHistory(asin: string): Promise<Point[]> {
  const key = process.env.KEEPA_API_KEY;
  if (!key) return [];
  try {
    // domain 10 = amazon.in
    const data = await fetchJson<{ products?: Array<{ csv?: (number[] | null)[] }> }>(
      `https://api.keepa.com/product?key=${encodeURIComponent(key)}&domain=10&asin=${encodeURIComponent(asin)}&history=1&days=365`,
      30000,
    );
    const csv = data.products?.[0]?.csv;
    const since = Date.now() - 365 * DAY_MS;
    // csv[1] = lowest NEW price (any seller), csv[0] = sold by Amazon itself.
    const points = parseKeepaCsv(csv?.[1], since);
    return points.length ? points : parseKeepaCsv(csv?.[0], since);
  } catch (e) {
    logger.warn("Keepa backfill failed", { asin, error: String(e) });
    return [];
  }
}

export async function writePoints(productRef: DocumentReference, points: Point[]): Promise<void> {
  const db = getFirestore();
  for (let i = 0; i < points.length; i += 400) {
    const batch = db.batch();
    for (const p of points.slice(i, i + 400)) {
      batch.set(productRef.collection("history").doc(), { price: p.price, at: Timestamp.fromDate(p.at), source: "keepa" });
    }
    await batch.commit();
  }
}

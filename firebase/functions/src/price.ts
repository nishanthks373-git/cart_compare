/** Helpers for turning messy price strings ("₹1,29,999.00", "Rs. 499") into numbers. */

export function parsePrice(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) && input > 0 ? round2(input) : null;
  const s = String(input).replace(/\s+/g, "");
  // Indian grouping (1,29,999) and western grouping (129,999) both work here.
  const m = s.match(/(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d{1,2})?/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, "") + (m[2] ?? ""));
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

export function parseCount(input: unknown): number | null {
  if (input == null) return null;
  const digits = String(input).replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseRating(input: unknown): number | null {
  if (input == null) return null;
  const m = String(input).match(/(\d(?:\.\d)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n >= 0 && n <= 5 ? n : null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatInr(n: number): string {
  return inr.format(n);
}

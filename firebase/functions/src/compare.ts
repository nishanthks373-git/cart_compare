import { logger } from "firebase-functions";
import { fetchJson, fetchPageWithFallback, mapLimit } from "./http.js";
import { STORES, storeById, storeIdForMerchant, type SearchResult, type StoreId } from "./stores/index.js";

export interface Offer {
  store: StoreId;
  storeName: string;
  title: string;
  price: number;
  url: string;
  imageUrl: string | null;
  matchScore: number;
}

interface Source {
  store: StoreId;
  title: string;
  brand: string | null;
  price: number | null;
}

const STOP = new Set([
  "with", "and", "for", "the", "of", "in", "a", "an", "to", "by", "on", "new", "latest", "edition",
  "pack", "combo", "free", "best", "online", "india", "buy", "&", "-", "|", "x",
]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/(\d+)\s*(gb|tb|mb|mah|w|hz|inch|in|cm|mm|kg|g|ml|l)\b/g, "$1$2") // "256 GB" -> "256gb"
    .replace(/[^a-z0-9.+\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((t) => t.length > 0 && !STOP.has(t));
}

/** Tokens that look like model numbers / specs: contain a digit. These matter most for matching. */
function specTokens(ts: string[]): string[] {
  return ts.filter((t) => /\d/.test(t));
}

const UNIT_RE = /^\d+(?:\.\d+)?(gb|tb|mb|mah|w|hz|inch|in|cm|mm|kg|g|ml|l)$/;
const VARIANT_WORDS = ["pro", "max", "plus", "ultra", "mini", "lite", "fe", "neo"];

function isModelToken(t: string): boolean {
  return t.length >= 4 && /\d/.test(t) && /[a-z]/.test(t) && !UNIT_RE.test(t);
}

/** 0..1 similarity between two product titles. */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const jaccard = common / (ta.size + tb.size - common);
  const overlap = common / Math.min(ta.size, tb.size);
  let score = 0.4 * jaccard + 0.6 * overlap;

  // If both titles mention specs (storage, model no.), they must agree on them.
  const sa = specTokens([...ta]);
  const sb = new Set(specTokens([...tb]));
  if (sa.length && sb.size) {
    const shared = sa.filter((t) => sb.has(t)).length;
    const conflict = shared === 0 ? 1 : 1 - shared / Math.min(sa.length, sb.size);
    score *= 1 - 0.6 * conflict;
  }

  // A shared model number (e.g. "wh-1000xm5", "sm-s921b") is strong evidence of the same product.
  const modelA = [...ta].filter(isModelToken);
  if (modelA.some((t) => tb.has(t))) score += 0.3 * (1 - score);

  // "iPhone 16" vs "iPhone 16 Pro": variant words on only one side mean a different product.
  for (const v of VARIANT_WORDS) {
    if (ta.has(v) !== tb.has(v)) score *= 0.5;
  }

  // Same unit on both sides but no value in common (128gb vs 256gb, 1.5l vs 2l): different variant.
  const units = (ts: Set<string>) => {
    const m = new Map<string, Set<string>>();
    for (const t of ts) {
      const u = t.match(UNIT_RE)?.[1];
      if (u) m.set(u, (m.get(u) ?? new Set()).add(t));
    }
    return m;
  };
  const ua = units(ta);
  const ub = units(tb);
  for (const [u, vals] of ua) {
    const other = ub.get(u);
    if (other && ![...vals].some((v) => other.has(v))) score *= 0.6;
  }
  return Math.round(score * 1000) / 1000;
}

/** Short search query from a long marketplace title. */
export function buildQuery(title: string, brand: string | null): string {
  const cleaned = title
    .replace(/\|.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").slice(0, 12).join(" ");
  if (brand && !words.toLowerCase().includes(brand.toLowerCase())) return `${brand} ${words}`;
  return words;
}

const MIN_SCORE = Number(process.env.MATCH_MIN_SCORE ?? 0.55);

function pickBest(source: Source, candidates: Array<Omit<Offer, "matchScore">>): Offer[] {
  const best = new Map<string, Offer>();
  for (const c of candidates) {
    if (c.store === source.store) continue;
    if (source.price != null && (c.price < source.price * 0.3 || c.price > source.price * 3)) continue;
    const score = similarity(source.title, c.title);
    if (score < MIN_SCORE) continue;
    const key = c.store === "other" ? `other:${c.storeName.toLowerCase()}` : c.store;
    const prev = best.get(key);
    if (!prev || score > prev.matchScore + 0.05 || (Math.abs(score - prev.matchScore) <= 0.05 && c.price < prev.price)) {
      best.set(key, { ...c, matchScore: score });
    }
  }
  return [...best.values()].sort((a, b) => a.price - b.price).slice(0, 12);
}

interface SerpShoppingResult {
  title?: string;
  source?: string;
  extracted_price?: number;
  link?: string;
  product_link?: string;
  thumbnail?: string;
}

async function viaSerpApi(query: string, key: string): Promise<Array<Omit<Offer, "matchScore">>> {
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: query,
    gl: "in",
    hl: "en",
    google_domain: "google.co.in",
    location: "India",
    api_key: key,
  });
  const data = await fetchJson<{ shopping_results?: SerpShoppingResult[] }>(`https://serpapi.com/search.json?${params}`, 30000);
  return (data.shopping_results ?? [])
    .filter((r) => r.title && r.source && typeof r.extracted_price === "number" && (r.link || r.product_link))
    .map((r) => {
      const store = storeIdForMerchant(r.source!);
      return {
        store,
        storeName: store === "other" ? r.source!.replace(/^from\s+/i, "") : storeById(store)!.name,
        title: r.title!,
        price: r.extracted_price!,
        url: (r.link ?? r.product_link)!,
        imageUrl: r.thumbnail ?? null,
      };
    });
}

async function viaDirectSearch(query: string, exclude: StoreId): Promise<Array<Omit<Offer, "matchScore">>> {
  const searchable = STORES.filter((s) => s.id !== exclude && s.searchUrl && s.parseSearch);
  const perStore = await mapLimit(searchable, 3, async (store) => {
    try {
      const { result } = await fetchPageWithFallback<SearchResult[]>(store.searchUrl!(query), (p) => store.parseSearch!(p.html));
      return result.map((r) => ({ ...r, store: store.id, storeName: store.name }));
    } catch (e) {
      logger.warn(`Search failed on ${store.name}`, { error: String(e) });
      return [];
    }
  });
  return perStore.flat();
}

/**
 * Find the same product at other stores.
 * Uses SerpApi Google Shopping (all Indian merchants) when SERPAPI_KEY is set,
 * otherwise searches Amazon and Flipkart directly.
 */
export async function findComparisons(source: Source): Promise<Offer[]> {
  const query = buildQuery(source.title, source.brand);
  const key = process.env.SERPAPI_KEY;
  let candidates: Array<Omit<Offer, "matchScore">> = [];
  if (key) {
    try {
      candidates = await viaSerpApi(query, key);
    } catch (e) {
      logger.warn("SerpApi failed, falling back to direct search", { error: String(e) });
    }
  }
  if (candidates.length === 0) candidates = await viaDirectSearch(query, source.store);
  return pickBest(source, candidates);
}

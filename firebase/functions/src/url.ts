import { storeForHost, type StoreAdapter } from "./stores/index.js";

/** Share text from shopping apps looks like "Check out this … https://amzn.in/d/abc". Pull out the link. */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (m) return m[0].replace(/[.,;:!?)\]}'"]+$/, "");
  // Bare domains without a scheme, e.g. "www.flipkart.com/…"
  const bare = text.match(/\b(?:www\.|m\.)?(?:amazon\.in|flipkart\.com|myntra\.com|croma\.com|reliancedigital\.in|tatacliq\.com|vijaysales\.com|jiomart\.com|ajio\.com|nykaa\.com|amzn\.in|amzn\.to)\/[^\s<>"'`]*/i);
  return bare ? "https://" + bare[0].replace(/[.,;:!?)\]}'"]+$/, "") : null;
}

export interface ProductRef {
  store: StoreAdapter;
  key: string;
  productId: string;
  canonicalUrl: string;
}

/** Identify store + product from a (resolved) product URL. Returns null for short links / non-product pages. */
export function identify(rawUrl: string): ProductRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  // dl.flipkart.com is both a short-link host and a product host, so try the store first.
  const store = storeForHost(url.hostname);
  if (!store) return null;
  const key = store.productKey(url);
  if (!key) return null;
  return {
    store,
    key,
    productId: `${store.id}_${key}`.replace(/[^A-Za-z0-9_-]/g, "_"),
    canonicalUrl: store.canonicalUrl(url, key),
  };
}

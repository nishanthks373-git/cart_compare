import { parsePrice, parseRating } from "../price.js";
import { parseStructured } from "./generic.js";
import type { ScrapedProduct, StoreAdapter } from "./types.js";

/** Myntra renders product pages from a `window.__myx = {...}` state object. */
function readMyx(html: string): Record<string, any> | null {
  const start = html.indexOf("window.__myx");
  if (start < 0) return null;
  const braceStart = html.indexOf("{", start);
  if (braceStart < 0) return null;
  // Walk to the matching closing brace (strings may contain braces, so track quotes).
  let depth = 0;
  let inStr = false;
  for (let i = braceStart; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(braceStart, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export const myntra: StoreAdapter = {
  id: "myntra",
  name: "Myntra",
  domains: ["myntra.com"],

  productKey(url) {
    const m = url.pathname.match(/\/(\d{6,10})(?:\/|$)/);
    return m ? m[1] : null;
  },

  canonicalUrl(_url, key) {
    return `https://www.myntra.com/${key}`;
  },

  parseProduct(html): ScrapedProduct | null {
    const pdp = readMyx(html)?.pdpData;
    if (pdp?.name) {
      const price = parsePrice(pdp.price?.discounted ?? pdp.price?.mrp);
      const mrp = parsePrice(pdp.price?.mrp);
      const image =
        pdp.media?.albums?.[0]?.images?.[0]?.imageURL ?? pdp.media?.albums?.[0]?.images?.[0]?.src ?? null;
      return {
        title: String(pdp.name),
        price,
        mrp: mrp != null && price != null && mrp > price ? mrp : null,
        currency: "INR",
        imageUrl: image ? String(image).replace(/^http:/, "https:") : null,
        brand: pdp.brand?.name ?? null,
        rating: parseRating(pdp.ratings?.averageRating),
        ratingCount: typeof pdp.ratings?.totalCount === "number" ? pdp.ratings.totalCount : null,
        inStock: price != null && pdp.flags?.outOfStock !== true,
      };
    }
    return parseStructured(html);
  },
};

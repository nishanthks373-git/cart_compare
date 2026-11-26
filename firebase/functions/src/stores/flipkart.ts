import * as cheerio from "cheerio";
import { parseCount, parsePrice, parseRating } from "../price.js";
import { cleanTitle, parseStructured } from "./generic.js";
import { BlockedError, type ScrapedProduct, type SearchResult, type StoreAdapter } from "./types.js";

function isFlipkartBlocked(html: string, $: ReturnType<typeof cheerio.load>): boolean {
  const title = $("title").text();
  return /Site Maintenance|Are you a human|Access Denied/i.test(title) || html.includes("recaptcha/api.js?render");
}

/** First number after a JSON key like  "finalPrice":{"value":54999  inside Flipkart's page state. */
function stateValue(html: string, key: string): number | null {
  const re = new RegExp(`"${key}"\\s*:\\s*\\{[^{}]{0,200}?"value"\\s*:\\s*(\\d+(?:\\.\\d+)?)`);
  const m = html.match(re);
  return m ? parsePrice(m[1]) : null;
}

export const flipkart: StoreAdapter = {
  id: "flipkart",
  name: "Flipkart",
  domains: ["flipkart.com"],

  productKey(url) {
    const pid = url.searchParams.get("pid");
    if (pid && /^[A-Z0-9]{8,20}$/i.test(pid)) return pid.toUpperCase();
    const itm = url.pathname.match(/\/p\/(itm[a-z0-9]+)/i);
    return itm ? itm[1].toLowerCase() : null;
  },

  canonicalUrl(url) {
    const pid = url.searchParams.get("pid");
    return `https://www.flipkart.com${url.pathname}${pid ? `?pid=${encodeURIComponent(pid)}` : ""}`;
  },

  parseProduct(html): ScrapedProduct | null {
    const $ = cheerio.load(html);
    if (isFlipkartBlocked(html, $)) throw new BlockedError("Flipkart");
    const structured = parseStructured(html);

    const h1 = $("h1").first().text().replace(/\s+/g, " ").trim();
    const title = structured?.title || cleanTitle(h1) || null;
    if (!title) return null;

    const price = structured?.price ?? stateValue(html, "finalPrice") ?? stateValue(html, "fsp");
    let mrp = structured?.mrp ?? stateValue(html, "mrp");
    if (mrp != null && price != null && mrp <= price) mrp = null;

    // Prefer structured availability; the page text also contains "Sold Out" for recommended items.
    const soldOut =
      structured?.price != null
        ? structured.inStock === false
        : /\b(?:Sold Out|Currently Unavailable)\b/i.test($("h1").parent().parent().text());

    return {
      title,
      price,
      mrp,
      currency: "INR",
      imageUrl: structured?.imageUrl ?? $('meta[property="og:image"]').attr("content") ?? null,
      brand: structured?.brand ?? null,
      rating: structured?.rating ?? parseRating(html.match(/"averageRating"\s*:\s*([\d.]+)/)?.[1]),
      ratingCount: structured?.ratingCount ?? parseCount(html.match(/"ratingCount"\s*:\s*(\d+)/)?.[1]),
      inStock: price != null && !soldOut,
    };
  },

  searchUrl(q) {
    return `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`;
  },

  parseSearch(html): SearchResult[] {
    const $ = cheerio.load(html);
    if (isFlipkartBlocked(html, $)) throw new BlockedError("Flipkart");
    const out: SearchResult[] = [];
    const seen = new Set<string>();
    // Flipkart class names are obfuscated and change often, so rely on stable bits:
    // result cards carry data-id (the pid) and link to /p/itm… pages.
    $("[data-id]").each((_, el) => {
      const card = $(el);
      const link = card.find('a[href*="/p/itm"]').first();
      const href = link.attr("href");
      if (!href) return;
      const url = new URL(href, "https://www.flipkart.com");
      const key = url.searchParams.get("pid") ?? url.pathname;
      if (seen.has(key)) return;
      const title =
        card.find("a[title]").first().attr("title") ||
        card.find("img[alt]").first().attr("alt") ||
        link.text().trim();
      const prices = (card.text().match(/₹\s?[\d,]+/g) ?? []).map((p) => parsePrice(p)).filter((p): p is number => p != null);
      if (!title || prices.length === 0) return;
      seen.add(key);
      out.push({
        title: title.replace(/\s+/g, " ").trim(),
        price: prices[0],
        url: flipkart.canonicalUrl(url, key),
        imageUrl: card.find("img").first().attr("src") ?? null,
      });
    });
    return out.slice(0, 15);
  },
};

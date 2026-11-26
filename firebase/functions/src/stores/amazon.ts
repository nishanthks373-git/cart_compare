import * as cheerio from "cheerio";
import { parseCount, parsePrice, parseRating } from "../price.js";
import { BlockedError, type ScrapedProduct, type SearchResult, type StoreAdapter } from "./types.js";

const ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN|o\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i;

export function isAmazonBlocked(html: string): boolean {
  return (
    html.includes("/errors/validateCaptcha") ||
    html.includes("Type the characters you see in this image") ||
    html.includes("api-services-support@amazon.com")
  );
}

function firstPrice($: ReturnType<typeof cheerio.load>, selectors: string[]): number | null {
  for (const sel of selectors) {
    for (const el of $(sel).toArray()) {
      const p = parsePrice($(el).text());
      if (p != null) return p;
    }
  }
  return null;
}

export const amazon: StoreAdapter = {
  id: "amazon",
  name: "Amazon",
  domains: ["amazon.in"],

  productKey(url) {
    const m = url.pathname.match(ASIN_RE);
    return m ? m[1].toUpperCase() : null;
  },

  canonicalUrl(_url, key) {
    return `https://www.amazon.in/dp/${key}`;
  },

  parseProduct(html): ScrapedProduct | null {
    if (isAmazonBlocked(html)) throw new BlockedError("Amazon");
    const $ = cheerio.load(html);
    const title = $("#productTitle").first().text().replace(/\s+/g, " ").trim() || $("#title").text().trim();
    if (!title) return null;

    const core = "#corePriceDisplay_desktop_feature_div, #corePrice_feature_div, #corePrice_desktop, #apex_desktop, #corePriceDisplay_mobile_feature_div, #corePrice_mobile_feature_div";
    let price = firstPrice($, [
      `#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen`,
      `#corePriceDisplay_desktop_feature_div .priceToPay .aok-offscreen`,
      `.priceToPay .a-offscreen`,
      `.priceToPay .aok-offscreen`,
      `#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen`,
      `#apex_desktop .a-price:not(.a-text-price) .a-offscreen`,
      `#priceblock_dealprice`,
      `#priceblock_ourprice`,
      `#tp_price_block_total_price_ww .a-offscreen`,
    ]);
    if (price == null) {
      const whole = $(`${core}`).find(".a-price-whole").first().text();
      const frac = $(`${core}`).find(".a-price-fraction").first().text();
      price = parsePrice(whole ? `${whole.replace(/[.,]$/, "")}.${frac || "00"}` : null);
    }

    const mrp = firstPrice($, [
      `#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen`,
      `.basisPrice .a-offscreen`,
      `#corePrice_feature_div .a-text-price .a-offscreen`,
      `.a-price.a-text-price[data-a-strike="true"] .a-offscreen`,
      `#priceblock_listprice`,
    ]);

    const img = $("#landingImage, #imgBlkFront, #main-image").first();
    let imageUrl = img.attr("data-old-hires") || null;
    if (!imageUrl) {
      const dyn = img.attr("data-a-dynamic-image");
      if (dyn) {
        try {
          const sizes = JSON.parse(dyn) as Record<string, [number, number]>;
          imageUrl = Object.entries(sizes).sort((a, b) => b[1][0] - a[1][0])[0]?.[0] ?? null;
        } catch {
          /* ignore */
        }
      }
    }
    imageUrl ||= img.attr("src") || $('meta[property="og:image"]').attr("content") || null;

    const byline = $("#bylineInfo").first().text().trim();
    const brand =
      byline
        .replace(/^Visit the\s+/i, "")
        .replace(/\s+Store$/i, "")
        .replace(/^Brand:\s*/i, "")
        .trim() || null;

    const rating =
      parseRating($("#acrPopover").attr("title")) ?? parseRating($("#averageCustomerReviews .a-icon-alt").first().text());
    const ratingCount = parseCount($("#acrCustomerReviewText").first().text());

    const availability = $("#availability").text().toLowerCase();
    const unavailable = /currently unavailable|out of stock|not available/.test(availability);

    return {
      title,
      price,
      mrp: mrp != null && price != null && mrp > price ? mrp : null,
      currency: "INR",
      imageUrl,
      brand,
      rating,
      ratingCount,
      inStock: price != null && !unavailable,
    };
  },

  searchUrl(q) {
    return `https://www.amazon.in/s?k=${encodeURIComponent(q)}`;
  },

  parseSearch(html): SearchResult[] {
    if (isAmazonBlocked(html)) throw new BlockedError("Amazon");
    const $ = cheerio.load(html);
    const out: SearchResult[] = [];
    $('div[data-component-type="s-search-result"][data-asin]').each((_, el) => {
      const card = $(el);
      const asin = card.attr("data-asin");
      if (!asin || asin.length !== 10) return;
      const h2 = card.find("h2").first();
      const title = (h2.attr("aria-label") || h2.text()).replace(/^Sponsored Ad\s*[-–]\s*/i, "").replace(/\s+/g, " ").trim();
      const price = parsePrice(card.find(".a-price:not(.a-text-price) .a-offscreen").first().text());
      if (!title || price == null) return;
      out.push({
        title,
        price,
        url: `https://www.amazon.in/dp/${asin}`,
        imageUrl: card.find("img.s-image").attr("src") ?? null,
      });
    });
    return out.slice(0, 15);
  },
};

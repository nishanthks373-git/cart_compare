import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { parseCount, parsePrice, parseRating } from "../price.js";
import type { ScrapedProduct, StoreAdapter, StoreId } from "./types.js";

type CheerioAPI = ReturnType<typeof cheerio.load>;
type Json = Record<string, unknown>;

/** Collect every schema.org Product object from JSON-LD blocks on the page. */
export function jsonLdProducts($: CheerioAPI): Json[] {
  const found: Json[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as Json;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && /^(Product|ProductGroup|IndividualProduct)$/i.test(t))) {
      found.push(obj);
    }
    if (obj["@graph"]) visit(obj["@graph"]);
    if (obj["mainEntity"]) visit(obj["mainEntity"]);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      visit(JSON.parse(raw));
    } catch {
      // Some sites put several objects or stray characters in one block.
      try {
        visit(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " ").replace(/;\s*$/, "")));
      } catch {
        /* ignore unparseable block */
      }
    }
  });
  return found;
}

function firstString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) return firstString(v[0]);
  if (typeof v === "object") {
    const o = v as Json;
    return firstString(o.url ?? o.contentUrl ?? o.name ?? null);
  }
  return null;
}

function offerInfo(offers: unknown): { price: number | null; mrp: number | null; currency: string | null; inStock: boolean | null } {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  let best: number | null = null;
  let mrp: number | null = null;
  let currency: string | null = null;
  let inStock: boolean | null = null;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Json;
    const p = parsePrice(o.price ?? o.lowPrice ?? (o.priceSpecification as Json | undefined)?.price);
    if (p != null && (best == null || p < best)) best = p;
    // Note: AggregateOffer.highPrice is the priciest seller, not the MRP, so it is ignored.
    const spec = o.priceSpecification;
    const specs = Array.isArray(spec) ? spec : spec ? [spec] : [];
    for (const s of specs as Json[]) {
      const type = String(s?.priceType ?? "");
      if (/ListPrice|StrikethroughPrice|MSRP/i.test(type)) mrp = parsePrice(s.price) ?? mrp;
    }
    currency = (o.priceCurrency as string) ?? currency;
    const avail = String(o.availability ?? "");
    if (avail) {
      const ok = /InStock|LimitedAvailability|PreOrder|OnlineOnly/i.test(avail);
      inStock = inStock === true ? true : ok;
    }
    if (o.offers) {
      const nested = offerInfo(o.offers);
      if (nested.price != null && (best == null || nested.price < best)) best = nested.price;
      inStock = inStock ?? nested.inStock;
    }
  }
  return { price: best, mrp, currency, inStock };
}

/** Extract product data from structured markup: JSON-LD, then OpenGraph/meta, then microdata. */
export function parseStructured(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);
  const meta = (name: string) =>
    $(`meta[property="${name}"]`).attr("content")?.trim() || $(`meta[name="${name}"]`).attr("content")?.trim() || null;

  let title: string | null = null;
  let price: number | null = null;
  let mrp: number | null = null;
  let currency: string | null = null;
  let imageUrl: string | null = null;
  let brand: string | null = null;
  let rating: number | null = null;
  let ratingCount: number | null = null;
  let inStock: boolean | null = null;

  for (const p of jsonLdProducts($)) {
    title ??= firstString(p.name);
    imageUrl ??= firstString(p.image);
    brand ??= firstString(p.brand);
    const offers = offerInfo(p.offers);
    if (price == null && offers.price != null) {
      price = offers.price;
      mrp = offers.mrp;
      currency = offers.currency;
      inStock = offers.inStock;
    }
    const agg = p.aggregateRating as Json | undefined;
    if (agg && rating == null) {
      rating = parseRating(agg.ratingValue);
      ratingCount = parseCount(agg.ratingCount ?? agg.reviewCount);
    }
  }

  title ??= meta("og:title") ?? ($("title").first().text().trim() || null);
  imageUrl ??= meta("og:image");
  price ??= parsePrice(meta("product:price:amount") ?? meta("og:price:amount"));
  currency ??= meta("product:price:currency") ?? meta("og:price:currency");
  if (price == null) {
    const el = $('[itemprop="price"]').first();
    price = parsePrice(el.attr("content") ?? el.text());
  }
  if (inStock == null) {
    const avail = meta("product:availability") ?? $('[itemprop="availability"]').attr("href") ?? $('[itemprop="availability"]').attr("content");
    if (avail) inStock = !/out.?of.?stock|sold.?out|discontinued/i.test(avail);
  }

  if (!title) return null;
  return {
    title: cleanTitle(title),
    price,
    mrp: mrp != null && price != null && mrp > price ? mrp : null,
    currency: currency || "INR",
    imageUrl: absolutize(imageUrl),
    brand,
    rating,
    ratingCount,
    inStock: inStock ?? price != null,
  };
}

export function cleanTitle(t: string): string {
  return t
    .replace(/\s+/g, " ")
    .replace(/\s*[-|:]\s*(Buy .*Online.*|.*Online at Best Prices? in India.*|.*\| ?Flipkart\.com|Croma.*|Reliance Digital.*)$/i, "")
    .trim();
}

function absolutize(u: string | null): string | null {
  if (!u) return null;
  if (u.startsWith("//")) return "https:" + u;
  return u;
}

export function hashKey(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

/** Adapter for stores that publish good structured data (Croma, Reliance Digital, Tata CLiQ, …). */
export function genericAdapter(id: StoreId, name: string, domains: string[]): StoreAdapter {
  return {
    id,
    name,
    domains,
    productKey(url) {
      const path = url.pathname.replace(/\/+$/, "");
      if (path.length < 3) return null;
      return hashKey(url.hostname.replace(/^www\./, "") + path.toLowerCase());
    },
    canonicalUrl(url) {
      return `${url.protocol}//${url.hostname}${url.pathname}`;
    },
    parseProduct(html) {
      return parseStructured(html);
    },
  };
}

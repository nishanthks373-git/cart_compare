import assert from "node:assert/strict";
import { test } from "node:test";
import { alertReason } from "../alerts.js";
import { buildQuery, similarity } from "../compare.js";
import { keepaToDate, parseKeepaCsv, shouldRecord } from "../history.js";
import { formatInr, parsePrice } from "../price.js";
import { amazon } from "../stores/amazon.js";
import { flipkart } from "../stores/flipkart.js";
import { parseStructured } from "../stores/generic.js";
import { isAllowedHost, storeIdForMerchant } from "../stores/index.js";
import { myntra } from "../stores/myntra.js";
import { BlockedError } from "../stores/types.js";
import { extractUrl, identify } from "../url.js";

test("parsePrice handles Indian formats", () => {
  assert.equal(parsePrice("₹1,29,999.00"), 129999);
  assert.equal(parsePrice("Rs. 499"), 499);
  assert.equal(parsePrice("₹ 54,999"), 54999);
  assert.equal(parsePrice("1299.5"), 1299.5);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice(0), null);
  assert.equal(formatInr(129999).replace(/\s/g, ""), "₹1,29,999");
});

test("extractUrl pulls links out of share text", () => {
  assert.equal(
    extractUrl("Check out this product on Amazon: Apple iPhone 16 (128 GB) https://amzn.in/d/aBc12Xy."),
    "https://amzn.in/d/aBc12Xy",
  );
  assert.equal(extractUrl("www.flipkart.com/apple-iphone/p/itm123?pid=MOB1"), "https://www.flipkart.com/apple-iphone/p/itm123?pid=MOB1");
  assert.equal(extractUrl("no link here"), null);
});

test("identify recognises store product URLs", () => {
  const a = identify("https://www.amazon.in/Apple-iPhone-16-128-GB/dp/B0DGJ65N7V/ref=sr_1_1?tag=x&th=1");
  assert.equal(a?.productId, "amazon_B0DGJ65N7V");
  assert.equal(a?.canonicalUrl, "https://www.amazon.in/dp/B0DGJ65N7V");
  assert.equal(identify("https://www.amazon.in/gp/product/B0DGJ65N7V")?.key, "B0DGJ65N7V");
  assert.equal(identify("https://amazon.in/s?k=iphone"), null);

  const f = identify("https://www.flipkart.com/apple-iphone-16-black-128-gb/p/itm7c0281cd247be?pid=MOBH4DQFG8NKFRDY&lid=LST&marketplace=FLIPKART");
  assert.equal(f?.productId, "flipkart_MOBH4DQFG8NKFRDY");
  assert.equal(f?.canonicalUrl, "https://www.flipkart.com/apple-iphone-16-black-128-gb/p/itm7c0281cd247be?pid=MOBH4DQFG8NKFRDY");
  assert.equal(identify("https://dl.flipkart.com/dl/apple-iphone/p/itmabc123?pid=MOBX1234ABCD")?.store.id, "flipkart");
  assert.equal(identify("https://dl.flipkart.com/s/abcdEFuuuN"), null); // short link -> resolve first

  assert.equal(identify("https://www.myntra.com/tshirts/roadster/roadster-men-black-t-shirt/1234567/buy")?.productId, "myntra_1234567");
  assert.ok(identify("https://www.croma.com/apple-iphone-16-128gb-black-/p/309688")?.productId.startsWith("croma_"));
  assert.equal(identify("https://example.com/p/1"), null);
});

test("host allowlist blocks non-store hosts", () => {
  assert.ok(isAllowedHost("www.amazon.in"));
  assert.ok(isAllowedHost("amzn.in"));
  assert.ok(isAllowedHost("dl.flipkart.com"));
  assert.ok(!isAllowedHost("metadata.google.internal"));
  assert.ok(!isAllowedHost("amazon.in.evil.com"));
  assert.ok(!isAllowedHost("169.254.169.254"));
});

const AMAZON_HTML = `<html><body>
<span id="productTitle">  Apple iPhone 16 (128 GB) - Black  </span>
<a id="bylineInfo">Visit the Apple Store</a>
<span id="acrPopover" title="4.5 out of 5 stars"></span>
<span id="acrCustomerReviewText">2,345 ratings</span>
<div id="corePriceDisplay_desktop_feature_div">
  <span class="a-price priceToPay"><span class="a-offscreen">₹69,900.00</span><span class="a-price-whole">69,900</span></span>
  <span class="basisPrice"><span class="a-price a-text-price"><span class="a-offscreen">₹79,900.00</span></span></span>
</div>
<img id="landingImage" data-a-dynamic-image='{"https://m.media-amazon.com/small.jpg":[200,200],"https://m.media-amazon.com/big.jpg":[1500,1500]}' src="https://m.media-amazon.com/src.jpg"/>
<div id="availability"><span>In stock</span></div>
</body></html>`;

test("Amazon product page parsing", () => {
  const p = amazon.parseProduct(AMAZON_HTML, "https://www.amazon.in/dp/B0DGJ65N7V")!;
  assert.equal(p.title, "Apple iPhone 16 (128 GB) - Black");
  assert.equal(p.price, 69900);
  assert.equal(p.mrp, 79900);
  assert.equal(p.brand, "Apple");
  assert.equal(p.rating, 4.5);
  assert.equal(p.ratingCount, 2345);
  assert.equal(p.imageUrl, "https://m.media-amazon.com/big.jpg");
  assert.equal(p.inStock, true);
});

test("Amazon price falls back to whole+fraction and detects captcha", () => {
  const html = `<span id="productTitle">Thing</span><div id="corePrice_feature_div"><span class="a-price-whole">1,299.</span><span class="a-price-fraction">00</span></div>
  <div id="availability">Currently unavailable.</div>`;
  const p = amazon.parseProduct(html, "")!;
  assert.equal(p.price, 1299);
  assert.equal(p.inStock, false);
  assert.throws(() => amazon.parseProduct(`<form action="/errors/validateCaptcha"></form>`, ""), BlockedError);
});

test("Amazon search parsing", () => {
  const html = `<div data-component-type="s-search-result" data-asin="B0DGJ65N7V">
    <h2 aria-label="Apple iPhone 16 (128 GB) - Black"><span>Apple iPhone 16</span></h2>
    <span class="a-price"><span class="a-offscreen">₹69,900</span></span><img class="s-image" src="https://img/1.jpg"/></div>
    <div data-component-type="s-search-result" data-asin=""></div>`;
  const r = amazon.parseSearch!(html);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { title: "Apple iPhone 16 (128 GB) - Black", price: 69900, url: "https://www.amazon.in/dp/B0DGJ65N7V", imageUrl: "https://img/1.jpg" });
});

test("Flipkart parsing from JSON-LD with MRP from page state", () => {
  const html = `<html><head><title>Apple iPhone 16 ( 128 GB Storage ) Online at Best Price On Flipkart.com</title>
  <script id="jsonLD" type="application/ld+json">[{"@context":"https://schema.org","@type":"Product","name":"Apple iPhone 16 (Black, 128 GB)","image":"https://rukminim2.flixcart.com/x.jpeg","brand":{"@type":"Brand","name":"Apple"},"offers":{"@type":"Offer","price":66999,"priceCurrency":"INR","availability":"http://schema.org/InStock"},"aggregateRating":{"@type":"AggregateRating","ratingValue":4.6,"reviewCount":1200,"ratingCount":25000}}]</script>
  </head><body><h1>Apple iPhone 16 (Black, 128 GB)</h1><script>window.__INITIAL_STATE__={"pricing":{"mrp":{"value":79900,"currency":"INR"},"finalPrice":{"value":66999}}}</script></body></html>`;
  const p = flipkart.parseProduct(html, "")!;
  assert.equal(p.title, "Apple iPhone 16 (Black, 128 GB)");
  assert.equal(p.price, 66999);
  assert.equal(p.mrp, 79900);
  assert.equal(p.brand, "Apple");
  assert.equal(p.rating, 4.6);
  assert.equal(p.ratingCount, 25000);
  assert.equal(p.inStock, true);
});

test("Flipkart search parsing", () => {
  const html = `<div data-id="MOBH4DQFG8NKFRDY"><a href="/apple-iphone-16-black-128-gb/p/itm7c0281cd247be?pid=MOBH4DQFG8NKFRDY&lid=x"><img alt="Apple iPhone 16 (Black, 128 GB)" src="https://img/f.jpg"/><div>Apple iPhone 16 (Black, 128 GB)</div><div>₹66,999</div><div>₹79,900</div></a></div>`;
  const r = flipkart.parseSearch!(html);
  assert.equal(r.length, 1);
  assert.equal(r[0].price, 66999);
  assert.equal(r[0].url, "https://www.flipkart.com/apple-iphone-16-black-128-gb/p/itm7c0281cd247be?pid=MOBH4DQFG8NKFRDY");
});

test("Myntra __myx parsing", () => {
  const html = `<script>window.__myx = {"pdpData":{"name":"Roadster Men Black T-shirt {Cotton}","brand":{"name":"Roadster"},"price":{"mrp":999,"discounted":449},"media":{"albums":[{"images":[{"imageURL":"http://assets.myntassets.com/a.jpg"}]}]},"ratings":{"averageRating":4.2,"totalCount":5321},"flags":{"outOfStock":false}}};</script>`;
  const p = myntra.parseProduct(html, "")!;
  assert.equal(p.title, "Roadster Men Black T-shirt {Cotton}");
  assert.equal(p.price, 449);
  assert.equal(p.mrp, 999);
  assert.equal(p.imageUrl, "https://assets.myntassets.com/a.jpg");
  assert.equal(p.rating, 4.2);
});

test("Generic structured parsing (@graph + AggregateOffer + OutOfStock)", () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":"Product","name":"Sony WH-1000XM5 Wireless Headphones","image":["https://img/s.jpg"],"brand":"Sony","offers":{"@type":"AggregateOffer","lowPrice":"26,990","highPrice":"29990","priceCurrency":"INR","availability":"https://schema.org/OutOfStock"}}]}</script>`;
  const p = parseStructured(html)!;
  assert.equal(p.title, "Sony WH-1000XM5 Wireless Headphones");
  assert.equal(p.price, 26990);
  assert.equal(p.mrp, null);
  assert.equal(p.inStock, false);
  assert.equal(p.brand, "Sony");
});

test("title similarity matches same product and rejects variants", () => {
  const src = "Apple iPhone 16 (128 GB) - Black";
  assert.ok(similarity(src, "Apple iPhone 16 (Black, 128 GB)") > 0.8);
  assert.ok(similarity(src, "Apple iPhone 16 Pro (256 GB) - Black Titanium") < 0.55);
  assert.ok(similarity(src, "Silicone case for iPhone 16") < 0.55);
  assert.ok(similarity(src, "Apple iPhone 16 Plus (128 GB) - Black") < 0.55);
  assert.ok(similarity(src, "Apple iPhone 16 (256 GB) - Black") < 0.55);
  assert.ok(similarity(src, "Apple iPhone 16 128 GB: 5G Mobile Phone with Camera Control, A18 Chip - Black") > 0.55);
  assert.ok(similarity("Sony WH-1000XM5 Wireless Headphones Black", "Sony WH-1000XM5 Bluetooth Noise Cancelling Headphones") > 0.55);
  assert.ok(similarity("Sony WH-1000XM5 Wireless Headphones", "Sony WH-1000XM4 Wireless Headphones") < 0.55);
  assert.equal(buildQuery("Galaxy S24 5G (Onyx Black, 8GB RAM, 256GB Storage) | Snapdragon", "Samsung"), "Samsung Galaxy S24 5G (Onyx Black, 8GB RAM, 256GB Storage)");
});

test("merchant names map to stores", () => {
  assert.equal(storeIdForMerchant("Amazon.in"), "amazon");
  assert.equal(storeIdForMerchant("from Reliance Digital"), "reliancedigital");
  assert.equal(storeIdForMerchant("Tata CLiQ"), "tatacliq");
  assert.equal(storeIdForMerchant("Poorvika"), "other");
});

test("alert decisions", () => {
  const base = { targetPrice: null, alertMode: "drop" as const, lastAlertPrice: null };
  assert.equal(alertReason(base, 1000, 900, true, true), "drop");
  assert.equal(alertReason(base, 1000, 1100, true, true), null);
  assert.equal(alertReason({ ...base, alertMode: "any" }, 1000, 1100, true, true), "rise");
  assert.equal(alertReason({ ...base, alertMode: "target_only" }, 1000, 900, true, true), null);
  assert.equal(alertReason({ ...base, targetPrice: 950, alertMode: "target_only" }, 1000, 900, true, true), "target");
  assert.equal(alertReason({ ...base, targetPrice: 950, lastAlertPrice: 900 }, 900, 900, true, true), null); // no repeat
  assert.equal(alertReason({ ...base, targetPrice: 950, lastAlertPrice: 900 }, 900, 880, true, true), "target");
  assert.equal(alertReason(base, 1000, 1000, false, true), "back_in_stock");
  assert.equal(alertReason(base, 1000, 900, true, false), null); // out of stock: stay quiet
});

test("history recording + Keepa parsing", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  assert.ok(shouldRecord(null, null, 100, now));
  assert.ok(shouldRecord(100, new Date("2026-11-26T09:00:00Z"), 90, now));
  assert.ok(!shouldRecord(100, new Date("2026-11-26T09:00:00Z"), 100, now));
  assert.ok(shouldRecord(100, new Date("2026-11-25T09:00:00Z"), 100, now));

  assert.equal(keepaToDate(0).toISOString(), "2011-01-01T00:00:00.000Z");
  const t = (iso: string) => Date.parse(iso) / 60000 - 21564000;
  const csv = [t("2026-01-01T05:00:00Z"), 6999900, t("2026-01-01T20:00:00Z"), 6799900, t("2026-01-02T05:00:00Z"), -1, t("2026-01-03T05:00:00Z"), 6599900];
  const pts = parseKeepaCsv(csv, 0);
  assert.deepEqual(pts.map((p) => p.price), [67999, 65999]);
});

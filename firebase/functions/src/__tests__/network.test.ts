import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { findComparisons } from "../compare.js";
import { fetchPage } from "../http.js";
import { identify } from "../url.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.SERPAPI_KEY;
});

function mockFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error("unexpected fetch " + url);
    return routes[key]();
  }) as typeof fetch;
  return calls;
}

const redirect = (to: string) => new Response(null, { status: 301, headers: { location: to } });
const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

test("short link is resolved hop by hop to the product page", async () => {
  mockFetch({
    "https://amzn.in/d/abc": () => redirect("https://www.amazon.in/dp/B0DGJ65N7V?ref=share"),
    "https://www.amazon.in/dp/B0DGJ65N7V": () => html("<span id='productTitle'>X</span>"),
  });
  const page = await fetchPage("https://amzn.in/d/abc");
  assert.equal(page.finalUrl, "https://www.amazon.in/dp/B0DGJ65N7V?ref=share");
  assert.equal(identify(page.finalUrl)?.productId, "amazon_B0DGJ65N7V");
});

test("redirects to non-store hosts are refused (SSRF guard)", async () => {
  mockFetch({ "https://amzn.in/d/evil": () => redirect("http://metadata.google.internal/computeMetadata/v1/") });
  await assert.rejects(fetchPage("https://amzn.in/d/evil"), /Unsupported store/);
  await assert.rejects(fetchPage("https://example.com/"), /Unsupported store/);
});

test("comparison via direct search picks the matching listing per store", async () => {
  mockFetch({
    "https://www.amazon.in/s?k=": () =>
      html(`
      <div data-component-type="s-search-result" data-asin="B0DGJ65N7V"><h2 aria-label="Apple iPhone 16 (128 GB) - Black"></h2><span class="a-price"><span class="a-offscreen">₹69,900</span></span></div>
      <div data-component-type="s-search-result" data-asin="B0DGHYDZR9"><h2 aria-label="Apple iPhone 16 Plus (128 GB) - Black"></h2><span class="a-price"><span class="a-offscreen">₹79,900</span></span></div>
      <div data-component-type="s-search-result" data-asin="B0CASE0001"><h2 aria-label="Spigen case for iPhone 16 black"></h2><span class="a-price"><span class="a-offscreen">₹999</span></span></div>`),
  });
  const offers = await findComparisons({ store: "flipkart", title: "Apple iPhone 16 (Black, 128 GB)", brand: "Apple", price: 66999 });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].store, "amazon");
  assert.equal(offers[0].price, 69900);
});

test("comparison via SerpApi maps merchants and drops accessories/variants", async () => {
  process.env.SERPAPI_KEY = "test";
  mockFetch({
    "https://serpapi.com/search.json": () =>
      new Response(
        JSON.stringify({
          shopping_results: [
            { title: "Apple iPhone 16 128GB Black", source: "Croma", extracted_price: 67490, link: "https://www.croma.com/x/p/1" },
            { title: "Apple iPhone 16 (Black, 128 GB)", source: "Flipkart", extracted_price: 66999, link: "https://www.flipkart.com/x/p/itm1" },
            { title: "iPhone 16 128 GB Black", source: "Poorvika", extracted_price: 68000, product_link: "https://www.google.com/shopping/product/1" },
            { title: "Apple iPhone 16 Pro 128GB Black Titanium", source: "Reliance Digital", extracted_price: 99900, link: "https://www.reliancedigital.in/x" },
            { title: "iPhone 16 back cover black", source: "Amazon.in", extracted_price: 299, link: "https://www.amazon.in/dp/B0CASE0001" },
          ],
        }),
        { status: 200 },
      ),
  });
  const offers = await findComparisons({ store: "amazon", title: "Apple iPhone 16 (128 GB) - Black", brand: "Apple", price: 69900 });
  assert.deepEqual(
    offers.map((o) => [o.storeName, o.price]),
    [
      ["Flipkart", 66999],
      ["Croma", 67490],
      ["Poorvika", 68000],
    ],
  );
});

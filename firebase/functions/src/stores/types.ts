export type StoreId =
  | "amazon"
  | "flipkart"
  | "myntra"
  | "croma"
  | "reliancedigital"
  | "tatacliq"
  | "vijaysales"
  | "jiomart"
  | "ajio"
  | "nykaa"
  | "other";

export interface ScrapedProduct {
  title: string;
  price: number | null;
  mrp: number | null;
  currency: string;
  imageUrl: string | null;
  brand: string | null;
  rating: number | null;
  ratingCount: number | null;
  inStock: boolean;
}

export interface SearchResult {
  title: string;
  price: number;
  url: string;
  imageUrl: string | null;
}

export interface StoreAdapter {
  id: StoreId;
  name: string;
  /** Registrable domains this store serves pages from, e.g. "amazon.in". */
  domains: string[];
  /** Stable product key from a product URL, or null if the URL is not a product page. */
  productKey(url: URL): string | null;
  /** Clean product URL without tracking parameters. */
  canonicalUrl(url: URL, key: string): string;
  parseProduct(html: string, url: string): ScrapedProduct | null;
  /** Optional direct search, used for comparison when no SerpApi key is set. */
  searchUrl?(query: string): string;
  parseSearch?(html: string): SearchResult[];
}

/** The page is a captcha / bot wall rather than the product. */
export class BlockedError extends Error {
  constructor(store: string) {
    super(`${store} blocked the request (captcha or bot protection)`);
    this.name = "BlockedError";
  }
}

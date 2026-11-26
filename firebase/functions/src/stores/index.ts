import { amazon } from "./amazon.js";
import { flipkart } from "./flipkart.js";
import { genericAdapter } from "./generic.js";
import { myntra } from "./myntra.js";
import type { StoreAdapter, StoreId } from "./types.js";

export const STORES: StoreAdapter[] = [
  amazon,
  flipkart,
  myntra,
  genericAdapter("croma", "Croma", ["croma.com"]),
  genericAdapter("reliancedigital", "Reliance Digital", ["reliancedigital.in"]),
  genericAdapter("tatacliq", "Tata CLiQ", ["tatacliq.com"]),
  genericAdapter("vijaysales", "Vijay Sales", ["vijaysales.com"]),
  genericAdapter("jiomart", "JioMart", ["jiomart.com"]),
  genericAdapter("ajio", "AJIO", ["ajio.com"]),
  genericAdapter("nykaa", "Nykaa", ["nykaa.com", "nykaafashion.com"]),
];

/** Share/short-link hosts we are willing to follow redirects from. */
export const SHORTENER_HOSTS = [
  "amzn.in",
  "amzn.to",
  "amzn.eu",
  "a.co",
  "dl.flipkart.com",
  "fkrt.it",
  "fkrt.cc",
  "fkrt.co",
  "fktr.in",
  "myntr.it",
  "ajiio.in",
  "ajio.page.link",
  "nykaa.me",
];

export function hostMatches(host: string, domain: string): boolean {
  host = host.toLowerCase();
  return host === domain || host.endsWith("." + domain);
}

export function storeForHost(host: string): StoreAdapter | null {
  return STORES.find((s) => s.domains.some((d) => hostMatches(host, d))) ?? null;
}

export function isShortener(host: string): boolean {
  return SHORTENER_HOSTS.some((d) => hostMatches(host, d));
}

export function isAllowedHost(host: string): boolean {
  return storeForHost(host) != null || isShortener(host);
}

export function storeById(id: StoreId): StoreAdapter | null {
  return STORES.find((s) => s.id === id) ?? null;
}

/** Map a merchant name shown by Google Shopping ("Amazon.in", "Croma") to our store id. */
export function storeIdForMerchant(name: string): StoreId {
  const n = name.toLowerCase().replace(/^from\s+/, "").replace(/[^a-z]/g, "");
  if (n.startsWith("amazon")) return "amazon";
  if (n.startsWith("flipkart")) return "flipkart";
  if (n.startsWith("myntra")) return "myntra";
  if (n.startsWith("croma")) return "croma";
  if (n.startsWith("reliancedigital")) return "reliancedigital";
  if (n.startsWith("tatacliq")) return "tatacliq";
  if (n.startsWith("vijaysales")) return "vijaysales";
  if (n.startsWith("jiomart")) return "jiomart";
  if (n.startsWith("ajio")) return "ajio";
  if (n.startsWith("nykaa")) return "nykaa";
  return "other";
}

export * from "./types.js";

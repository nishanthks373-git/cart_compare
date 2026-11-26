import { isAllowedHost } from "./stores/index.js";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
  "Cache-Control": "no-cache",
  "Upgrade-Insecure-Requests": "1",
};

export class FetchError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export interface Page {
  html: string;
  finalUrl: string;
  status: number;
}

/**
 * Fetch a store page, following redirects by hand so every hop is checked against the
 * store allowlist (prevents the function being used to reach arbitrary/internal hosts).
 *
 * If SCRAPER_PROXY_URL is set (e.g. "https://api.scraperapi.com/?api_key=KEY&country_code=in&url={url}"),
 * the final page is fetched through that service, which helps when stores block cloud IPs.
 */
export async function fetchPage(rawUrl: string, timeoutMs = 20000): Promise<Page> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 6; hop++) {
    assertAllowed(url);
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new FetchError("Redirect without location", res.status);
      url = new URL(loc, url);
      continue;
    }
    const proxy = process.env.SCRAPER_PROXY_URL;
    if (proxy && proxy.includes("{url}") && (res.status === 403 || res.status === 503 || res.status === 429 || res.status === 529)) {
      await res.body?.cancel();
      return fetchViaProxy(proxy, url.toString(), timeoutMs);
    }
    const html = await res.text();
    if (res.status >= 400) throw new FetchError(`HTTP ${res.status} from ${url.hostname}`, res.status);
    return { html, finalUrl: url.toString(), status: res.status };
  }
  throw new FetchError("Too many redirects");
}

export async function fetchViaProxy(template: string, target: string, timeoutMs = 60000): Promise<Page> {
  assertAllowed(new URL(target));
  const res = await fetch(template.replace("{url}", encodeURIComponent(target)), {
    signal: AbortSignal.timeout(Math.max(timeoutMs, 60000)),
  });
  const html = await res.text();
  if (!res.ok) throw new FetchError(`Proxy HTTP ${res.status}`, res.status);
  return { html, finalUrl: target, status: res.status };
}

/** Fetch directly, and retry through the proxy if the page turns out to be a bot wall. */
export async function fetchPageWithFallback<T>(url: string, parse: (page: Page) => T): Promise<{ page: Page; result: T }> {
  const page = await fetchPage(url);
  try {
    return { page, result: parse(page) };
  } catch (e) {
    const proxy = process.env.SCRAPER_PROXY_URL;
    if (e instanceof Error && e.name === "BlockedError" && proxy?.includes("{url}")) {
      const proxied = await fetchViaProxy(proxy, page.finalUrl);
      return { page: proxied, result: parse(proxied) };
    }
    throw e;
  }
}

function assertAllowed(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FetchError("Unsupported URL scheme");
  if (!isAllowedHost(url.hostname)) throw new FetchError(`Unsupported store: ${url.hostname}`);
}

export async function fetchJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new FetchError(`HTTP ${res.status} from ${new URL(url).hostname}`, res.status);
  return (await res.json()) as T;
}

/** Run tasks with limited parallelism. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

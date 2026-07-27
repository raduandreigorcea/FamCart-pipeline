// The Open Food Facts HTTP API.
//
// NOT the bulk path. Documented limits are 15 req/min for product reads and
// 10 req/min for search, so refreshing 20,000 barcodes this way would take
// about 22 hours -- re-download the dump instead, which is one 11.7 GB transfer
// with no limit at all. This exists for spot-checking a single product and for
// pulling small, real fixtures.
//
// Two traps, both hit while building this:
//   - The legacy /api/v2/search currently answers HTTP 200 with an HTML "Page
//     temporarily unavailable" body. Status alone is not a success signal;
//     every response here is checked for JSON.
//   - Search-a-licious caps its count and reports is_count_exact: false, so it
//     cannot enumerate a market.
import { PRODUCT_URL, RATE_LIMIT_PER_MIN, SEARCH_URL, getUserAgent } from '../config.ts'
import type { RawOffProduct } from '../types.ts'

class RateLimiter {
  private readonly intervalMs: number
  private next = 0

  constructor(perMinute: number) {
    this.intervalMs = Math.ceil(60_000 / perMinute)
  }

  async take(): Promise<void> {
    const now = Date.now()
    const at = Math.max(now, this.next)
    this.next = at + this.intervalMs
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now))
  }
}

const productLimiter = new RateLimiter(RATE_LIMIT_PER_MIN.product)
const searchLimiter = new RateLimiter(RATE_LIMIT_PER_MIN.search)

async function getJson(url: string, limiter: RateLimiter, attempt = 0): Promise<unknown> {
  await limiter.take()
  const response = await fetch(url, { headers: { 'User-Agent': getUserAgent(), Accept: 'application/json' } })

  if (response.status === 429 && attempt < 3) {
    // Back off rather than hammering a service that has just asked us not to.
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 5_000))
    return getJson(url, limiter, attempt + 1)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    // The 200-with-HTML case. Reporting it as "not JSON" is far more useful
    // than a JSON.parse stack trace 40 lines deep.
    throw new Error(
      `expected JSON from ${url} but got ${contentType || 'no content-type'} ` +
        `(HTTP ${response.status}) -- the endpoint is probably degraded`,
    )
  }

  return response.json()
}

export async function fetchProduct(barcode: string, fields: string[]): Promise<RawOffProduct | null> {
  const url = `${PRODUCT_URL}/${encodeURIComponent(barcode)}?fields=${fields.join(',')}`
  const body = (await getJson(url, productLimiter)) as { status?: number; product?: RawOffProduct }
  // status 0 with a 404 is how OFF says "no such product".
  return body?.status === 1 && body.product ? body.product : null
}

export interface SearchPage {
  hits: RawOffProduct[]
  count: number
  countExact: boolean
  pageCount: number
}

export async function search(query: string, page = 1, pageSize = 50): Promise<SearchPage> {
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(query)}` +
    `&page=${page}&page_size=${pageSize}`
  const body = (await getJson(url, searchLimiter)) as {
    hits?: RawOffProduct[]
    count?: number
    is_count_exact?: boolean
    page_count?: number
  }

  return {
    // brands comes back as an array here and as a comma-separated string in the
    // dump. normalize/brand.ts accepts both, so nothing is coerced in between.
    hits: body.hits ?? [],
    count: body.count ?? 0,
    countExact: Boolean(body.is_count_exact),
    pageCount: body.page_count ?? 0,
  }
}

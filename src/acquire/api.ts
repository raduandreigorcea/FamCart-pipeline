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
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PRODUCT_URL, RATE_LIMIT_PER_MIN, SEARCH_URL, getUserAgent, paths } from '../config.ts'
import { KEEP_FIELDS, project } from './dump.ts'
import type { MarketConfig, RawOffProduct, SubsetStats } from '../types.ts'

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

export async function search(
  query: string,
  page = 1,
  pageSize = 50,
  fields?: readonly string[],
): Promise<SearchPage> {
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(query)}` +
    `&page=${page}&page_size=${pageSize}` +
    (fields ? `&fields=${fields.join(',')}` : '')
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

// Elasticsearch refuses `from + size` beyond 10,000, so one country query can
// surface at most that many products no matter how it is paged. Confirmed by
// request: page 100 at page_size 100 returns a full page, page 101 does not.
const PAGE_SIZE = 100
const MAX_PAGE = 10_000 / PAGE_SIZE

// The dump-free way to fill the catalog: one query per market, paged to the
// engine's ceiling, projected to the same fields writeMarketSubset() keeps and
// written to the same file. Everything downstream cannot tell which acquire
// path produced it.
//
// This is NOT a replacement for the dump. It is capped at 10,000 per country
// and ordered by whatever relevance the engine picks, so it can never enumerate
// a market -- but it turns "wait for 11.7 GB" into "wait ten minutes" for a
// first wave, and the dump can be layered on top later without conflict.
export async function harvestMarkets(
  markets: MarketConfig,
  options: { tier2?: boolean } = {},
): Promise<SubsetStats> {
  const queries: { country: string; tier: 1 | 2 }[] = [
    ...markets.tier1.map((country) => ({ country, tier: 1 as const })),
    ...(options.tier2 ? markets.tier2.map((country) => ({ country, tier: 2 as const })) : []),
  ]

  mkdirSync(dirname(paths.subset), { recursive: true })
  const out = createWriteStream(paths.subset, { encoding: 'utf8' })
  const started = Date.now()
  // Countries overlap heavily -- a Coca-Cola carries a dozen of them -- so the
  // same product arrives from several queries. Keep the first sighting.
  const seen = new Set<string>()
  const stats: SubsetStats = {
    linesRead: 0,
    malformed: 0,
    kept: 0,
    tier1: 0,
    tier2: 0,
    bytesOut: 0,
    elapsedMs: 0,
  }

  for (const { country, tier } of queries) {
    for (let page = 1; page <= MAX_PAGE; page += 1) {
      const result = await search(
        `countries_tags:"${country}"`,
        page,
        PAGE_SIZE,
        [...KEEP_FIELDS],
      )
      stats.linesRead += result.hits.length

      for (const hit of result.hits) {
        const code = typeof hit.code === 'string' ? hit.code : ''
        if (!code || seen.has(code)) continue
        seen.add(code)

        const line = `${JSON.stringify(project(hit as Record<string, unknown>))}\n`
        stats.bytesOut += Buffer.byteLength(line)
        stats.kept += 1
        if (tier === 1) stats.tier1 += 1
        else stats.tier2 += 1
        if (!out.write(line)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
      }

      console.log(
        `  ${country} page ${page}/${Math.min(result.pageCount, MAX_PAGE)} -- ${stats.kept.toLocaleString()} products so far`,
      )
      if (result.hits.length < PAGE_SIZE || page >= result.pageCount) break
    }
  }

  await new Promise<void>((resolve, reject) => {
    out.end((error?: Error) => (error ? reject(error) : resolve()))
  })

  stats.elapsedMs = Date.now() - started
  return stats
}

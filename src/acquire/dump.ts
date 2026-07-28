// Getting the Open Food Facts dump onto disk, and getting the ~0.5% of it we
// care about back off again.
//
// Measured 2026-07-27, because the published figures are wrong:
//   compressed   11.7 GB (12,540,175,592 bytes) -- the data page says 0.9 GB
//   ratio        6.26x, so roughly 78 GB uncompressed
//   records      ~3.2 million, averaging 24 KB each across 534 distinct keys
//
// Two consequences shape this file. First, nothing may be buffered: 78 GB of
// JSON has to be read a line at a time, and a single readFile would take the
// process out. Second, the filter pass PROJECTS -- it keeps ~18 fields of the
// 534 and writes them to a small local file, so the expensive pass over the
// dump happens once and every later stage iterates over tens of megabytes.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { dirname } from 'node:path'
import { DUMP_URL, getUserAgent, paths } from '../config.ts'
import type { DumpManifest, MarketConfig, RawOffProduct, SubsetStats } from '../types.ts'

// The fields any later stage reads. Everything else -- nutriments, ingredient
// trees, per-language packaging text -- is the other 99% of the bytes.
export const KEEP_FIELDS = [
  'code',
  'product_name',
  'product_name_ro',
  'product_name_en',
  'generic_name',
  'generic_name_ro',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'countries_tags',
  'categories_tags',
  'lang',
  'unique_scans_n',
  'completeness',
  'last_modified_t',
  'obsolete',
] as const

export function project(record: Record<string, unknown>): RawOffProduct {
  const out: Record<string, unknown> = {}
  for (const field of KEEP_FIELDS) {
    const value = record[field]
    if (value !== undefined && value !== null && value !== '') out[field] = value
  }
  return out as RawOffProduct
}

function readManifest(): DumpManifest | null {
  if (!existsSync(paths.dumpManifest)) return null
  try {
    return JSON.parse(readFileSync(paths.dumpManifest, 'utf8')) as DumpManifest
  } catch {
    return null
  }
}

export interface DownloadResult {
  manifest: DumpManifest
  skipped: boolean
  resumedFrom: number
}

// Resumable, and a no-op when the server says nothing has changed. The static
// URL 302-redirects to S3, which honours Range and returns an ETag, so an
// interrupted 11.7 GB download picks up where it stopped rather than starting
// over.
export async function downloadDump(force = false): Promise<DownloadResult> {
  mkdirSync(dirname(paths.dump), { recursive: true })
  const previous = readManifest()
  const onDisk = existsSync(paths.dump) ? statSync(paths.dump).size : 0

  if (!force && previous && onDisk === previous.bytes && onDisk > 0) {
    const head = await fetch(DUMP_URL, {
      method: 'HEAD',
      headers: { 'User-Agent': getUserAgent() },
    })
    const etag = head.headers.get('etag')
    if (etag && previous.etag === etag) {
      return { manifest: previous, skipped: true, resumedFrom: 0 }
    }
  }

  // Only resume onto a partial file from the same run; a stale complete file
  // from an older dump has to be replaced, not appended to.
  const resume = !force && previous && onDisk > 0 && onDisk < previous.bytes ? onDisk : 0

  const response = await fetch(DUMP_URL, {
    headers: {
      'User-Agent': getUserAgent(),
      ...(resume ? { Range: `bytes=${resume}-` } : {}),
    },
  })

  if (!response.ok || !response.body) {
    throw new Error(`downloading the dump failed: HTTP ${response.status}`)
  }

  const partial = response.status === 206
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  const total = partial ? resume + contentLength : contentLength

  let received = partial ? resume : 0
  let lastLogged = 0
  const progress = new TransformProgress((bytes) => {
    received += bytes
    if (received - lastLogged > 250_000_000) {
      lastLogged = received
      const pct = total ? ((100 * received) / total).toFixed(1) : '?'
      console.log(`  ${(received / 1e9).toFixed(2)} GB of ${(total / 1e9).toFixed(2)} GB (${pct}%)`)
    }
  })

  await pipeline(
    Readable.fromWeb(response.body as unknown as WebReadableStream),
    progress,
    createWriteStream(paths.dump, { flags: partial ? 'a' : 'w' }),
  )

  const manifest: DumpManifest = {
    url: DUMP_URL,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    bytes: statSync(paths.dump).size,
    downloadedAt: new Date().toISOString(),
  }
  writeFileSync(paths.dumpManifest, JSON.stringify(manifest, null, 2), 'utf8')

  return { manifest, skipped: false, resumedFrom: resume }
}

// Counts bytes without holding on to them.
class TransformProgress extends Transform {
  private readonly onBytes: (n: number) => void

  constructor(onBytes: (n: number) => void) {
    super()
    this.onBytes = onBytes
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error) => void) {
    this.onBytes(chunk.length)
    this.push(chunk)
    done()
  }
}

// A line at a time, forever. crlfDelay because a fixture touched by a Windows
// editor has CRLF endings and would otherwise leave a stray \r on every record.
export async function* streamJsonl(path: string, gzipped: boolean): AsyncGenerator<unknown> {
  const file = createReadStream(path, { highWaterMark: 1 << 20 })
  const source = gzipped ? file.pipe(createGunzip()) : file
  const lines = createInterface({ input: source, crlfDelay: Infinity })

  for await (const line of lines) {
    if (!line) continue
    try {
      yield JSON.parse(line)
    } catch {
      // A truncated or malformed line is counted by the caller, never fatal:
      // one bad record must not cost the other 3.2 million.
      yield MALFORMED
    }
  }
}

export const MALFORMED = Symbol('malformed-line')

// The single expensive pass. Everything downstream reads the file this writes.
export async function writeMarketSubset(
  markets: MarketConfig,
  outPath = paths.subset,
): Promise<SubsetStats> {
  if (!existsSync(paths.dump)) {
    throw new Error(`no dump at ${paths.dump} -- run \`npm run acquire\` first`)
  }
  mkdirSync(dirname(outPath), { recursive: true })

  const tier1 = new Set(markets.tier1)
  const tier2 = new Set(markets.tier2)
  const out = createWriteStream(outPath, { encoding: 'utf8' })
  const started = Date.now()

  const stats: SubsetStats = {
    linesRead: 0,
    malformed: 0,
    kept: 0,
    tier1: 0,
    tier2: 0,
    bytesOut: 0,
    elapsedMs: 0,
  }

  for await (const record of streamJsonl(paths.dump, true)) {
    stats.linesRead += 1
    if (stats.linesRead % 250_000 === 0) {
      console.log(`  read ${stats.linesRead.toLocaleString()} records, kept ${stats.kept.toLocaleString()}`)
    }

    if (record === MALFORMED) {
      stats.malformed += 1
      continue
    }

    const countries = (record as RawOffProduct).countries_tags
    if (!Array.isArray(countries)) continue

    let tier: 1 | 2 | null = null
    for (const country of countries) {
      if (tier1.has(String(country))) {
        tier = 1
        break
      }
      if (tier2.has(String(country))) tier = 2
    }
    if (tier === null) continue

    const line = `${JSON.stringify(project(record as Record<string, unknown>))}\n`
    stats.bytesOut += Buffer.byteLength(line)
    stats.kept += 1
    if (tier === 1) stats.tier1 += 1
    else stats.tier2 += 1

    // Respect backpressure: without this, a fast gunzip outruns the disk and
    // the whole subset queues up in memory.
    if (!out.write(line)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
  }

  await new Promise<void>((resolve, reject) => {
    out.end((error?: Error) => (error ? reject(error) : resolve()))
  })

  stats.elapsedMs = Date.now() - started
  return stats
}

export async function readSubset(path = paths.subset): Promise<RawOffProduct[]> {
  if (!existsSync(path)) {
    throw new Error(`no market subset at ${path} -- run \`npm run acquire:filter\` first`)
  }
  const products: RawOffProduct[] = []
  for await (const record of streamJsonl(path, false)) {
    if (record !== MALFORMED) products.push(record as RawOffProduct)
  }
  return products
}

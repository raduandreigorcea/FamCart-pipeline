// Where the pipeline reads and writes, and how it finds credentials.
//
// The importer normally lives at catalog-importer/ inside a FamCart
// checkout, so by default it reads FamCart's .env -- the same file
// scripts/seed-products.mjs uses, with the same variable names. One set of
// credentials, no duplication, nothing extra to keep in sync.
//
// In a standalone clone there is no FamCart above it, so it falls back to a
// local .env. Only config resolution ever looks outside this repo; no module
// here imports FamCart source (see src/vendor/).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrandAliasTable, CasingExceptions, GateConfig, MarketConfig } from './types.ts'

const here = dirname(fileURLToPath(import.meta.url))

export const repoRoot = join(here, '..')
export const dataDir = join(repoRoot, 'data')
export const cacheDir = join(repoRoot, '.cache')
export const outDir = join(repoRoot, 'out')

export const DUMP_URL = 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz'
export const SEARCH_URL = 'https://search.openfoodfacts.org/search'
export const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product'

// Open Food Facts asks every client to identify itself -- anonymous traffic
// risks being treated as a bot. Their documented format is
// AppName/Version (ContactEmail), and a contact URL works in its place.
//
// The default points at this repository rather than a person, because this repo
// is public and a maintainer's address in a checked-in constant is a spam
// magnet. Set OFF_USER_AGENT in .env to give them a real address to reach you at
// if you are running a large import.
const DEFAULT_USER_AGENT =
  'FamCartCatalogImporter/0.1 (+https://github.com/raduandreigorcea/FamCart-pipeline)'

export function getUserAgent(): string {
  loadEnvOnce()
  return process.env.OFF_USER_AGENT?.trim() || DEFAULT_USER_AGENT
}

// Documented limits: 15 req/min for /api/v*/product, 10 req/min for search.
// Far tighter than most APIs, and the reason bulk acquisition uses the dump.
export const RATE_LIMIT_PER_MIN = { product: 15, search: 10 } as const

export const paths = {
  dump: join(cacheDir, 'openfoodfacts-products.jsonl.gz'),
  dumpManifest: join(cacheDir, 'manifest.json'),
  subset: join(cacheDir, 'markets-subset.jsonl'),
  staged: join(outDir, 'staged.jsonl'),
  rejected: join(outDir, 'rejected.jsonl'),
  scored: join(outDir, 'scored.jsonl'),
  reviewQueue: join(outDir, 'review-queue.jsonl'),
  dropped: join(outDir, 'dropped.jsonl'),
  collapsed: join(outDir, 'collapsed.jsonl'),
  loadPlan: join(outDir, 'load-plan.json'),
  loadDiff: join(outDir, 'load-diff.md'),
  loadErrors: join(outDir, 'load-errors.jsonl'),
  report: join(outDir, 'report.md'),
  emojiCoverage: join(outDir, 'emoji-coverage.md'),
  decisions: join(dataDir, 'decisions.jsonl'),
} as const

// Which .env to read. The FamCart root is one level up, and is only accepted if
// it actually looks like FamCart -- so a standalone clone that happens to sit
// inside some other project is not raided for its credentials.
export function findEnvFile(): string | null {
  const famcartRoot = resolve(repoRoot, '..')
  const famcartPkg = join(famcartRoot, 'package.json')
  if (existsSync(famcartPkg)) {
    try {
      const pkg = JSON.parse(readFileSync(famcartPkg, 'utf8')) as { name?: string }
      if (pkg.name === 'famcart' && existsSync(join(famcartRoot, '.env'))) {
        return join(famcartRoot, '.env')
      }
    } catch {
      // A malformed package.json up there is not this tool's problem; fall back.
    }
  }
  const local = join(repoRoot, '.env')
  return existsSync(local) ? local : null
}

// Reading the .env is a process-wide side effect, and both the credentials and
// the user agent want it done before they look at process.env. Once is enough.
let envLoaded = false
function loadEnvOnce(): string | null {
  const envFile = findEnvFile()
  if (!envLoaded && envFile) {
    process.loadEnvFile(envFile)
    envLoaded = true
  }
  return envFile
}

export interface Credentials {
  url: string
  serviceRoleKey: string
}

// Only ever the service role: the anon key cannot write product_catalog (RLS
// grants SELECT and nothing else) and import_catalog_products() is granted to
// service_role alone.
export function loadCredentials(): Credentials {
  const envFile = loadEnvOnce()

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing credentials. Expected VITE_SUPABASE_URL (or SUPABASE_URL) and ' +
        `SUPABASE_SERVICE_ROLE_KEY in ${envFile ?? 'a .env file'}.`,
    )
  }
  return { url, serviceRoleKey }
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as T
}

export const loadMarkets = () => readJson<MarketConfig>('markets.json')
export const loadBrandAliases = () => readJson<BrandAliasTable>('brand-aliases.json')
export const loadCasingExceptions = () => readJson<CasingExceptions>('casing-exceptions.json')
export const loadGateConfig = () => readJson<GateConfig>('gate.json')
export const loadNameBlocklist = () =>
  new Set(readJson<{ names: string[] }>('name-blocklist.json').names)

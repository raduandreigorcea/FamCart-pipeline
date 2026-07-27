// Shared shapes for the import pipeline.
//
// The stages are deliberately file-to-file: acquire writes a market subset,
// normalize reads it and writes staged products, score reads those and writes a
// verdict per product, load reads the approved ones. Every stage can be re-run
// against the previous stage's output without redoing the 11.7 GB download, and
// every intermediate is inspectable by hand when a product comes out wrong.

// ─── acquire ──────────────────────────────────────────────────────────────────

// One record as it appears in openfoodfacts-products.jsonl.gz.
//
// Field notes, all measured against the real dump and a Romanian API sample on
// 2026-07-27 rather than assumed:
//   - `lang` is NOT trustworthy. In a 50-product Romanian sample only 27 said
//     'ro'; Napolact's "Bio Chefir" is filed as French. Never gate on it.
//     `product_name_ro` is set by a human who knew, and is the real signal.
//   - `unique_scans_n` is absent on ~65% of all records (~24% of Romanian ones).
//     Absent means no signal, not zero popularity and not disqualified.
//   - `completeness` ranges 0 .. 1.1, not 0 .. 1 and not a percentage.
//   - `obsolete` is absent rather than false on current products.
//   - `image_url` is not in the dump at all.
//   - `brands` is a comma-separated string HERE, but an array from the API.
//     acquire/ normalizes both to string[] so normalize/ sees one shape.
export interface RawOffProduct {
  code?: string
  product_name?: string
  product_name_ro?: string
  product_name_en?: string
  generic_name?: string
  generic_name_ro?: string
  brands?: string | string[]
  brands_tags?: string[]
  quantity?: string
  // Normalized to grams or millilitres by OFF, with the unit in the sibling
  // field. The fallback when `quantity` is unparseable free text.
  product_quantity?: string | number
  product_quantity_unit?: string
  countries_tags?: string[]
  categories_tags?: string[]
  lang?: string
  languages_tags?: string[]
  unique_scans_n?: number
  completeness?: number
  last_modified_t?: number
  obsolete?: unknown
  // product_name_<lang> for any of the ~12 languages seen in the dump.
  [key: string]: unknown
}

export interface MarketConfig {
  version: number
  // Auto-load eligible.
  tier1: string[]
  // Never auto-loads: a product sold only in Hungary is noise in a
  // Romanian-facing app unless a human says otherwise.
  tier2: string[]
}

export interface DumpManifest {
  url: string
  // S3 returns a multipart etag; used only for If-None-Match, never parsed.
  etag: string | null
  lastModified: string | null
  bytes: number
  downloadedAt: string
}

export interface SubsetStats {
  linesRead: number
  malformed: number
  kept: number
  tier1: number
  tier2: number
  bytesOut: number
  elapsedMs: number
}

// ─── normalize ────────────────────────────────────────────────────────────────

export type NameFieldSource =
  | 'product_name_ro'
  | 'product_name_en'
  | 'product_name'
  | 'generic_name_ro'
  | 'generic_name'

export type NormalizeWarning =
  | 'foreign-name'
  | 'generic-name'
  | 'truncated-name'
  | 'maker-dropped'

export type RejectReason =
  | 'obsolete'
  | 'bad-barcode'
  | 'no-name'
  | 'blocklisted-name'
  | 'name-too-short'
  | 'name-too-long'
  | 'search-text-too-long'
  | 'no-market'

export interface ParsedQuantity {
  value: number
  unit: 'L' | 'ml' | 'kg' | 'g' | 'buc'
  // The multiplier in "6 x 0.5 L"; null for a single pack.
  count: number | null
  raw: string
}

export interface OffSignals {
  // null, not 0: absent is "no signal", and the scorer must not read it as
  // "nobody has ever scanned this".
  uniqueScans: number | null
  completeness: number
  categoriesTags: string[]
  hasBrand: boolean
  hasQuantity: boolean
  marketTier: 1 | 2
}

export interface StagedProduct {
  barcode: string
  // FamCart house style: Title Case, diacritic-free, size appended, <= 120.
  name: string
  maker: string | null
  // From the VENDORED normalizer, and used only to collapse candidates against
  // each other before load. The value actually stored is computed by the
  // database's product_search_text(), which is the only authority on the key.
  searchText: string
  key: string
  sourceRef: string
  nameLang: 'ro' | 'en' | 'other'
  nameSource: NameFieldSource
  quantity: ParsedQuantity | null
  markets: string[]
  signals: OffSignals
  warnings: NormalizeWarning[]
}

export type NormalizeResult =
  | { ok: true; product: StagedProduct }
  | { ok: false; rejected: { barcode: string; reason: RejectReason; detail?: string } }

export interface BrandAliasTable {
  version: number
  // Keyed by normalizeSearchText(brand), so lookups survive case and accents.
  canonical: Record<string, string>
  // "unknown", "sans marque", "marca proprie" -- brand fields that mean no brand.
  drop: string[]
}

export interface CasingExceptions {
  version: number
  upper: string[]
  lower: string[]
}

// ─── score + gate ─────────────────────────────────────────────────────────────

export interface GateConfig {
  version: number
  autoMin: number
  reviewMin: number
  weights: Record<string, number>
}

export interface QualityScore {
  total: number
  parts: Record<string, number>
  flags: string[]
}

export type Verdict = 'auto' | 'review' | 'drop'

export interface ScoredProduct {
  product: StagedProduct
  score: QualityScore
  verdict: Verdict
  reason: string
}

export interface Decision {
  barcode: string
  verdict: 'approve' | 'reject'
  overrideName?: string
  overrideMaker?: string
  reason?: string
  decidedAt: string
  decidedBy?: string
}

export type DecisionIndex = Map<string, Decision>

// ─── load ─────────────────────────────────────────────────────────────────────

// Exactly the shape import_catalog_products() destructures from its jsonb.
export interface LoadRow {
  barcode: string
  name: string
  maker: string | null
  base_weight: number
  source_ref: string
}

export interface CollapseRecord {
  searchText: string
  winner: string
  losers: string[]
}

export interface ImportReport {
  inserted: number
  updated_imported: number
  updated_provenance_only: number
  skipped_invalid: number
  skipped_barcode_conflict: number
  deduped: number
  collapsed_scoped: number
  source: string
  source_version: string | null
  dry_run: boolean
}

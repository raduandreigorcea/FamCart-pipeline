// Talking to the database.
//
// Every write goes through import_catalog_products(), never through
// supabase-js .upsert(). That is not a style preference: PostgREST can only
// infer ON CONFLICT against a TOTAL unique constraint, and both keys that
// govern a global catalog row -- product_catalog_global_search and
// product_catalog_global_barcode -- are PARTIAL indexes. An .upsert() against
// either fails at runtime with "there is no unique or exclusion constraint
// matching the ON CONFLICT specification".
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadCredentials } from '../config.ts'
import type { ImportReport, LoadRow } from '../types.ts'

export const CHUNK_SIZE = 500

export function createServiceClient(): SupabaseClient {
  const { url, serviceRoleKey } = loadCredentials()
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface ImportOptions {
  source?: string
  sourceVersion: string
  dryRun: boolean
}

export async function callImport(
  db: SupabaseClient,
  rows: LoadRow[],
  options: ImportOptions,
): Promise<ImportReport> {
  const { data, error } = await db.rpc('import_catalog_products', {
    p_rows: rows,
    p_source: options.source ?? 'openfoodfacts',
    p_source_version: options.sourceVersion,
    p_dry_run: options.dryRun,
  })

  if (error) {
    // The most likely cause by far, and the message alone does not say so.
    const hint = error.message?.includes('function public.import_catalog_products')
      ? ' -- migration 028 has probably not been applied to this database'
      : ''
    throw new Error(`import_catalog_products failed: ${error.message}${hint}`)
  }

  return data as ImportReport
}

export function emptyReport(dryRun: boolean, sourceVersion: string): ImportReport {
  return {
    inserted: 0,
    updated_imported: 0,
    updated_provenance_only: 0,
    skipped_invalid: 0,
    skipped_barcode_conflict: 0,
    deduped: 0,
    collapsed_scoped: 0,
    source: 'openfoodfacts',
    source_version: sourceVersion,
    dry_run: dryRun,
  }
}

export function addReports(a: ImportReport, b: ImportReport): ImportReport {
  return {
    ...a,
    inserted: a.inserted + b.inserted,
    updated_imported: a.updated_imported + b.updated_imported,
    updated_provenance_only: a.updated_provenance_only + b.updated_provenance_only,
    skipped_invalid: a.skipped_invalid + b.skipped_invalid,
    skipped_barcode_conflict: a.skipped_barcode_conflict + b.skipped_barcode_conflict,
    deduped: a.deduped + b.deduped,
    collapsed_scoped: a.collapsed_scoped + b.collapsed_scoped,
  }
}

export interface ExistingGlobal {
  search_text: string
  name: string
  maker: string | null
  base_weight: number
  add_count: number
  source: string
  barcode: string | null
}

// Read the rows this batch would touch, so the dry run can show what actually
// changes rather than just how many rows were involved. Chunked because a
// search_text `in` list of 30,000 values does not fit in a URL.
export async function fetchExistingGlobals(
  db: SupabaseClient,
  searchTexts: string[],
): Promise<Map<string, ExistingGlobal>> {
  const found = new Map<string, ExistingGlobal>()

  for (let i = 0; i < searchTexts.length; i += 200) {
    const slice = searchTexts.slice(i, i + 200)
    const { data, error } = await db
      .from('product_catalog')
      .select('search_text, name, maker, base_weight, add_count, source, barcode')
      .is('household_id', null)
      .in('search_text', slice)

    if (error) throw new Error(`reading existing catalog rows failed: ${error.message}`)
    for (const row of (data ?? []) as ExistingGlobal[]) found.set(row.search_text, row)
  }

  return found
}

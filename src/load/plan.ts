// Approved products in, rows the database will accept out.
//
// The one thing this has to get right is collapsing. product_catalog has a
// partial unique index on search_text for global rows, so two upstream records
// that normalize to the same key cannot both be inserted -- and Open Food Facts
// is full of them: the same yoghurt under a 4-pack barcode and a single-pot
// barcode, or the same product entered twice with different capitalization.
//
// import_catalog_products() repeats this collapse server-side using the same
// ordering, so the two can never disagree about which row wins. Doing it here
// as well is what makes the losers visible: they go to out/collapsed.jsonl so a
// product that quietly vanished can be traced.
import { importedBaseWeight } from '../score/score.ts'
import type { CollapseRecord, LoadRow, StagedProduct } from '../types.ts'

export interface LoadPlan {
  rows: LoadRow[]
  collapsed: CollapseRecord[]
}

// Deterministic, and deliberately the same order the SQL uses:
// heavier first, then better-evidenced, then the lowest barcode as a stable
// tiebreak so two runs over the same input always pick the same winner.
function betterCandidate(a: StagedProduct, b: StagedProduct): number {
  const weight = importedBaseWeight(b.signals.uniqueScans) - importedBaseWeight(a.signals.uniqueScans)
  if (weight !== 0) return weight

  const scans = (b.signals.uniqueScans ?? 0) - (a.signals.uniqueScans ?? 0)
  if (scans !== 0) return scans

  const completeness = b.signals.completeness - a.signals.completeness
  if (completeness !== 0) return completeness

  return a.barcode.localeCompare(b.barcode)
}

export function buildLoadPlan(accepted: StagedProduct[]): LoadPlan {
  const groups = new Map<string, StagedProduct[]>()
  for (const product of accepted) {
    const group = groups.get(product.searchText)
    if (group) group.push(product)
    else groups.set(product.searchText, [product])
  }

  const rows: LoadRow[] = []
  const collapsed: CollapseRecord[] = []

  for (const [searchText, group] of groups) {
    const sorted = [...group].sort(betterCandidate)
    const winner = sorted[0]

    if (sorted.length > 1) {
      collapsed.push({
        searchText,
        winner: winner.barcode,
        losers: sorted.slice(1).map((p) => p.barcode),
      })
    }

    rows.push({
      barcode: winner.barcode,
      name: winner.name,
      maker: winner.maker,
      base_weight: importedBaseWeight(winner.signals.uniqueScans),
      source_ref: winner.sourceRef,
    })
  }

  // Stable output order so a dry run and the real run produce comparable files,
  // and so a diff between two runs is readable.
  rows.sort((a, b) => a.barcode.localeCompare(b.barcode))
  return { rows, collapsed }
}

// One barcode can only belong to one global row, so a batch carrying the same
// code under two different names would violate product_catalog_global_barcode.
// The server drops these too; finding them here means they can be reported
// rather than silently skipped.
export function findBarcodeCollisions(rows: LoadRow[]): Map<string, LoadRow[]> {
  const byBarcode = new Map<string, LoadRow[]>()
  for (const row of rows) {
    const group = byBarcode.get(row.barcode)
    if (group) group.push(row)
    else byBarcode.set(row.barcode, [row])
  }
  for (const [barcode, group] of byBarcode) {
    if (group.length < 2) byBarcode.delete(barcode)
  }
  return byBarcode
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

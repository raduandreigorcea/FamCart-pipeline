// Open Food Facts `brands` is free text, so the same company arrives as
// "Coca Cola", "coca-cola" and "COCA COLA". product_catalog.maker has no brands
// table behind it -- whatever lands there is what a shopper reads as the
// subtitle under the product name.
//
// Two shapes to handle, which is why this is the only place that touches the
// raw field: the dump gives a comma-separated string ("Tetley,  American Power
// Products  Inc."), the API gives an array (["Poretti","Angelo Poretti",
// "Carlsberg"]). Both mean the same thing, most specific first.
import { normalizeSearchText } from '../vendor/productSearch.ts'
import { cleanRawName, titleCaseRo } from './name.ts'
import type { BrandAliasTable, CasingExceptions, RawOffProduct } from '../types.ts'

export const MAKER_MAX = 60

export function brandParts(brands: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(brands) ? brands : String(brands ?? '').split(',')
  return raw.map((part) => cleanRawName(part)).filter(Boolean)
}

export function pickBrand(
  raw: RawOffProduct,
  aliases: BrandAliasTable,
  casing: CasingExceptions,
): string | null {
  const drop = new Set((aliases.drop ?? []).map((d) => normalizeSearchText(d)))

  for (const part of brandParts(raw.brands)) {
    const folded = normalizeSearchText(part)
    // "unknown", "sans marque", "marca proprie" -- a brand field that means
    // there is no brand. Must become null, never a maker called "Unknown".
    if (!folded || drop.has(folded)) continue

    const canonical = aliases.canonical?.[folded] ?? titleCaseRo(part, casing, aliases)
    // Over-long brands are usually a whole legal entity ("... Products Inc.");
    // try the next part rather than truncating a company name mid-word.
    if (canonical.length >= 1 && canonical.length <= MAKER_MAX) return canonical
  }

  return null
}

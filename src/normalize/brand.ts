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

// A legal notice that ended up in the brand column, e.g. Nestle's
// "®reg. Trademark Of Societe Des Produits Nestle S. A.". No shopper reads that
// as a maker, and it is never the only brand part on a product.
const TRADEMARK_NOISE = /[®™©]|\breg\.?\s*trademark\b|\btrademark\s+of\b/i

// Cleanups that apply to the brand field and to nothing else. Returns null when
// the part is not a brand at all, so the caller moves on to the next one.
export function tidyBrandPart(part: string): string | null {
  // "Pilos ( Lidl )", "Golden Sun (lidl)" -- a note about which supermarket
  // stocks it, not part of the name a shopper reads under the product.
  const tidied = part.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  if (!tidied) return null
  if (TRADEMARK_NOISE.test(tidied)) return null
  // A barcode in the wrong column. Bounded at 8 digits because short numeric
  // brands are real -- 365 is Mega Image's private label, 7 Days is a bakery.
  if (/^\d{8,}$/.test(tidied)) return null
  return tidied
}

export function pickBrand(
  raw: RawOffProduct,
  aliases: BrandAliasTable,
  casing: CasingExceptions,
): string | null {
  const drop = new Set((aliases.drop ?? []).map((d) => normalizeSearchText(d)))

  for (const rawPart of brandParts(raw.brands)) {
    const part = tidyBrandPart(rawPart)
    if (!part) continue
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

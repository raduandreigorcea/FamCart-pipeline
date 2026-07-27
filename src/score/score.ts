// How good a candidate is, 0-100, and where it lands in the catalog's ranking.
//
// The score exists to sort the tolerable from the embarrassing. Open Food Facts
// is crowd-edited: alongside "Lapte Integral 3,5% 1L / Zuzu" it carries entries
// with no brand, no size, a name in the wrong language, or a name that is just
// the category. All of those are legible; none of them belong in a suggestion
// list unread.
import type { GateConfig, QualityScore, StagedProduct } from '../types.ts'

// A name that reads as shouting, a name made mostly of numbers, a name that is
// just the brand again -- each one is a product nobody typed carefully.
function sanityFlags(product: StagedProduct): string[] {
  const flags: string[] = []
  const words = product.name.split(/\s+/).filter(Boolean)

  if (product.name.replace(/\s/g, '').length <= 3) flags.push('name-too-short')

  // Deliberately no all-caps check: titleCaseRo has already rewritten "LAPTE"
  // as "Lapte" by the time this runs, so a flag for shouting could never fire.
  // Shouting in the source is a formatting problem, and formatting is fixed
  // rather than penalized.

  const digitWords = words.filter((w) => /^\d[\d.,%x-]*$/i.test(w)).length
  if (words.length > 0 && digitWords / words.length > 0.6) flags.push('mostly-digits')

  if (product.maker && product.name.toLowerCase() === product.maker.toLowerCase()) {
    flags.push('name-is-brand')
  }

  return flags
}

export function scoreProduct(product: StagedProduct, weights: GateConfig['weights']): QualityScore {
  const parts: Record<string, number> = {}
  const { signals } = product

  parts.market = signals.marketTier === 1 ? weights.marketTier1 : weights.marketTier2

  parts.language =
    product.nameLang === 'ro'
      ? weights.nameRo
      : product.nameLang === 'en'
        ? weights.nameEn
        : weights.nameOther

  // Absent means no signal, so it scores zero here rather than disqualifying.
  // The forced drop for an unscanned product lives in the gate, and needs a
  // missing brand as well before it fires.
  parts.popularity =
    signals.uniqueScans === null
      ? 0
      : Math.min(
          weights.popularityMax,
          Math.round(weights.popularityScale * Math.log10(1 + signals.uniqueScans)),
        )

  parts.brand = signals.hasBrand ? weights.brand : 0

  // Partial credit when the field was filled in but we could not read the
  // phrasing ("1 Serving(s) (14 G)"): somebody cared enough to enter a size.
  parts.quantity = signals.hasQuantity
    ? weights.quantityParsed
    : signals.rawQuantityPresent
      ? weights.quantityUnparseable
      : 0

  // Measured range is 0..1.1, so the clamp is doing real work rather than
  // guarding against a value that cannot occur.
  parts.completeness = Math.round(
    weights.completenessMax * Math.min(1, Math.max(0, signals.completeness)),
  )

  parts.categories = signals.categoriesTags.length > 0 ? weights.categories : 0

  const flags = sanityFlags(product)
  parts.sanity = flags.length > 0 ? weights.sanityPenalty : 0
  parts.warnings = product.warnings.length * weights.warningPenalty

  const total = Math.max(
    0,
    Math.min(100, Object.values(parts).reduce((sum, n) => sum + n, 0)),
  )

  return { total, parts, flags: [...flags, ...product.warnings] }
}

// Where an imported product sits in the catalog's cold-start ranking.
//
// The curated bands are 100 for a staple and 10 for an ordinary product, and
// imports must stay strictly below the ordinary baseline: tens of thousands of
// rows arriving above it would flatten the editorial signal the seed exists to
// provide. Strictly above 0 as well, so an import still outranks nothing.
//
//   0 scans -> 1     10 -> 3     1_000 -> 7
//   3 scans -> 2    100 -> 5    10_000+ -> 9
//
// A product that actually gets used climbs past the curated band on add_count
// within about ten adds, which is the intended dynamic and the whole reason
// base_weight and add_count are separate columns.
export function importedBaseWeight(uniqueScans: number | null): number {
  const scans = Math.max(0, Number(uniqueScans) || 0)
  return Math.max(1, Math.min(9, 1 + Math.floor(2 * Math.log10(1 + scans))))
}

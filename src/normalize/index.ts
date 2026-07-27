// One Open Food Facts record in, one catalog-ready product out -- or a logged
// reason why not.
//
// Order matters here. The brand is picked first because the name step needs it
// (both to strip a repeated brand and to decide whether a bare generic name is
// usable), and the length clamp runs last because appending the size is what
// pushes a name over the limit.
import { normalizeSearchText, productKey } from '../vendor/productSearch.ts'
import { pickBrand, MAKER_MAX } from './brand.ts'
import { clampName, pickName, stripBrandPrefix, titleCaseRo } from './name.ts'
import { appendQuantity, parseQuantity } from './quantity.ts'
import type {
  BrandAliasTable,
  CasingExceptions,
  MarketConfig,
  NormalizeResult,
  NormalizeWarning,
  RawOffProduct,
  RejectReason,
  StagedProduct,
} from '../types.ts'

export const NAME_MAX = 120
export const SEARCH_TEXT_MAX = 200

export interface NormalizeContext {
  aliases: BrandAliasTable
  casing: CasingExceptions
  markets: MarketConfig
  blocklist: Set<string>
}

const BARCODE_RE = /^\d{8,14}$/

// Structural junk, kept as rules rather than blocklist entries because they
// describe a shape rather than a word.
const ALL_DIGITS = /^\d+$/
const HAS_URL = /https?:\/\/|www\./i

function marketTier(raw: RawOffProduct, markets: MarketConfig): 1 | 2 | null {
  const tags = new Set((raw.countries_tags ?? []).map((t) => String(t).toLowerCase()))
  if (markets.tier1.some((t) => tags.has(t))) return 1
  if (markets.tier2.some((t) => tags.has(t))) return 2
  return null
}

export function normalizeProduct(raw: RawOffProduct, ctx: NormalizeContext): NormalizeResult {
  const barcode = String(raw.code ?? '').trim()
  const reject = (reason: RejectReason, detail?: string): NormalizeResult => ({
    ok: false,
    rejected: { barcode, reason, detail },
  })

  // Absent rather than false on a current product, so this is a truthiness
  // check and not a comparison to false.
  if (raw.obsolete) return reject('obsolete')
  if (!BARCODE_RE.test(barcode)) return reject('bad-barcode', barcode || '(empty)')

  const tier = marketTier(raw, ctx.markets)
  if (tier === null) return reject('no-market')

  const warnings: NormalizeWarning[] = []
  const maker = pickBrand(raw, ctx.aliases, ctx.casing)

  const chosen = pickName(raw, Boolean(maker))
  if (!chosen) return reject('no-name')

  // Only 'other' is a problem. English is how international brands on Romanian
  // shelves arrive -- Coca-Cola Zero, Milka, Haribo -- and productEmoji.ts is
  // bilingual RO+EN, so an English name still gets a real emoji rather than the
  // shopping-bag fallback. A German- or Hungarian-only name is the one nobody
  // can type into the search box, and the gate caps that at review.
  if (chosen.lang === 'other') warnings.push('foreign-name')
  if (chosen.source === 'generic_name' || chosen.source === 'generic_name_ro') {
    warnings.push('generic-name')
  }

  const folded = normalizeSearchText(chosen.text)
  if (ctx.blocklist.has(folded)) return reject('blocklisted-name', chosen.text)
  if (ALL_DIGITS.test(folded) || folded === normalizeSearchText(barcode)) {
    return reject('blocklisted-name', chosen.text)
  }
  if (HAS_URL.test(chosen.text)) return reject('blocklisted-name', chosen.text)
  if (folded.length < 3) return reject('name-too-short', chosen.text)

  const withoutBrand = stripBrandPrefix(chosen.text, maker, ctx.aliases)
  const cased = titleCaseRo(withoutBrand, ctx.casing, ctx.aliases)

  const quantity = parseQuantity(raw.quantity, {
    productQuantity: raw.product_quantity ?? null,
    productQuantityUnit: raw.product_quantity_unit ?? null,
  })

  const withSize = appendQuantity(cased, quantity)
  const clamped = clampName(withSize, NAME_MAX)
  if (!clamped) return reject('name-too-long', withSize)
  if (clamped !== withSize) warnings.push('truncated-name')

  // maker is capped shorter than the name and pickBrand already refused
  // anything over the limit, so this is belt and braces rather than a real path.
  let finalMaker = maker
  if (finalMaker && finalMaker.length > MAKER_MAX) {
    finalMaker = null
    warnings.push('maker-dropped')
  }

  // Computed with the vendored normalizer, and used only to collapse candidates
  // against each other before load. What actually gets stored is derived again
  // by the database's product_search_text(), which stays the sole authority.
  const searchText = normalizeSearchText(`${clamped} ${finalMaker ?? ''}`)
  if (!searchText) return reject('no-name')
  // The column check would reject this anyway, and a rejected row mid-chunk is
  // worse than a logged drop.
  if (searchText.length > SEARCH_TEXT_MAX) return reject('search-text-too-long', searchText)

  const scans = Number(raw.unique_scans_n)

  const product: StagedProduct = {
    barcode,
    name: clamped,
    maker: finalMaker,
    searchText,
    key: productKey(clamped, finalMaker),
    sourceRef: barcode,
    nameLang: chosen.lang,
    nameSource: chosen.source,
    quantity,
    markets: (raw.countries_tags ?? []).map(String),
    signals: {
      // null, not 0. Absent on ~65% of the database, and reading that as
      // "nobody scans it" would drop most of the catalog at the gate.
      uniqueScans: Number.isFinite(scans) && scans > 0 ? scans : null,
      completeness: Number(raw.completeness) || 0,
      categoriesTags: (raw.categories_tags ?? []).map(String),
      hasBrand: Boolean(finalMaker),
      hasQuantity: Boolean(quantity),
      rawQuantityPresent: String(raw.quantity ?? '').trim().length > 0,
      marketTier: tier,
    },
    warnings,
  }

  return { ok: true, product }
}

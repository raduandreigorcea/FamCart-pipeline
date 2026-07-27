// Turning an Open Food Facts name into one that belongs in FamCart's catalog.
//
// House style, read off scripts/products.json: Title Case, no diacritics, size
// appended, brand kept out of the name and put in `maker`. "Apa Plata 2L",
// "Iaurt Natural 3.5% 400g", "Oua Marimea M 10 buc".
import { normalizeSearchText } from '../vendor/productSearch.ts'
import type { BrandAliasTable, CasingExceptions, NameFieldSource, RawOffProduct } from '../types.ts'

export interface NameChoice {
  text: string
  lang: 'ro' | 'en' | 'other'
  source: NameFieldSource
}

const tokens = (text: string): string[] => text.split(/\s+/).filter(Boolean)

// Diacritics off, case kept. normalizeSearchText also lowercases, which is
// wrong here -- casing is decided afterwards, by titleCaseRo.
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
}

// Cc is control characters and Cf is format characters, which is where the
// zero-width spaces, the bidi marks and the BOM all live. Written as Unicode
// properties rather than a numeric range on purpose: a source file should not
// contain the very bytes it exists to strip.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu

export function cleanRawName(text: string): string {
  return stripDiacritics(String(text ?? ''))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(INVISIBLE, ' ')
    .replace(/["“”„«»]/g, ' ')
    // A separator with nothing on one side of it, e.g. a name ending in " - ".
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/^\s*[-–—]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Which field to take the name from.
//
// `lang` is NOT the gate: in a 50-product Romanian sample only 27 said 'ro',
// and Napolact's "Bio Chefir" is filed as French. It is used only as a POSITIVE
// hint -- when it does say 'ro' it is generally right, and 2 of those 27 had no
// product_name_ro to fall back on.
//
// The real gate is product_name_ro existing at all: somebody who knew the
// product was Romanian typed it.
export function pickName(raw: RawOffProduct, hasBrand: boolean): NameChoice | null {
  const get = (key: string): string => cleanRawName(String(raw[key] ?? ''))
  const lang = String(raw.lang ?? '').toLowerCase()

  const nameRo = get('product_name_ro')
  if (nameRo) return { text: nameRo, lang: 'ro', source: 'product_name_ro' }

  const name = get('product_name')
  if (name && lang === 'ro') return { text: name, lang: 'ro', source: 'product_name' }

  const nameEn = get('product_name_en')
  if (nameEn) return { text: nameEn, lang: 'en', source: 'product_name_en' }

  if (name) return { text: name, lang: 'other', source: 'product_name' }

  // A generic name is a category ("Apa minerala naturala"), which is only a
  // product when a brand makes it one.
  if (hasBrand) {
    const genericRo = get('generic_name_ro')
    if (genericRo) return { text: genericRo, lang: 'ro', source: 'generic_name_ro' }
    const generic = get('generic_name')
    if (generic) {
      return { text: generic, lang: lang === 'ro' ? 'ro' : 'other', source: 'generic_name' }
    }
  }

  return null
}

// Every spelling of this brand worth stripping: the brand as given, plus any
// alias key that resolves to it. Folding both sides already collapses case, so
// "Sammills" in the name matches the "SamMills" brand without help.
function brandSpellings(brand: string, aliases: BrandAliasTable): string[] {
  const canonical = normalizeSearchText(brand)
  const spellings = new Set<string>([brand])
  for (const [key, value] of Object.entries(aliases.canonical ?? {})) {
    if (normalizeSearchText(value) === canonical || key === canonical) spellings.add(key)
  }
  return [...spellings].sort((a, b) => b.length - a.length)
}

// Is what is left after removing the brand still a product name?
//
// For some products the brand IS the identity, and stripping it leaves a
// modifier stranded on its own: "Coca Cola Zero" becomes "Zero", "Tuborg Ice"
// becomes "Ice". Both are worse than the mild redundancy of leaving the brand
// in, because the shopper searching for them types the brand.
//
// Measured on letters, ignoring the size, so "Ciocolata" (9) survives while
// "Zero" (4) and "Ice" (3) do not.
function keepsMeaning(rest: string): boolean {
  const letters = rest
    .split(/\s+/)
    .filter((token) => !/^[-+]?\d/.test(token))
    .join('')
    .replace(/[^\p{L}]/gu, '')
  return letters.length >= 5
}

// OFF names repeat the brand constantly: brands "Milka" with product_name
// "Milka Chocolate Bar", and also "Ciocolata Milka". The brand belongs in
// `maker`, where the UI renders it as the subtitle, so a name carrying it too
// reads as "Milka Chocolate Bar / Milka".
//
// Works on whole word tokens, never character offsets: stripping diacritics is
// not length-preserving, so any index arithmetic against a folded copy would
// silently cut the original in the wrong place.
export function stripBrandPrefix(
  name: string,
  brand: string | null,
  aliases: BrandAliasTable,
): string {
  if (!brand) return name
  const nameTokens = tokens(name)
  const folded = nameTokens.map((t) => normalizeSearchText(t))

  for (const spelling of brandSpellings(brand, aliases)) {
    const brandTokens = tokens(spelling)
      .map((t) => normalizeSearchText(t))
      .filter(Boolean)
    if (!brandTokens.length || brandTokens.length >= nameTokens.length) continue

    const matchesAt = (offset: number) => brandTokens.every((t, i) => folded[offset + i] === t)

    if (matchesAt(0)) {
      const rest = nameTokens.slice(brandTokens.length).join(' ').trim()
      if (keepsMeaning(rest)) return rest
    }

    const tail = nameTokens.length - brandTokens.length
    if (tail > 0 && matchesAt(tail)) {
      const rest = nameTokens.slice(0, tail).join(' ').trim()
      if (keepsMeaning(rest)) return rest
    }
  }

  return name
}

const isDigitLed = (token: string) => /^[-+]?\d/.test(token)

function capitalize(word: string): string {
  if (!word) return word
  return word[0].toUpperCase() + word.slice(1).toLowerCase()
}

// Title Case with the exceptions the curated catalog actually shows.
export function titleCaseRo(
  text: string,
  casing: CasingExceptions,
  aliases?: BrandAliasTable,
): string {
  const upper = new Map(casing.upper.map((w) => [normalizeSearchText(w), w]))
  const lower = new Set(casing.lower.map((w) => normalizeSearchText(w)))

  return tokens(text)
    .map((token, index) => {
      // One rule covering 2L, 500g, 1.5L and 3.5%: a token starting with a
      // digit is a measurement, so it keeps its shape -- except that the
      // catalog writes decimals with a point. Open Food Facts is full of
      // European commas ("Lapte integral 3,5%"), and "3,5%" beside the curated
      // "Lapte 3.5% 1L" reads as two different products.
      if (isDigitLed(token)) return token.replace(/(\d),(\d)/g, '$1.$2')

      const folded = normalizeSearchText(token)
      if (!folded) return token

      // A brand that reached the name keeps its own spelling (7Up, L'Or).
      const alias = aliases?.canonical?.[folded]
      if (alias) return alias

      if (upper.has(folded)) return upper.get(folded) as string
      // "Crema de Alune", not "Crema De Alune" -- but never lowercase the word
      // the name starts with.
      if (index > 0 && lower.has(folded)) return token.toLowerCase()
      // A single letter is a size code, not a word: "Oua Marimea M 10 buc".
      if (token.length === 1) return token.toUpperCase()
      // Split on the hyphen so Coca-Cola does not become Coca-cola. Apostrophes
      // are deliberately left alone: capitalizing after one gives "Lay'S".
      if (token.includes('-')) return token.split('-').map(capitalize).join('-')

      return capitalize(token)
    })
    .join(' ')
}

// product_catalog.name is capped at 120 characters, and an over-long name fails
// the whole insert. Shed the least useful parts first, and only give up if what
// is left is not a name any more.
export function clampName(name: string, max: number): string | null {
  let text = name.trim()
  if (text.length <= max) return text

  // A trailing parenthetical is almost always packaging detail.
  text = text.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (text.length <= max) return text

  const cut = text.slice(0, max + 1)
  const boundary = cut.lastIndexOf(' ')
  text = (boundary > 0 ? cut.slice(0, boundary) : cut.slice(0, max)).trim()
  // Do not leave a name ending mid-punctuation.
  text = text.replace(/[\s,;:.–—-]+$/, '')

  return text.length >= 3 ? text : null
}

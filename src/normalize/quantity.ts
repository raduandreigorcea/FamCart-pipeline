// Open Food Facts `quantity` is free text a human typed. Observed in the wild:
// "350 g", "1 l", "2,5 kg", "330 mL", "310g", "200 g,", "2000g", "6 x 0.5 L",
// "1 Serving(s) (14 G)". This turns the ones that mean something into FamCart's
// house format and gives up cleanly on the rest.
//
// House format, read off scripts/products.json rather than invented:
//   size    "2L" "1.5L" "0.5L" "500ml" "400g" "1kg"  -- no space, decimal POINT
//   count   "6 buc"                                   -- with a space, lowercase
//   both    "Apa Plata 0.5L 6 buc"                    -- size first, then count
//
// The one rule that matters and is easy to get wrong: DO NOT convert between
// units. The catalog writes bottled water as "0.5L" and cooking oil as "500ml"
// -- the same volume, in different units, because that is how each product is
// sold and labelled. Open Food Facts already carries that distinction in its
// own `quantity` string, so preserving the source unit reproduces the house
// style for free, while "helpfully" normalizing ml to L would destroy it.
// Only units the catalog never uses are folded: cl and dl to ml, mg and gr to g.
import type { ParsedQuantity, QuantityUnit } from '../types.ts'

// value + unit, optionally preceded by a "6 x " pack count.
const QUANTITY_RE = new RegExp(
  String.raw`(?:(\d{1,3})\s*[x×*]\s*)?` + // "6 x " pack count
    // The sign is captured rather than ignored: without it "-5 g" matches the
    // "5 g" inside it and a negative quantity sails through as a positive one.
    String.raw`(-?\d+(?:[.,]\d+)?)\s*` +
    String.raw`(l|litri|litru|litre|liter|liters|litres` +
    String.raw`|ml|mililitri|millilitre|milliliter` +
    String.raw`|cl|centilitri|dl` +
    String.raw`|kg|kilograme?|kilograms?` +
    String.raw`|gr|g|grame?|grams?|gramm` +
    String.raw`|mg)` +
    String.raw`(?![a-zăâîșț])`, // not the start of a longer word
  'i',
)

// A bare count: "10 buc", "6 bucati", "4 pieces", "10 oua".
const COUNT_RE = new RegExp(
  String.raw`(\d{1,3})\s*(buc|bucati|bucăți|bucati|pcs|pieces?|pack|oua|ouă|eggs?)\b`,
  'i',
)

// "1 Serving(s)", "variable", "n/a" -- present but meaningless.
const MEANINGLESS = /^(n\/?a|variable|variabil|unknown|inconnu|-+|0)$/i

function toNumber(text: string): number {
  // European decimal comma. No thousands separators seen in this field, and
  // treating "2,5" as 25 would be a silent tenfold error.
  return Number.parseFloat(text.replace(',', '.'))
}

interface FoldedUnit {
  unit: QuantityUnit
  factor: number
}

function foldUnit(raw: string): FoldedUnit | null {
  const u = raw.toLowerCase()
  if (/^(l|litri|litru|litre|liter|liters|litres)$/.test(u)) return { unit: 'L', factor: 1 }
  if (/^(ml|mililitri|millilitre|milliliter)$/.test(u)) return { unit: 'ml', factor: 1 }
  if (/^(cl|centilitri)$/.test(u)) return { unit: 'ml', factor: 10 }
  if (u === 'dl') return { unit: 'ml', factor: 100 }
  if (/^(kg|kilograme?|kilograms?)$/.test(u)) return { unit: 'kg', factor: 1 }
  if (/^(g|gr|grame?|grams?|gramm)$/.test(u)) return { unit: 'g', factor: 1 }
  if (u === 'mg') return { unit: 'g', factor: 0.001 }
  return null
}

function plausible(value: number, unit: QuantityUnit): boolean {
  if (!Number.isFinite(value) || value <= 0) return false
  // Upper bounds are generous but catch the barcode-in-the-quantity-field case
  // and stray nutrition values, which would otherwise produce "Lapte 100000g".
  if (unit === 'L') return value <= 100
  if (unit === 'ml') return value <= 100_000
  if (unit === 'kg') return value <= 200
  return value <= 200_000
}

export interface QuantityFallback {
  productQuantity?: string | number | null
  productQuantityUnit?: string | null
}

// `quantity` is the human string and is preferred: it says "1 l", which is what
// the label says. `product_quantity` is OFF's own parse into g or ml and is the
// fallback for the cases the human string cannot be read at all.
export function parseQuantity(
  raw: string | null | undefined,
  fallback?: QuantityFallback,
): ParsedQuantity | null {
  const text = String(raw ?? '')
    // Drop a parenthetical aside: "1 Serving(s) (14 G)" must not parse as 14 g.
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[,;.]\s*$/, '')
    .trim()

  if (text && !MEANINGLESS.test(text)) {
    const parsed = parseText(text)
    if (parsed) return parsed
  }
  return parseFallback(raw, fallback)
}

function parseText(text: string): ParsedQuantity | null {
  const sizeMatch = QUANTITY_RE.exec(text)
  const countMatch = COUNT_RE.exec(text)

  let size: ParsedQuantity['size'] = null
  let count: number | null = null

  if (sizeMatch) {
    const folded = foldUnit(sizeMatch[3])
    if (folded) {
      const value = round(toNumber(sizeMatch[2]) * folded.factor)
      if (plausible(value, folded.unit)) {
        size = { value, unit: folded.unit }
        if (sizeMatch[1]) count = Number.parseInt(sizeMatch[1], 10)
      }
    }
  }

  // A bare count only counts when there is no "6 x 0.5 L" pack count already,
  // so "6 x 250 ml" does not come out as both 6 and something else.
  if (count === null && countMatch) {
    const n = Number.parseInt(countMatch[1], 10)
    if (n > 0 && n <= 999) count = n
  }

  if (!size && count === null) return null
  return { size, count, raw: text }
}

function parseFallback(
  raw: string | null | undefined,
  fallback?: QuantityFallback,
): ParsedQuantity | null {
  if (!fallback) return null
  const value = round(Number(fallback.productQuantity))
  const folded = foldUnit(String(fallback.productQuantityUnit ?? 'g'))
  if (!folded || !plausible(value, folded.unit)) return null
  return {
    size: { value: round(value * folded.factor), unit: folded.unit },
    count: null,
    raw: String(raw ?? '').trim(),
  }
}

function round(value: number): number {
  // Two decimals is all the house style ever shows (1.5L, 3.5%), and it clears
  // the float dust that 0.1 * 3 leaves behind.
  return Math.round(value * 100) / 100
}

function formatNumber(value: number): string {
  // Decimal point, no trailing zeros: 2 not 2.0, 1.5 not 1.50.
  return String(Number(value.toFixed(2)))
}

export function formatQuantity(q: ParsedQuantity): string {
  const parts: string[] = []
  if (q.size) parts.push(`${formatNumber(q.size.value)}${q.size.unit}`)
  if (q.count !== null) parts.push(`${q.count} buc`)
  return parts.join(' ')
}

// Any size already written into the name. Requires a unit letter, so the fat
// percentage in "Lapte 3.5% 1L" is not mistaken for one.
const NAME_HAS_SIZE = /\b\d+(?:[.,]\d+)?\s?(l|ml|g|gr|kg|cl|buc)\b/i

// OFF names very often already carry the size, because whoever typed the name
// copied the front of the pack. Appending then gives "Lapte 1L 1L".
export function appendQuantity(name: string, q: ParsedQuantity | null): string {
  const base = name.trim()
  if (!q) return base
  const formatted = formatQuantity(q)
  if (!formatted) return base
  if (NAME_HAS_SIZE.test(base)) return base
  return `${base} ${formatted}`
}

import { describe, it, expect } from 'vitest'
import { parseQuantity, formatQuantity, appendQuantity } from '../src/normalize/quantity.ts'

// Every string in this file was observed in the real dump or the Romanian API
// sample on 2026-07-27. Nothing here is invented.
const fmt = (raw: string) => {
  const q = parseQuantity(raw)
  return q ? formatQuantity(q) : null
}

describe('parseQuantity', () => {
  it('reads the plain cases', () => {
    expect(fmt('350 g')).toBe('350g')
    expect(fmt('1 l')).toBe('1L')
    expect(fmt('330 g')).toBe('330g')
    expect(fmt('125 g')).toBe('125g')
    expect(fmt('2 kg')).toBe('2kg')
  })

  it('reads them without the space too', () => {
    expect(fmt('310g')).toBe('310g')
    expect(fmt('2000g')).toBe('2000g')
    expect(fmt('500ml')).toBe('500ml')
  })

  it('takes a comma as a decimal point', () => {
    // "2,5 kg" as 25kg would be a silent tenfold error on a real product.
    expect(fmt('2,5 kg')).toBe('2.5kg')
    expect(fmt('0,5 l')).toBe('0.5L')
    expect(fmt('1,5L')).toBe('1.5L')
  })

  it('ignores the case of the unit', () => {
    expect(fmt('330 mL')).toBe('330ml')
    expect(fmt('1 L')).toBe('1L')
  })

  it('tolerates trailing punctuation', () => {
    // Real record: SanoVita Tofu natur, quantity "200 g,"
    expect(fmt('200 g,')).toBe('200g')
    expect(fmt('400 g.')).toBe('400g')
  })

  it('folds only the units the catalog never writes', () => {
    expect(fmt('50 cl')).toBe('500ml')
    expect(fmt('2 dl')).toBe('200ml')
    expect(fmt('500 gr')).toBe('500g')
    expect(fmt('250 grame')).toBe('250g')
  })

  // The catalog writes bottled water as 0.5L and cooking oil as 500ml. Both are
  // correct, and converting either way would destroy a real distinction.
  it('never converts between units the catalog does use', () => {
    expect(fmt('0.5 l')).toBe('0.5L')
    expect(fmt('500 ml')).toBe('500ml')
    expect(fmt('1000 g')).toBe('1000g')
    expect(fmt('1 kg')).toBe('1kg')
  })

  it('reads a pack count with a size', () => {
    expect(fmt('6 x 0.5 L')).toBe('0.5L 6 buc')
    expect(fmt('2 x 250ml')).toBe('250ml 2 buc')
    expect(fmt('4 × 100 g')).toBe('100g 4 buc')
  })

  it('reads a bare count', () => {
    expect(fmt('10 buc')).toBe('10 buc')
    expect(fmt('6 bucati')).toBe('6 buc')
    expect(fmt('4 pieces')).toBe('4 buc')
  })

  it('gives up on text that means nothing', () => {
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity(null)).toBeNull()
    expect(parseQuantity('variable')).toBeNull()
    expect(parseQuantity('n/a')).toBeNull()
    expect(parseQuantity('gros')).toBeNull()
    // A bare number has no unit, so there is nothing to write.
    expect(parseQuantity('500')).toBeNull()
  })

  it('does not read a parenthetical as the quantity', () => {
    // Real record: "1 Serving(s) (14 G)" -- 14g is the serving, not the pack.
    expect(parseQuantity('1 Serving(s) (14 G)')).toBeNull()
  })

  it('rejects implausible values rather than writing them into a name', () => {
    // A barcode typed into the quantity field.
    expect(parseQuantity('5941234567890 g')).toBeNull()
    expect(parseQuantity('0 g')).toBeNull()
    expect(parseQuantity('-5 g')).toBeNull()
  })

  it('falls back to OFF own parse when the human string is unreadable', () => {
    const q = parseQuantity('1 Serving(s) (14 G)', {
      productQuantity: 330,
      productQuantityUnit: 'g',
    })
    expect(q && formatQuantity(q)).toBe('330g')
  })

  it('prefers the human string over the fallback', () => {
    // The label says 1 l; OFF normalized it to 1000 ml. The label wins, because
    // that is what the shopper sees on the shelf.
    const q = parseQuantity('1 l', { productQuantity: 1000, productQuantityUnit: 'ml' })
    expect(q && formatQuantity(q)).toBe('1L')
  })

  it('ignores a fallback that is itself junk', () => {
    expect(parseQuantity('variable', { productQuantity: 0, productQuantityUnit: 'g' })).toBeNull()
  })
})

describe('appendQuantity', () => {
  const q = (raw: string) => parseQuantity(raw)

  it('appends the size in house style', () => {
    expect(appendQuantity('Iaurt Grecesc', q('400 g'))).toBe('Iaurt Grecesc 400g')
    expect(appendQuantity('Apa Plata', q('2 l'))).toBe('Apa Plata 2L')
  })

  it('puts the count after the size, the way the catalog does', () => {
    expect(appendQuantity('Apa Plata', q('6 x 0.5 L'))).toBe('Apa Plata 0.5L 6 buc')
    expect(appendQuantity('Oua Marimea M', q('10 buc'))).toBe('Oua Marimea M 10 buc')
  })

  it('leaves a name that already states its size alone', () => {
    // OFF names very often carry the size, because whoever typed the name
    // copied the front of the pack.
    expect(appendQuantity('Lapte integral 1L', q('1 l'))).toBe('Lapte integral 1L')
    expect(appendQuantity('Bulion 310g', q('310 g'))).toBe('Bulion 310g')
    expect(appendQuantity('Ciocolata 100 g', q('100 g'))).toBe('Ciocolata 100 g')
  })

  it('does not mistake a fat percentage for a size', () => {
    expect(appendQuantity('Lapte integral 3,5%', q('1 l'))).toBe('Lapte integral 3,5% 1L')
  })

  it('is a no-op when there is no quantity', () => {
    expect(appendQuantity('Bulion', null)).toBe('Bulion')
  })
})

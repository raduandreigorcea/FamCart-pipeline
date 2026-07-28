import { describe, it, expect } from 'vitest'
import { normalizeProduct } from '../src/normalize/index.ts'
import {
  pickName,
  stripBrandPrefix,
  titleCaseRo,
  clampName,
  cleanRawName,
  trimNameEdges,
} from '../src/normalize/name.ts'
import { pickBrand, brandParts } from '../src/normalize/brand.ts'
import aliases from '../data/brand-aliases.json' with { type: 'json' }
import casing from '../data/casing-exceptions.json' with { type: 'json' }
import markets from '../data/markets.json' with { type: 'json' }
import blocklistFile from '../data/name-blocklist.json' with { type: 'json' }
import realRomanianProducts from './fixtures/off-romania.json' with { type: 'json' }
import type { RawOffProduct } from '../src/types.ts'

const ctx = {
  aliases,
  casing,
  markets,
  blocklist: new Set(blocklistFile.names),
}

const RO = { countries_tags: ['en:romania'] }
const norm = (raw: Partial<RawOffProduct>) => normalizeProduct({ ...RO, ...raw } as RawOffProduct, ctx)
const ok = (raw: Partial<RawOffProduct>) => {
  const r = norm(raw)
  if (!r.ok) throw new Error(`expected a product, got rejected: ${r.rejected.reason}`)
  return r.product
}

describe('cleanRawName', () => {
  it('strips diacritics but keeps the casing for titleCaseRo to decide', () => {
    expect(cleanRawName('Bio Chefir 3,5% grăsime')).toBe('Bio Chefir 3,5% grasime')
    expect(cleanRawName('Brânză Telemea')).toBe('Branza Telemea')
  })

  it('cleans up entities, quotes and stray separators', () => {
    expect(cleanRawName('Lapte &amp; Miere')).toBe('Lapte & Miere')
    expect(cleanRawName('  Tortilla Chips -  ')).toBe('Tortilla Chips')
    expect(cleanRawName('“Bulion”')).toBe('Bulion')
  })
})

describe('pickName', () => {
  it('prefers the Romanian name', () => {
    const choice = pickName(
      { product_name: 'Bio chefir', product_name_ro: 'Bio Chefir 3,5% grăsime', lang: 'fr' },
      true,
    )
    expect(choice).toMatchObject({ text: 'Bio Chefir 3,5% grasime', lang: 'ro' })
  })

  // The real Napolact record is filed as lang 'fr'. Gating on lang would have
  // sent a genuine Romanian dairy product to the review pile.
  it('ignores a lang that contradicts an existing Romanian name', () => {
    expect(pickName({ product_name_ro: 'Bulion', lang: 'it' }, true)?.lang).toBe('ro')
  })

  it('trusts lang when it does say ro and there is nothing better', () => {
    expect(pickName({ product_name: 'Tuborg Ice', lang: 'ro' }, true)).toMatchObject({
      lang: 'ro',
      source: 'product_name',
    })
  })

  it('falls back to English, then to whatever there is', () => {
    expect(pickName({ product_name_en: 'Milk chocolate', lang: 'fr' }, true)?.lang).toBe('en')
    expect(pickName({ product_name: 'Saucisses apéro', lang: 'fr' }, true)?.lang).toBe('other')
  })

  it('takes a generic name only when a brand makes it a product', () => {
    const raw = { generic_name: 'Apa minerala naturala', lang: 'ro' }
    expect(pickName(raw, true)?.source).toBe('generic_name')
    expect(pickName(raw, false)).toBeNull()
  })

  it('gives up when there is no name at all', () => {
    expect(pickName({ brands: 'Dorna' }, true)).toBeNull()
  })
})

describe('stripBrandPrefix', () => {
  it('removes a leading brand', () => {
    expect(stripBrandPrefix('Milka Chocolate Bar', 'Milka', aliases)).toBe('Chocolate Bar')
  })

  it('removes a trailing brand', () => {
    expect(stripBrandPrefix('Ciocolata Milka', 'Milka', aliases)).toBe('Ciocolata')
  })

  it('does not care how the brand was capitalized', () => {
    // Real record: brands "SamMills", product_name "Sammills Tortilla Chips".
    expect(stripBrandPrefix('Sammills Tortilla Chips', 'SamMills', aliases)).toBe('Tortilla Chips')
    expect(stripBrandPrefix('SanoVita Tofu natur', 'SanoVita', aliases)).toBe('Tofu natur')
  })

  it('handles a multi-word brand', () => {
    expect(stripBrandPrefix('Aqua Carpatica Apa Plata', 'Aqua Carpatica', aliases)).toBe('Apa Plata')
  })

  it('keeps the name when the name IS the brand', () => {
    expect(stripBrandPrefix('Nutella', 'Nutella', aliases)).toBe('Nutella')
    expect(stripBrandPrefix('Milka', 'Milka', aliases)).toBe('Milka')
  })

  // Stripping here strands a modifier: "Zero" and "Ice" are not products, and
  // the shopper looking for them types the brand.
  it('keeps the brand when removing it would leave a bare modifier', () => {
    expect(stripBrandPrefix('Coca Cola Zero', 'Coca-Cola', aliases)).toBe('Coca Cola Zero')
    expect(stripBrandPrefix('Tuborg Ice', 'Tuborg', aliases)).toBe('Tuborg Ice')
  })

  it('leaves a name that only mentions the brand in the middle', () => {
    expect(stripBrandPrefix('Ciocolata Milka cu Alune', 'Milka', aliases)).toBe(
      'Ciocolata Milka cu Alune',
    )
  })

  it('is a no-op without a brand', () => {
    expect(stripBrandPrefix('Bulion', null, aliases)).toBe('Bulion')
  })
})

describe('titleCaseRo', () => {
  it('title-cases words but leaves measurements alone', () => {
    expect(titleCaseRo('iaurt natural 3.5% 400g', casing)).toBe('Iaurt Natural 3.5% 400g')
    expect(titleCaseRo('APA PLATA 2L', casing)).toBe('Apa Plata 2L')
  })

  it('keeps Romanian function words lowercase, except when they lead', () => {
    // The curated catalog reads "Crema de Alune", not "Crema De Alune".
    expect(titleCaseRo('crema de alune', casing)).toBe('Crema de Alune')
    expect(titleCaseRo('chipsuri cu smantana', casing)).toBe('Chipsuri cu Smantana')
    expect(titleCaseRo('de la ferma', casing)).toBe('De la Ferma')
  })

  // OFF is full of European commas. "Lapte 3,5%" sitting beside the curated
  // "Lapte 3.5% 1L" reads as two different products.
  it('writes decimals with a point, the way the catalog does', () => {
    expect(titleCaseRo('lapte integral 3,5%', casing)).toBe('Lapte Integral 3.5%')
    expect(titleCaseRo('radler 0,0% 0.33L', casing)).toBe('Radler 0.0% 0.33L')
  })

  it('leaves size codes and acronyms alone', () => {
    expect(titleCaseRo('oua marimea m 10 buc', casing)).toBe('Oua Marimea M 10 buc')
    expect(titleCaseRo('lapte uht 1.5% 1L', casing)).toBe('Lapte UHT 1.5% 1L')
  })

  it('does not break a hyphenated brand', () => {
    expect(titleCaseRo('coca-cola zero', casing)).toBe('Coca-Cola Zero')
  })

  it('does not capitalize after an apostrophe', () => {
    expect(titleCaseRo("lay's sare", casing)).toBe("Lay's Sare")
  })
})

describe('pickBrand', () => {
  it('reads both the dump shape and the API shape', () => {
    expect(brandParts('Tetley,  American Power Products  Inc.')).toEqual([
      'Tetley',
      'American Power Products Inc.',
    ])
    expect(brandParts(['Poretti', 'Angelo Poretti'])).toEqual(['Poretti', 'Angelo Poretti'])
  })

  it('takes the most specific brand, which OFF puts first', () => {
    expect(pickBrand({ brands: ['Poretti', 'Carlsberg'] }, aliases, casing)).toBe('Poretti')
  })

  it('applies the canonical spelling', () => {
    expect(pickBrand({ brands: 'COCA COLA' }, aliases, casing)).toBe('Coca-Cola')
    expect(pickBrand({ brands: 'sammills' }, aliases, casing)).toBe('SamMills')
  })

  it('title-cases a brand it has never seen', () => {
    expect(pickBrand({ brands: 'boromir' }, aliases, casing)).toBe('Boromir')
  })

  it('treats a placeholder brand as no brand', () => {
    expect(pickBrand({ brands: 'Unknown' }, aliases, casing)).toBeNull()
    expect(pickBrand({ brands: 'sans marque' }, aliases, casing)).toBeNull()
    expect(pickBrand({ brands: '' }, aliases, casing)).toBeNull()
  })

  it('skips past a placeholder to a real brand', () => {
    expect(pickBrand({ brands: 'unknown,Dorna' }, aliases, casing)).toBe('Dorna')
  })

  // All three were found in the first 10,000 Romanian products, not imagined.
  it('drops the retailer annotation store brands carry', () => {
    expect(pickBrand({ brands: 'Pilos ( Lidl )' }, aliases, casing)).toBe('Pilos')
    expect(pickBrand({ brands: 'Golden Sun (lidl)' }, aliases, casing)).toBe('Golden Sun')
    expect(pickBrand({ brands: 'Hemp Up! (by Canah)' }, aliases, casing)).toBe('Hemp Up!')
  })

  it('treats a legal notice in the brand field as no brand', () => {
    expect(
      pickBrand({ brands: '®reg. Trademark Of Societe Des Produits Nestle S. A.' }, aliases, casing),
    ).toBeNull()
  })

  it('rejects a barcode in the brand field but keeps short numeric brands', () => {
    expect(pickBrand({ brands: '4388860451108' }, aliases, casing)).toBeNull()
    // 365 is Mega Image's private label and 7 Days is a real bakery, so this
    // cannot simply reject anything numeric.
    expect(pickBrand({ brands: '365' }, aliases, casing)).toBe('365')
    expect(pickBrand({ brands: '7 Days' }, aliases, casing)).toBe('7 Days')
  })

  it('falls through a bracket-only part to the next brand', () => {
    expect(pickBrand({ brands: ['( Lidl )', 'Pilos'] }, aliases, casing)).toBe('Pilos')
  })
})

describe('trimNameEdges', () => {
  // What stripping the brand leaves behind when the two were separated by
  // punctuation. All of these reached the live catalog before the fix.
  it('drops the separator a stripped brand prefix leaves behind', () => {
    expect(trimNameEdges('- Tortilla Chips Nacho')).toBe('Tortilla Chips Nacho')
    expect(trimNameEdges('– Salam Victoria 100g')).toBe('Salam Victoria 100g')
    expect(trimNameEdges('/ Mustar Iute 300g')).toBe('Mustar Iute 300g')
  })

  it('drops a retailer shelf code', () => {
    expect(trimNameEdges('91060 Franzela Neagra 300g')).toBe('Franzela Neagra 300g')
    expect(trimNameEdges('06258 Franzeluta Alba 150g')).toBe('Franzeluta Alba 150g')
  })

  it('keeps numbers that are part of the product', () => {
    expect(trimNameEdges('3 Minute Paste Fusilli 500g')).toBe('3 Minute Paste Fusilli 500g')
    expect(trimNameEdges('7 Days Double 60g')).toBe('7 Days Double 60g')
    expect(trimNameEdges('1000 Insule Sos 250ml')).toBe('1000 Insule Sos 250ml')
    expect(trimNameEdges('85% Dark Strong 100g')).toBe('85% Dark Strong 100g')
  })

  it('leaves a leading hash alone -- it is part of the name', () => {
    expect(trimNameEdges('#whatthefanta 250ml')).toBe('#whatthefanta 250ml')
  })

  it('will not strip a code down to a single word', () => {
    expect(trimNameEdges('91060 Franzela')).toBe('91060 Franzela')
  })
})

describe('clampName', () => {
  it('leaves a short name alone', () => {
    expect(clampName('Apa Plata 2L', 120)).toBe('Apa Plata 2L')
  })

  it('drops a trailing parenthetical before it truncates', () => {
    const name = `Iaurt Grecesc 400g (${'x'.repeat(120)})`
    expect(clampName(name, 120)).toBe('Iaurt Grecesc 400g')
  })

  it('truncates on a word boundary, not mid-word', () => {
    const clamped = clampName(`${'Iaurt Grecesc Natural '.repeat(10)}400g`, 60)
    expect(clamped!.length).toBeLessThanOrEqual(60)
    expect(clamped!.endsWith('Iaurt') || clamped!.endsWith('Grecesc') || clamped!.endsWith('Natural')).toBe(true)
  })

  it('gives up when nothing usable is left', () => {
    expect(clampName('ab', 1)).toBeNull()
  })
})

describe('normalizeProduct', () => {
  it('turns a real Romanian record into house style', () => {
    const product = ok({
      code: '5941355000688',
      product_name: 'Lapte integral 3,5%',
      product_name_ro: 'Lapte integral 3,5%',
      brands: 'Zuzu',
      quantity: '1 l',
      lang: 'ro',
      unique_scans_n: 64,
      completeness: 0.6875,
    })
    expect(product.name).toBe('Lapte Integral 3.5% 1L')
    expect(product.maker).toBe('Zuzu')
    expect(product.nameLang).toBe('ro')
    expect(product.warnings).toEqual([])
    expect(product.signals.uniqueScans).toBe(64)
  })

  it('strips the brand out of the name and into maker', () => {
    const product = ok({
      code: '5941882803400',
      product_name_ro: 'SanoVita Tofu natur',
      brands: 'SanoVita',
      quantity: '200 g,',
      lang: 'ro',
    })
    expect(product.name).toBe('Tofu Natur 200g')
    expect(product.maker).toBe('SanoVita')
  })

  it('flags a foreign name instead of pretending it is Romanian', () => {
    const product = ok({
      code: '5400113582946',
      product_name: 'Saucisses apéro',
      brands: 'Delhaize',
      quantity: '400 g',
      lang: 'fr',
    })
    expect(product.nameLang).toBe('other')
    expect(product.warnings).toContain('foreign-name')
  })

  it('treats an absent scan count as no signal rather than zero', () => {
    const product = ok({ code: '5942045380370', product_name_ro: 'Tuborg Ice', brands: 'Tuborg' })
    expect(product.signals.uniqueScans).toBeNull()
  })

  it('records the market tier', () => {
    expect(ok({ code: '5941000000001', product_name_ro: 'Bulion' }).signals.marketTier).toBe(1)
    expect(
      ok({
        code: '4000417025005',
        product_name: 'Vollmilch',
        countries_tags: ['en:germany'],
      }).signals.marketTier,
    ).toBe(2)
  })

  it('rejects what is not a product', () => {
    expect(norm({ code: 'ABC', product_name_ro: 'Bulion' })).toMatchObject({
      ok: false,
      rejected: { reason: 'bad-barcode' },
    })
    expect(norm({ code: '5941000000001', product_name_ro: 'test' })).toMatchObject({
      rejected: { reason: 'blocklisted-name' },
    })
    expect(norm({ code: '5941000000001', product_name_ro: '5941000000001' })).toMatchObject({
      rejected: { reason: 'blocklisted-name' },
    })
    expect(norm({ code: '5941000000001', product_name_ro: 'ab' })).toMatchObject({
      rejected: { reason: 'name-too-short' },
    })
    expect(norm({ code: '5941000000001', brands: 'Dorna' })).toMatchObject({
      rejected: { reason: 'no-name' },
    })
    expect(norm({ code: '5941000000001', product_name_ro: 'Bulion', obsolete: 1 })).toMatchObject({
      rejected: { reason: 'obsolete' },
    })
    expect(
      norm({ code: '5941000000001', product_name_ro: 'Bulion', countries_tags: ['en:japan'] }),
    ).toMatchObject({ rejected: { reason: 'no-market' } })
  })

  it('produces a searchText the database would derive the same way', () => {
    const product = ok({ code: '5941000000001', product_name_ro: 'Apă Plată 2L', brands: 'Dorna' })
    // The pgTAP canary asserts product_search_text() gives exactly this.
    expect(product.searchText).toBe('apa plata 2l dorna')
  })
})

// The real test: 48 records pulled from Open Food Facts, not written by hand.
describe('against 48 real Open Food Facts records', () => {
  const results = (realRomanianProducts as RawOffProduct[]).map((raw) =>
    normalizeProduct(raw, ctx),
  )
  const accepted = results.flatMap((r) => (r.ok ? [r.product] : []))

  it('accepts most of them', () => {
    expect(accepted.length).toBeGreaterThan(realRomanianProducts.length * 0.8)
  })

  it('never produces a name or maker the database would reject', () => {
    for (const p of accepted) {
      expect(p.name.length).toBeGreaterThanOrEqual(1)
      expect(p.name.length).toBeLessThanOrEqual(120)
      expect(p.searchText.length).toBeLessThanOrEqual(200)
      if (p.maker) expect(p.maker.length).toBeLessThanOrEqual(60)
    }
  })

  it('never leaves a diacritic in a name', () => {
    for (const p of accepted) {
      expect(p.name).toBe(p.name.normalize('NFD').replace(/\p{Diacritic}/gu, ''))
    }
  })

  it('never writes the size into the name twice', () => {
    for (const p of accepted) {
      const sizes = p.name.match(/\b\d+(?:[.,]\d+)?\s?(l|ml|g|kg)\b/gi) ?? []
      expect(sizes.length).toBeLessThanOrEqual(1)
    }
  })

  // The brand belongs in `maker`, where the UI renders it as the subtitle --
  // unless removing it would strand a bare modifier ("Coca Cola Zero" -> "Zero",
  // "Tuborg Ice" -> "Ice"), in which case the redundancy is the lesser evil.
  it('only leaves the brand in the name when removing it would gut the name', () => {
    for (const p of accepted) {
      if (!p.maker) continue
      const words = p.name.split(/\s+/)
      if (words[0].toLowerCase() !== p.maker.toLowerCase()) continue

      const remainder = words
        .slice(1)
        .filter((w) => !/^[-+]?\d/.test(w))
        .join('')
        .replace(/[^\p{L}]/gu, '')
      expect(remainder.length).toBeLessThan(5)
    }
  })
})

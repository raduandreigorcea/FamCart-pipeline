import { describe, it, expect } from 'vitest'
import { scoreProduct, importedBaseWeight } from '../src/score/score.ts'
import { applyGate } from '../src/score/gate.ts'
import { loadDecisions, pendingReview } from '../src/score/decisions.ts'
import { normalizeProduct } from '../src/normalize/index.ts'
import gate from '../data/gate.json' with { type: 'json' }
import aliases from '../data/brand-aliases.json' with { type: 'json' }
import casing from '../data/casing-exceptions.json' with { type: 'json' }
import markets from '../data/markets.json' with { type: 'json' }
import blocklistFile from '../data/name-blocklist.json' with { type: 'json' }
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DecisionIndex, RawOffProduct, ScoredProduct, StagedProduct } from '../src/types.ts'

const ctx = { aliases, casing, markets, blocklist: new Set(blocklistFile.names) }

function stage(raw: Partial<RawOffProduct>): StagedProduct {
  const result = normalizeProduct(
    { countries_tags: ['en:romania'], ...raw } as RawOffProduct,
    ctx,
  )
  if (!result.ok) throw new Error(`fixture did not normalize: ${result.rejected.reason}`)
  return result.product
}

const judge = (raw: Partial<RawOffProduct>, decisions: DecisionIndex = new Map()) => {
  const product = stage(raw)
  const score = scoreProduct(product, gate.weights)
  return { product, score, ...applyGate(product, score, decisions, gate) }
}

// A well-filled Romanian product: the case that must not need a human.
const GOOD = {
  code: '5941355000688',
  product_name_ro: 'Lapte integral 3,5%',
  brands: 'Zuzu',
  quantity: '1 l',
  lang: 'ro',
  unique_scans_n: 64,
  completeness: 0.6875,
  categories_tags: ['en:dairies', 'en:milks'],
}

describe('scoreProduct', () => {
  it('scores a well-filled Romanian product highly', () => {
    const { score } = judge(GOOD)
    expect(score.total).toBeGreaterThanOrEqual(gate.autoMin)
    expect(score.flags).toEqual([])
  })

  it('scores an English name below an equivalent Romanian one', () => {
    const ro = judge(GOOD).score.total
    const en = judge({ ...GOOD, product_name_ro: undefined, product_name_en: 'Whole milk 3.5%' })
      .score.total
    expect(en).toBeLessThan(ro)
  })

  it('does not punish a missing scan count as if it were zero popularity', () => {
    // Absent on ~65% of the database. Treating it as unpopular would drop most
    // of the catalog at the gate.
    const { score } = judge({ ...GOOD, unique_scans_n: undefined })
    expect(score.parts.popularity).toBe(0)
    expect(score.total).toBeGreaterThanOrEqual(gate.autoMin)
  })

  it('clamps completeness, which really does exceed 1', () => {
    // Measured range in the dump is 0 .. 1.1.
    const { score } = judge({ ...GOOD, completeness: 1.1 })
    expect(score.parts.completeness).toBe(gate.weights.completenessMax)
  })

  it('gives partial credit for a quantity it could not parse', () => {
    const parsed = judge(GOOD).score.parts.quantity
    const unreadable = judge({ ...GOOD, quantity: '1 Serving(s)' }).score.parts.quantity
    const absent = judge({ ...GOOD, quantity: undefined }).score.parts.quantity
    expect(parsed).toBe(gate.weights.quantityParsed)
    expect(unreadable).toBe(gate.weights.quantityUnparseable)
    expect(absent).toBe(0)
  })

  // Shouting is a formatting problem, and formatting is repaired rather than
  // penalized: by the time scoring runs, titleCaseRo has already fixed it.
  it('does not penalize a name that was shouting, because it no longer is', () => {
    const { product, score } = judge({
      ...GOOD,
      product_name_ro: undefined,
      product_name: 'LAPTE INTEGRAL',
      lang: 'ro',
    })
    expect(product.name).toBe('Lapte Integral 1L')
    expect(score.parts.sanity).toBe(0)
  })

  it('flags a name that is just the brand again', () => {
    const { score } = judge({ ...GOOD, product_name_ro: 'Zuzu', quantity: undefined })
    expect(score.flags).toContain('name-is-brand')
  })
})

describe('applyGate', () => {
  it('auto-loads a good Romanian product', () => {
    expect(judge(GOOD).verdict).toBe('auto')
  })

  it('auto-loads a good English-named product too', () => {
    // Decided 2026-07-27: international brands on Romanian shelves arrive in
    // English, and productEmoji.ts is bilingual so they still get an emoji.
    const result = judge({
      ...GOOD,
      product_name_ro: undefined,
      product_name_en: 'Coca-Cola Zero',
      brands: 'Coca-Cola',
      unique_scans_n: 500,
      completeness: 0.9,
    })
    expect(result.verdict).toBe('auto')
  })

  it('sends a foreign name to review however complete it is', () => {
    const result = judge({
      ...GOOD,
      product_name_ro: undefined,
      product_name: 'Saucisses apéro',
      lang: 'fr',
      unique_scans_n: 5000,
      completeness: 1,
    })
    expect(result.verdict).toBe('review')
    expect(result.reason).toBe('foreign-name')
  })

  it('sends a product from outside the home market to review', () => {
    const result = judge({ ...GOOD, countries_tags: ['en:germany'] })
    expect(result.verdict).toBe('review')
    expect(result.reason).toBe('outside-home-market')
  })

  it('drops an entry with neither a scan nor a brand', () => {
    const result = judge({
      code: '5941000000009',
      product_name_ro: 'Produs Oarecare',
      brands: 'unknown',
      unique_scans_n: undefined,
    })
    expect(result.verdict).toBe('drop')
    expect(result.reason).toBe('no-scans-no-brand')
  })

  it('drops anything under the review threshold', () => {
    const result = judge({
      code: '5941000000010',
      product_name_ro: 'X Y',
      brands: 'Dorna',
      unique_scans_n: 1,
      completeness: 0.1,
    })
    expect(result.verdict).toBe('drop')
  })

  // The reason decisions are keyed by barcode: they have to outlive the score.
  it('honours a recorded reject even when the score would auto-load it', () => {
    const decisions: DecisionIndex = new Map([
      [GOOD.code, { barcode: GOOD.code, verdict: 'reject', decidedAt: '2026-07-27' }],
    ])
    const result = judge(GOOD, decisions)
    expect(result.verdict).toBe('drop')
    expect(result.reason).toBe('decided-reject')
  })

  it('honours a recorded approve even when the score would drop it', () => {
    const raw = { code: '5941000000011', product_name: 'Saucisses apéro', brands: 'Delhaize', lang: 'fr' }
    const decisions: DecisionIndex = new Map([
      [raw.code, { barcode: raw.code, verdict: 'approve', decidedAt: '2026-07-27' }],
    ])
    expect(judge(raw, decisions).verdict).toBe('auto')
  })
})

describe('decisions file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'famcart-decisions-'))
  const path = join(dir, 'decisions.jsonl')

  it('reads verdicts, last line winning', () => {
    writeFileSync(
      path,
      [
        '{"barcode":"5941000000001","verdict":"approve","decidedAt":"2026-07-01"}',
        '{"barcode":"5941000000002","verdict":"reject","decidedAt":"2026-07-01"}',
        '{"barcode":"5941000000001","verdict":"reject","decidedAt":"2026-07-27"}',
      ].join('\n'),
      'utf8',
    )
    const index = loadDecisions(path)
    expect(index.size).toBe(2)
    // Changing your mind is an append, not an edit.
    expect(index.get('5941000000001')?.verdict).toBe('reject')
  })

  it('survives a malformed line rather than losing every verdict after it', () => {
    writeFileSync(
      path,
      [
        '{"barcode":"5941000000001","verdict":"approve","decidedAt":"2026-07-01"}',
        'this is not json',
        '{"barcode":"5941000000003","verdict":"approve","decidedAt":"2026-07-01"}',
      ].join('\n'),
      'utf8',
    )
    expect(loadDecisions(path).size).toBe(2)
  })

  it('returns nothing for a file that does not exist yet', () => {
    expect(loadDecisions(join(dir, 'nope.jsonl')).size).toBe(0)
  })

  it('queues only undecided review-band products, best score first', () => {
    const mk = (barcode: string, total: number, verdict: 'review' | 'auto') =>
      ({ product: { barcode }, score: { total }, verdict, reason: '' }) as unknown as ScoredProduct
    const scored = [mk('1', 45, 'review'), mk('2', 58, 'review'), mk('3', 90, 'auto')]
    const decisions: DecisionIndex = new Map([
      ['1', { barcode: '1', verdict: 'approve', decidedAt: '2026-07-27' }],
    ])
    expect(pendingReview(scored, decisions).map((s) => s.product.barcode)).toEqual(['2'])
  })
})

describe('importedBaseWeight', () => {
  it('stays strictly inside the band between contributed and curated-ordinary', () => {
    // Curated: 100 staple, 10 ordinary. Contributed arrives at 0.
    for (const scans of [null, 0, 1, 3, 10, 100, 1000, 10_000, 1_000_000]) {
      const weight = importedBaseWeight(scans)
      expect(weight).toBeGreaterThanOrEqual(1)
      expect(weight).toBeLessThanOrEqual(9)
    }
  })

  it('ranks a widely-scanned product above an unknown one', () => {
    expect(importedBaseWeight(10_000)).toBeGreaterThan(importedBaseWeight(10))
    expect(importedBaseWeight(10)).toBeGreaterThan(importedBaseWeight(null))
  })

  it('treats an absent scan count as the bottom of the band, not as an error', () => {
    expect(importedBaseWeight(null)).toBe(1)
    expect(importedBaseWeight(0)).toBe(1)
  })
})

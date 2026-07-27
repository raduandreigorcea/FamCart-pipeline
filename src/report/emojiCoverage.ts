// Which imported products render as the shopping-bag fallback, and what to add
// to productEmoji.ts to fix the biggest gaps.
//
// The app has no category column; a product's icon comes entirely from
// getProductEmoji matching Romanian and English keywords against its name. Any
// word the table has never heard of silently falls through to the bag. At 256
// curated products that was manageable by hand. At tens of thousands it needs
// pointing at.
//
// This uses the VENDORED productEmoji.ts, so the report is exactly what the app
// will render rather than an approximation of it.
import { getProductEmoji } from '../vendor/productEmoji.ts'
import { normalizeSearchText } from '../vendor/productSearch.ts'
import { importedBaseWeight } from '../score/score.ts'
import type { StagedProduct } from '../types.ts'

export const FALLBACK_EMOJI = '🛍️'

// Words that are never the thing being bought.
const STOPWORDS = new Set<string>([
  'de', 'cu', 'si', 'la', 'din', 'pentru', 'fara', 'in', 'pe', 'a', 'al', 'ale',
  'bio', 'eco', 'natural', 'naturala', 'clasic', 'clasica', 'original',
  'the', 'of', 'and', 'with', 'for', 'buc',
])

const isMeasurement = (token: string) => /^\d/.test(token) || /^\d+[a-z]*$/.test(token)

export interface EmojiCoverageRow {
  word: string
  occurrences: number
  weightedScore: number
  sampleNames: string[]
  topCategoryTags: string[]
  shadowedBy?: string
}

// In Romanian the head noun leads: "Iaurt Grecesc 400g" is a yoghurt, and the
// first word is the one worth teaching the table.
function headToken(product: StagedProduct): string | null {
  const brandTokens = new Set(
    (product.maker ? normalizeSearchText(product.maker).split(' ') : []).filter(Boolean),
  )
  for (const raw of normalizeSearchText(product.name).split(' ')) {
    // normalizeSearchText keeps punctuation, so "originals:" would be suggested
    // as a keyword complete with its colon -- and productEmoji matches whole
    // words, so pasting that in would never fire.
    const token = raw.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '')
    if (!token || isMeasurement(raw) || STOPWORDS.has(token) || brandTokens.has(token)) continue
    if (token.length < 3) continue
    return token
  }
  return null
}

interface Bucket {
  count: number
  weight: number
  names: string[]
  categories: Map<string, number>
}

export function buildEmojiCoverage(accepted: StagedProduct[], limit: number): EmojiCoverageRow[] {
  const buckets = new Map<string, Bucket>()

  for (const product of accepted) {
    if (getProductEmoji(product.name, product.maker ?? '') !== FALLBACK_EMOJI) continue

    const word = headToken(product)
    if (!word) continue

    const bucket: Bucket = buckets.get(word) ?? {
      count: 0,
      weight: 0,
      names: [],
      categories: new Map<string, number>(),
    }
    bucket.count += 1
    bucket.weight += importedBaseWeight(product.signals.uniqueScans)
    if (bucket.names.length < 3) bucket.names.push(product.name)
    for (const tag of product.signals.categoriesTags) {
      bucket.categories.set(tag, (bucket.categories.get(tag) ?? 0) + 1)
    }
    buckets.set(word, bucket)
  }

  const rows: EmojiCoverageRow[] = [...buckets.entries()].map(([word, bucket]) => ({
    word,
    occurrences: bucket.count,
    // Ranked by how much shelf the gap covers rather than raw frequency, so a
    // word on 40 well-ranked staples beats one on 60 obscure imports.
    weightedScore: Math.round(bucket.count * Math.log(1 + bucket.weight) * 100) / 100,
    sampleNames: bucket.names,
    topCategoryTags: [...bucket.categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag),
  }))

  // productEmoji.ts matches longest-keyword-first, so a suggestion that is a
  // word-substring of an existing longer keyword would never fire. Flag it,
  // rather than let someone paste a line that silently does nothing.
  for (const row of rows) {
    const probe = getProductEmoji(row.word, '')
    if (probe !== FALLBACK_EMOJI) row.shadowedBy = probe
  }

  return rows.sort((a, b) => b.weightedScore - a.weightedScore).slice(0, limit)
}

export function renderEmojiCoverage(rows: EmojiCoverageRow[], totalAccepted: number): string {
  const missing = rows.reduce((sum, r) => sum + r.occurrences, 0)
  const lines = [
    '# Emoji coverage',
    '',
    `${missing.toLocaleString()} of ${totalAccepted.toLocaleString()} accepted products render as ${FALLBACK_EMOJI}.`,
    '',
    'Ranked by how much shelf the gap covers, not by raw count. Paste the lines',
    'below into `EMOJI_RULES` in `src/lib/productEmoji.ts`, replacing the emoji',
    'with the right one, and add a case to `test/productEmoji.test.js`.',
    '',
    '```js',
  ]

  for (const row of rows) {
    if (row.shadowedBy) continue
    const categories = row.topCategoryTags[0] ? ` · ${row.topCategoryTags[0]}` : ''
    lines.push(
      `{ emoji: '❓', keywords: ['${row.word}'] },`.padEnd(46) +
        ` // ${row.occurrences} products${categories}`,
    )
  }

  lines.push('```', '')

  const shadowed = rows.filter((r) => r.shadowedBy)
  if (shadowed.length) {
    lines.push(
      '## Already matched by a longer keyword',
      '',
      'These fall back to the bag for some other reason -- adding the word would',
      'do nothing, because a longer keyword already wins.',
      '',
      ...shadowed.map((r) => `- \`${r.word}\` (${r.occurrences}) currently resolves to ${r.shadowedBy}`),
      '',
    )
  }

  lines.push('## Samples', '')
  for (const row of rows.slice(0, 20)) {
    lines.push(`- **${row.word}** (${row.occurrences}) — ${row.sampleNames.join(', ')}`)
  }

  return lines.join('\n')
}

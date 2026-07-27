// The human half of the hybrid gate.
//
// Keyed by barcode, never by name or search_text. The normalizer changes -- a
// better casing rule, a new brand alias -- and every name changes with it. A
// verdict keyed on a name would silently evaporate on the next run, and the
// reviewer would be asked the same question again. The barcode is the only
// thing about a product that does not move, which is the strongest single
// argument for putting it in the schema at all.
//
// JSONL rather than JSON: appending a verdict is one line, the diff shows
// exactly what was decided, and two people reviewing different batches do not
// conflict in the middle of a 5,000-entry array.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Decision, DecisionIndex, ScoredProduct } from '../types.ts'

export function loadDecisions(path: string): DecisionIndex {
  const index: DecisionIndex = new Map()
  if (!existsSync(path)) return index

  for (const [i, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    const text = line.trim()
    if (!text || text.startsWith('//')) continue
    try {
      const decision = JSON.parse(text) as Decision
      if (!decision.barcode || (decision.verdict !== 'approve' && decision.verdict !== 'reject')) {
        continue
      }
      // Last line wins, so changing your mind is an append rather than an edit.
      index.set(String(decision.barcode), decision)
    } catch {
      // One malformed line must not cost every verdict recorded after it.
      console.warn(`decisions: skipping unparseable line ${i + 1}`)
    }
  }
  return index
}

export function appendDecisions(path: string, decisions: Decision[]): void {
  if (!decisions.length) return
  mkdirSync(dirname(path), { recursive: true })
  const body = decisions.map((d) => JSON.stringify(d)).join('\n')
  appendFileSync(path, existsSync(path) ? `${body}\n` : `${body}\n`, 'utf8')
}

// Everything in the review band that nobody has ruled on yet, worst-first-sorted
// so the reviewer's attention goes where the score is highest.
export function pendingReview(scored: ScoredProduct[], decisions: DecisionIndex): ScoredProduct[] {
  return scored
    .filter((s) => s.verdict === 'review' && !decisions.has(s.product.barcode))
    .sort((a, b) => b.score.total - a.score.total)
}

// Capped, because the review band on a full import is tens of thousands of rows
// and an uncapped queue is one nobody opens. The rest stay in the scored file
// and surface on the next run once the top has been cleared.
export function writeReviewQueue(pending: ScoredProduct[], path: string, cap: number): number {
  mkdirSync(dirname(path), { recursive: true })
  const rows = pending.slice(0, cap).map((s) => ({
    barcode: s.product.barcode,
    name: s.product.name,
    maker: s.product.maker,
    score: s.score.total,
    flags: s.score.flags,
    lang: s.product.nameLang,
    scans: s.product.signals.uniqueScans,
    markets: s.product.markets.filter((m) => m.startsWith('en:')).slice(0, 4),
  }))
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  return rows.length
}

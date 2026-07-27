// Score in, verdict out.
//
// The gate is hybrid on purpose. A pure threshold lets Open Food Facts' long
// tail of half-filled entries into the suggestion list; a pure review queue
// means nobody ever imports anything, because the queue is tens of thousands of
// rows long. So the clearly-good load themselves, the clearly-bad are dropped
// with a logged reason, and the ambiguous middle is the only thing a human is
// ever asked about.
import type { Decision, DecisionIndex, GateConfig, QualityScore, StagedProduct, Verdict } from '../types.ts'

export interface GateResult {
  verdict: Verdict
  reason: string
  decision?: Decision
}

export function applyGate(
  product: StagedProduct,
  score: QualityScore,
  decisions: DecisionIndex,
  cfg: GateConfig,
): GateResult {
  // A recorded verdict is absolute and comes before any scoring. That is what
  // makes review work across runs: a reject survives the score going up, a new
  // dump, and a normalizer change that renames the product entirely. Without
  // this the reviewer is asked the same question every month.
  const decided = decisions.get(product.barcode)
  if (decided?.verdict === 'reject') return { verdict: 'drop', reason: 'decided-reject', decision: decided }
  if (decided?.verdict === 'approve') return { verdict: 'auto', reason: 'decided-approve', decision: decided }

  // Hard rules, applied after the numeric band so they cannot be scored around.
  //
  // No scan count AND no brand: that pairing is where the junk lives -- an
  // entry nobody has ever scanned and nobody attributed. Either alone is
  // common and harmless (scans are absent on ~65% of the database).
  if (product.signals.uniqueScans === null && !product.signals.hasBrand) {
    return { verdict: 'drop', reason: 'no-scans-no-brand' }
  }

  if (score.total < cfg.reviewMin) return { verdict: 'drop', reason: 'below-review-threshold' }

  // A name a Romanian shopper cannot type is not auto-loadable, however
  // complete the record is otherwise.
  if (product.warnings.includes('foreign-name')) {
    return { verdict: 'review', reason: 'foreign-name' }
  }
  // Sold somewhere else. Plenty of these are real imports on Romanian shelves,
  // which is exactly why a human decides rather than a threshold.
  if (product.signals.marketTier !== 1) {
    return { verdict: 'review', reason: 'outside-home-market' }
  }
  if (score.flags.some((f) => f !== 'foreign-name' && f !== 'generic-name')) {
    return { verdict: 'review', reason: `flagged:${score.flags[0]}` }
  }

  if (score.total >= cfg.autoMin) return { verdict: 'auto', reason: 'score' }
  return { verdict: 'review', reason: 'middle-band' }
}

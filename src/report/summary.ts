// out/report.md -- the thing to read before approving anything.
import type { ImportReport, LoadRow, ScoredProduct } from '../types.ts'
import type { ExistingGlobal } from '../load/supabase.ts'

const pct = (n: number, total: number) => (total ? `${((100 * n) / total).toFixed(1)}%` : '0%')

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

export function renderScoreReport(
  scored: ScoredProduct[],
  rejected: { reason: string }[],
  queued: number,
): string {
  const total = scored.length + rejected.length
  const auto = scored.filter((s) => s.verdict === 'auto')
  const review = scored.filter((s) => s.verdict === 'review')
  const drop = scored.filter((s) => s.verdict === 'drop')

  const lines = [
    '# Import report',
    '',
    `Generated ${new Date().toISOString()}`,
    '',
    '## Where everything went',
    '',
    '| | count | share |',
    '|---|---:|---:|',
    `| read from the market subset | ${total.toLocaleString()} | |`,
    `| rejected before scoring | ${rejected.length.toLocaleString()} | ${pct(rejected.length, total)} |`,
    `| **auto-load** | **${auto.length.toLocaleString()}** | ${pct(auto.length, total)} |`,
    `| needs review | ${review.length.toLocaleString()} | ${pct(review.length, total)} |`,
    `| dropped by the gate | ${drop.length.toLocaleString()} | ${pct(drop.length, total)} |`,
    '',
    `${queued.toLocaleString()} of the review band are queued in \`out/review-queue.jsonl\`.`,
    '',
    '## Why records were rejected before scoring',
    '',
    ...countBy(rejected, (r) => r.reason).map(([reason, n]) => `- \`${reason}\` — ${n.toLocaleString()}`),
    '',
    '## Why the gate sent things to review or dropped them',
    '',
    ...countBy([...review, ...drop], (s) => `${s.verdict}:${s.reason}`).map(
      ([reason, n]) => `- \`${reason}\` — ${n.toLocaleString()}`,
    ),
    '',
    '## Name language of accepted products',
    '',
    ...countBy(auto, (s) => s.product.nameLang).map(([lang, n]) => `- ${lang} — ${n.toLocaleString()}`),
    '',
  ]

  return lines.join('\n')
}

export function renderLoadDiff(
  rows: LoadRow[],
  existing: Map<string, ExistingGlobal>,
  searchTextByBarcode: Map<string, string>,
  report: ImportReport,
): string {
  const added: LoadRow[] = []
  const changed: { row: LoadRow; was: ExistingGlobal }[] = []
  const protectedRows: { row: LoadRow; was: ExistingGlobal }[] = []

  for (const row of rows) {
    const searchText = searchTextByBarcode.get(row.barcode)
    const was = searchText ? existing.get(searchText) : undefined
    if (!was) added.push(row)
    else if (was.source !== 'openfoodfacts') protectedRows.push({ row, was })
    else changed.push({ row, was })
  }

  const lines = [
    '# Load diff',
    '',
    report.dry_run ? '**Dry run** — nothing was written.' : 'Applied.',
    '',
    '| | count |',
    '|---|---:|',
    `| new products | ${added.length.toLocaleString()} |`,
    `| imported rows refreshed | ${changed.length.toLocaleString()} |`,
    `| curated or contributed rows, provenance only | ${protectedRows.length.toLocaleString()} |`,
    `| skipped, barcode already taken | ${report.skipped_barcode_conflict.toLocaleString()} |`,
    `| household-contributed rows collapsed in | ${report.collapsed_scoped.toLocaleString()} |`,
    '',
  ]

  // The check to actually run your eye down: no curated row may change its
  // name, weight or provenance. It should only ever gain a barcode.
  if (protectedRows.length) {
    lines.push(
      '## Rows this import does not own',
      '',
      'These keep their name, weight and provenance and only gain the upstream',
      'barcode. If any of them show a changed name, the load path is broken.',
      '',
      '| existing name | source | would gain barcode |',
      '|---|---|---|',
      ...protectedRows
        .slice(0, 40)
        .map(({ row, was }) => `| ${was.name} | ${was.source} | ${was.barcode ?? row.barcode} |`),
      '',
    )
  }

  if (changed.length) {
    lines.push(
      '## Imported rows being refreshed',
      '',
      '| was | becomes | weight | add_count kept |',
      '|---|---|---|---|',
      ...changed
        .slice(0, 40)
        .map(
          ({ row, was }) =>
            `| ${was.name} | ${row.name} | ${was.base_weight} → ${row.base_weight} | ${was.add_count} |`,
        ),
      '',
    )
  }

  lines.push(
    '## New products (first 60)',
    '',
    ...added.slice(0, 60).map((r) => `- ${r.name}${r.maker ? ` — *${r.maker}*` : ''} (w${r.base_weight})`),
    '',
  )

  return lines.join('\n')
}

export function renderImportReport(report: ImportReport): string {
  return [
    `  inserted:                 ${report.inserted}`,
    `  refreshed (imported):     ${report.updated_imported}`,
    `  provenance only (curated):${report.updated_provenance_only}`,
    `  collapsed scoped rows:    ${report.collapsed_scoped}`,
    `  skipped, invalid:         ${report.skipped_invalid}`,
    `  skipped, barcode taken:   ${report.skipped_barcode_conflict}`,
    `  deduped in batch:         ${report.deduped}`,
  ].join('\n')
}

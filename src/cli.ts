// The pipeline, wired end to end.
//
// Each subcommand reads the previous one's file and writes its own, so any
// stage can be re-run without redoing the one before it -- which matters a
// great deal when the first stage is an 11.7 GB download.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  loadBrandAliases,
  loadCasingExceptions,
  loadCredentials,
  loadGateConfig,
  loadMarkets,
  loadNameBlocklist,
  outDir,
  paths,
} from './config.ts'
import { downloadDump, readSubset, writeMarketSubset } from './acquire/dump.ts'
import { harvestMarkets } from './acquire/api.ts'
import { normalizeProduct } from './normalize/index.ts'
import { scoreProduct } from './score/score.ts'
import { applyGate } from './score/gate.ts'
import { loadDecisions, pendingReview, writeReviewQueue } from './score/decisions.ts'
import { buildLoadPlan, chunk, findBarcodeCollisions } from './load/plan.ts'
import {
  CHUNK_SIZE,
  addReports,
  callImport,
  createServiceClient,
  emptyReport,
  fetchExistingGlobals,
} from './load/supabase.ts'
import { buildEmojiCoverage, renderEmojiCoverage } from './report/emojiCoverage.ts'
import { renderImportReport, renderLoadDiff, renderScoreReport } from './report/summary.ts'
import type { Decision, ScoredProduct, StagedProduct } from './types.ts'

const REVIEW_QUEUE_CAP = 500

const argv = process.argv.slice(2)
const command = argv[0]
const hasFlag = (flag: string) => argv.includes(flag)

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)

const writeJsonl = (path: string, rows: unknown[]) => {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

// The version stamp every row from this run carries, so one import can be
// re-weighted or deleted on its own later.
const sourceVersion = () => `off-${new Date().toISOString().slice(0, 10)}`

function reportSubset(stats: { linesRead: number; malformed: number; kept: number; tier1: number; tier2: number; bytesOut: number; elapsedMs: number }) {
  console.log(
    `\nRead ${stats.linesRead.toLocaleString()} records in ${Math.round(stats.elapsedMs / 1000)}s\n` +
      `  kept        ${stats.kept.toLocaleString()} (tier1 ${stats.tier1.toLocaleString()}, tier2 ${stats.tier2.toLocaleString()})\n` +
      `  malformed   ${stats.malformed.toLocaleString()}\n` +
      `  written     ${(stats.bytesOut / 1e6).toFixed(1)} MB to ${paths.subset}`,
  )
}

async function acquire() {
  // The quick path. Capped at 10,000 products per country and rate-limited to
  // 10 requests a minute, so it is a first wave rather than a full market --
  // but it produces the same subset file in minutes instead of hours.
  if (hasFlag('--search')) {
    console.log('Harvesting the configured markets from the search API (10 req/min)...')
    reportSubset(await harvestMarkets(loadMarkets(), { tier2: hasFlag('--tier2') }))
    console.log('\nNext: npm run normalize')
    return
  }

  if (hasFlag('--filter')) {
    console.log('Filtering the dump to the configured markets (one pass over ~78 GB)...')
    reportSubset(await writeMarketSubset(loadMarkets()))
    return
  }

  console.log('Downloading the Open Food Facts dump (~11.7 GB, resumable)...')
  const { manifest, skipped, resumedFrom } = await downloadDump(hasFlag('--force'))
  if (skipped) console.log('Already up to date (the ETag has not changed).')
  else if (resumedFrom) console.log(`Resumed from ${(resumedFrom / 1e9).toFixed(2)} GB.`)
  console.log(`${(manifest.bytes / 1e9).toFixed(2)} GB at ${paths.dump}`)
  console.log('\nNext: npm run acquire:filter')
}

function normalize() {
  const ctx = {
    aliases: loadBrandAliases(),
    casing: loadCasingExceptions(),
    markets: loadMarkets(),
    blocklist: loadNameBlocklist(),
  }

  return readSubset().then((records) => {
    const staged: StagedProduct[] = []
    const rejected: { barcode: string; reason: string; detail?: string }[] = []

    for (const record of records) {
      const result = normalizeProduct(record, ctx)
      if (result.ok) staged.push(result.product)
      else rejected.push(result.rejected)
    }

    writeJsonl(paths.staged, staged)
    writeJsonl(paths.rejected, rejected)
    console.log(
      `${staged.length.toLocaleString()} products staged, ${rejected.length.toLocaleString()} rejected.\n` +
        `  ${paths.staged}\n  ${paths.rejected}\n\nNext: npm run score`,
    )
  })
}

function score() {
  const gate = loadGateConfig()
  const decisions = loadDecisions(paths.decisions)
  const staged = readJsonl<StagedProduct>(paths.staged)
  const rejected = readJsonl<{ reason: string }>(paths.rejected)

  const scored: ScoredProduct[] = staged.map((product) => {
    const quality = scoreProduct(product, gate.weights)
    const { verdict, reason } = applyGate(product, quality, decisions, gate)
    return { product, score: quality, verdict, reason }
  })

  writeJsonl(paths.scored, scored)
  writeJsonl(
    paths.dropped,
    scored
      .filter((s) => s.verdict === 'drop')
      .map((s) => ({
        barcode: s.product.barcode,
        name: s.product.name,
        maker: s.product.maker,
        score: s.score.total,
        reason: s.reason,
      })),
  )

  const queued = writeReviewQueue(pendingReview(scored, decisions), paths.reviewQueue, REVIEW_QUEUE_CAP)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(paths.report, renderScoreReport(scored, rejected, queued), 'utf8')

  console.log(renderScoreReport(scored, rejected, queued))
  console.log(`Written to ${paths.report}\n\nNext: npm run review, then npm run load`)
}

// Deliberately not a TUI. It prints the queue and the one line you need to
// approve a slice of it; the verdicts are yours to paste into data/decisions.jsonl.
function review() {
  if (!existsSync(paths.reviewQueue)) throw new Error('nothing queued -- run `npm run score` first')
  const queue = readJsonl<{ barcode: string; name: string; maker: string | null; score: number; flags: string[] }>(
    paths.reviewQueue,
  )
  if (!queue.length) {
    console.log('Review queue is empty.')
    return
  }

  for (const row of queue.slice(0, 60)) {
    const maker = row.maker ? ` — ${row.maker}` : ''
    const flags = row.flags.length ? `  [${row.flags.join(', ')}]` : ''
    console.log(`${String(row.score).padStart(3)}  ${row.barcode}  ${row.name}${maker}${flags}`)
  }

  const threshold = Number(argv[argv.indexOf('--approve-above') + 1])
  if (Number.isFinite(threshold)) {
    const today = new Date().toISOString().slice(0, 10)
    const approvals: Decision[] = queue
      .filter((row) => row.score >= threshold)
      .map((row) => ({ barcode: row.barcode, verdict: 'approve', decidedAt: today }))
    console.log(`\n# Append to ${paths.decisions} to approve ${approvals.length} products:\n`)
    console.log(approvals.map((a) => JSON.stringify(a)).join('\n'))
  } else {
    console.log(
      `\n${queue.length} queued. Re-run with --approve-above <score> to emit an approval block.`,
    )
  }
}

async function load() {
  const apply = hasFlag('--apply')
  const version = sourceVersion()
  const scored = readJsonl<ScoredProduct>(paths.scored)
  const accepted = scored.filter((s) => s.verdict === 'auto').map((s) => s.product)

  if (!accepted.length) {
    console.log('Nothing approved to load.')
    return
  }

  const { rows, collapsed } = buildLoadPlan(accepted)
  writeJsonl(paths.collapsed, collapsed)

  const collisions = findBarcodeCollisions(rows)
  if (collisions.size) {
    console.warn(`${collisions.size} barcodes are claimed by more than one product; the server will skip them.`)
  }

  const searchTextByBarcode = new Map(accepted.map((p) => [p.barcode, p.searchText]))
  const db = createServiceClient()
  // Read the rows this batch would touch first, so the diff can show what
  // actually changes rather than only how many rows were involved.
  const searchTexts = rows.map((row) => searchTextByBarcode.get(row.barcode) ?? '').filter(Boolean)
  const existing = await fetchExistingGlobals(db, searchTexts)

  // Always say where. The default credentials come from FamCart's .env, which
  // points at PRODUCTION -- there is no other prompt between here and a write,
  // so the host has to be on screen before it happens.
  console.log(
    `Target:  ${new URL(loadCredentials().url).host}\n` +
      `Rows:    ${rows.length.toLocaleString()}` +
      (collapsed.length ? ` (${collapsed.length.toLocaleString()} collapsed on the way)` : '') +
      `\nMode:    ${apply ? 'APPLY -- this writes' : 'dry run'}\n`,
  )

  let total = emptyReport(!apply, version)
  const errors: { chunk: number; message: string }[] = []
  const batches = chunk(rows, CHUNK_SIZE)

  for (const [index, batch] of batches.entries()) {
    try {
      const report = await callImport(db, batch, { sourceVersion: version, dryRun: !apply })
      total = addReports(total, report)
      console.log(`  chunk ${index + 1}/${batches.length}: +${report.inserted} new, ${report.updated_imported} refreshed`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // One bad chunk must not cost the other 29,000 rows.
      console.error(`  chunk ${index + 1}/${batches.length} FAILED: ${message}`)
      errors.push({ chunk: index + 1, message })
    }
  }

  if (errors.length) writeJsonl(paths.loadErrors, errors)

  mkdirSync(outDir, { recursive: true })
  writeFileSync(paths.loadPlan, JSON.stringify({ version, report: total, errors }, null, 2), 'utf8')
  writeFileSync(paths.loadDiff, renderLoadDiff(rows, existing, searchTextByBarcode, total), 'utf8')

  console.log(`\n${renderImportReport(total)}`)
  console.log(`\nDiff: ${paths.loadDiff}`)
  if (!apply) console.log('\nThis was a dry run. Read the diff, then: npm run load:apply')
}

function reportEmoji() {
  const scored = readJsonl<ScoredProduct>(paths.scored)
  const accepted = scored.filter((s) => s.verdict === 'auto').map((s) => s.product)
  const rows = buildEmojiCoverage(accepted, 60)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(paths.emojiCoverage, renderEmojiCoverage(rows, accepted.length), 'utf8')
  console.log(renderEmojiCoverage(rows, accepted.length))
  console.log(`\nWritten to ${paths.emojiCoverage}`)
}

const COMMANDS: Record<string, () => void | Promise<void>> = {
  acquire,
  normalize,
  score,
  review,
  load,
  'report-emoji': reportEmoji,
}

const run = COMMANDS[command ?? '']
if (!run) {
  console.error(`Usage: tsx src/cli.ts <${Object.keys(COMMANDS).join('|')}>`)
  process.exit(1)
}

await Promise.resolve(run()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

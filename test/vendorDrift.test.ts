// The importer half of the vendoring guard.
//
// src/vendor/* are byte-for-byte copies of FamCart modules. They exist because
// this repo is a submodule that must also work as a standalone clone, where
// ../../src/lib/... is not there to import.
//
// Two checks, and they fail for different reasons:
//   1. The hash in vendor.meta.json always runs. It catches an edit made HERE.
//   2. The comparison against the upstream file runs only when checked out
//      inside FamCart. It catches an edit made THERE.
//
// FamCart carries the mirror of check 2 in its own suite, so whichever side the
// edit happens on, a test fails without anyone having to remember to run both.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import meta from '../src/vendor/vendor.meta.json' with { type: 'json' }

const here = dirname(fileURLToPath(import.meta.url))
const vendorDir = join(here, '..', 'src', 'vendor')
// test/ -> repo root -> tools/ -> FamCart root.
const famcartRoot = join(here, '..', '..', '..')

// Compared with CR stripped. FamCart is developed on Windows with
// core.autocrlf=true, so the same file is CRLF in a local working copy and LF on
// a Linux CI runner. Hashing raw bytes would make this test pass on one and fail
// on the other while the content is byte-identical in git.
const lf = (buf: string) => buf.replace(/\r\n/g, '\n')
const read = (path: string) => lf(readFileSync(path, 'utf8'))
const sha256 = (path: string) => createHash('sha256').update(read(path), 'utf8').digest('hex')

const entries = Object.entries(meta.files) as [string, { upstream: string; sha256: string }][]

describe('vendored FamCart modules', () => {
  it('vendors the modules the pipeline actually depends on', () => {
    expect(entries.map(([name]) => name).sort()).toEqual([
      'productEmoji.ts',
      'productSearch.ts',
    ])
  })

  for (const [name, entry] of entries) {
    it(`${name} matches the hash recorded in vendor.meta.json`, () => {
      expect(sha256(join(vendorDir, name))).toBe(entry.sha256)
    })

    // Skipped in a standalone clone, where there is no FamCart to compare to.
    const upstream = join(famcartRoot, entry.upstream)
    it.skipIf(!existsSync(upstream))(`${name} is identical to ${entry.upstream}`, () => {
      expect(read(join(vendorDir, name))).toBe(read(upstream))
    })
  }
})

// The reason the copy has to stay honest: these two functions decide which
// candidate rows collapse into one product before load. A divergent copy would
// collapse a different set than product_search_text() does in the database, and
// the batch would fail on product_catalog_global_search with no obvious cause.
describe('the vendored normalizer still behaves like the database', () => {
  it('folds diacritics, case and spacing the way product_search_text does', async () => {
    const { normalizeSearchText, productKey } = await import('../src/vendor/productSearch')

    expect(normalizeSearchText('  Apă  Plată   2L ')).toBe('apa plata 2l')
    expect(normalizeSearchText('Brânză și Țelină')).toBe('branza si telina')
    // The pgTAP canary asserts the SQL side produces exactly this.
    expect(normalizeSearchText('Apă Plată Dorna')).toBe('apa plata dorna')
    expect(productKey('Apa Plata', 'Dorna')).not.toBe(productKey('Apa', 'Plata Dorna'))
  })
})

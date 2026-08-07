# FamCart catalog importer

Pulls products out of Open Food Facts and into FamCart's `product_catalog`.

Separate repo, used as a submodule at `catalog-importer/`. Never ships in the app bundle.

## Setup

Needs Node 22+, ~15 GB free disk, and **migration 028 applied** to the target database.

Credentials come from FamCart's `.env` automatically. For a standalone clone, see `.env.example`.

```
npm install
```

## Running it

Each step writes a file the next one reads, so you can re-run any step without redoing the one
before it.

```
npm run acquire:search  # ~10 min, up to 10k products per country -> .cache/markets-subset.jsonl
npm run normalize       # -> out/staged.jsonl, out/rejected.jsonl
npm run score           # -> out/review-queue.jsonl, out/dropped.jsonl, out/report.md
npm run review          # print the queue, emit an approval block to paste
npm run load            # dry run
npm run load:apply      # actually writes
npm run report:emoji    # products that fall through to the shopping-bag emoji
```

Read `out/report.md` before approving anything, and `out/load-diff.md` before `load:apply` —
no curated row should ever show up as changed.

For the full market rather than a first wave, replace the first step with the dump:

```
npm run acquire         # download the dump -> .cache/  (11.7 GB, once)
npm run acquire:filter  # filter to our markets -> .cache/markets-subset.jsonl
```

To undo a whole import:

```sql
delete from public.product_catalog
where household_id is null and source = 'openfoodfacts' and source_version = 'off-2026-07-01';
```

## src/vendor/

Copies of FamCart's `productSearch.ts` and `productEmoji.ts`, so this repo also works as a
standalone clone. Don't edit them — change the original, copy it over, update the hash in
`vendor.meta.json`. Both repos have a test that fails if they drift apart.

## Licence

Code follows FamCart's licence. The imported data is Open Food Facts, ODbL 1.0 — see
`LICENSE-DATA`.

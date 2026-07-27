# FamCart catalog importer

Pulls products out of Open Food Facts and into FamCart's `product_catalog`.

FamCart ships ~256 hand-curated Romanian products. Anything else, families are meant to add
themselves — and they don't. This fills the catalog out in bulk.

Separate repo, used as a submodule at `tools/catalog-importer`. Never ships in the app bundle.

## Setup

Needs Node 22+, ~15 GB free disk, and **migration 028 applied** to the target database — the load
step calls `import_catalog_products()`, which 028 creates.

Credentials come from FamCart's `.env` automatically. For a standalone clone, see `.env.example`.

```
npm install
```

## Running it

Each step writes a file the next one reads, so you can re-run any step without redoing the one
before it.

```
npm run acquire         # download the dump -> .cache/  (11.7 GB, once)
npm run acquire:filter  # filter to our markets -> .cache/markets-subset.jsonl
npm run normalize       # -> out/staged.jsonl, out/rejected.jsonl
npm run score           # -> out/review-queue.jsonl, out/dropped.jsonl, out/report.md
npm run review          # print the queue, emit an approval block to paste
npm run load            # dry run
npm run load:apply      # actually writes
npm run report:emoji    # products that fall through to the shopping-bag emoji
```

Read `out/report.md` before approving anything, and `out/load-diff.md` before `load:apply` —
no curated row should ever show up as changed.

To undo a whole import:

```sql
delete from public.product_catalog
where family_id is null and source = 'openfoodfacts' and source_version = 'off-2026-07-01';
```

## Things that will bite you

Measured on 2026-07-27, not guessed:

- The dump is **11.7 GB compressed** (~78 GB raw, ~3.2M products). The data page says 0.9 GB; it's
  wrong. The URL redirects to S3, which does support resume via `Range`.
- The TSV export is 10× smaller and looks tempting. It has no `lang` column and no
  `product_name_<lang>` columns, so it can't tell a Romanian product from a Hungarian one.
- **Don't trust `lang`.** Out of 50 Romanian products, only 27 said `ro`. Napolact's "Bio Chefir"
  is filed as French. We gate on `product_name_ro` existing instead.
- **`unique_scans_n` is missing on ~65% of products.** Missing means "no idea", not "unpopular" —
  treat it as the latter and you throw away most of the database.
- `completeness` goes up to 1.1, not 1.0.
- `brands` is a comma-separated string in the dump but an array from the API.
- Rate limits are 15/min (product) and 10/min (search), so refreshing means re-downloading the
  dump, not crawling. A custom `User-Agent` is required.
- `/api/v2/search` currently returns **HTTP 200 with an HTML error page**. Check the content type.

## src/vendor/

Copies of FamCart's `productSearch.ts` and `productEmoji.ts`, because this repo has to work as a
standalone clone too.

Don't edit them. Change the original, copy it over, update the hash in `vendor.meta.json`. Both
repos have a test that fails if the two drift apart.

## Licence

Code follows FamCart's licence. The imported data is Open Food Facts, ODbL 1.0 — see
`LICENSE-DATA` for what that actually obliges us to do (short version: a visible credit line in the
app, shipping with the first import).

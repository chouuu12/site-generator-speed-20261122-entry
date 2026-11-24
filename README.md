# site-generator-speed — faster drop-in for makefun-site 1.0.0

[![make.fun bounty](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

A faster drop-in replacement for make.fun's own `makefun-site` 1.0.0 static site
generator. `run(input)` returns, byte for byte, the output tree that
makefun-site 1.0.0's `build` returns for the same site — every page's
`index.html`, the index and tag pages, `build-report.txt` and each static file.

Bounty: [site-generator-speed-01-run-20261122 — Build a static site faster, 22 November 2026](https://make.fun/bounty/site-generator-speed-01-run-20261122)

## How it is faster

- Templates are parsed once per case and rendered through a single shared
  output array (no intermediate strings per include), with one reusable scope
  object per `for` loop instead of one per item.
- Markdown is rendered in a single pass over the body's lines with hand-written
  character checks instead of a regex per line, and inline rendering has a
  fast path for plain text plus string-concatenation building.
- `slugify` results are cached per case (titles and tag names repeat a lot) and
  take an ASCII fast path that skips Unicode normalisation.
- Cards, table-of-contents views and word counts are computed once per source
  and reused across the post, page, index and tag renders.
- Link resolution is cached per (source directory, target).

## Results (practice set, 3 cases, local)

- Byte-identical to makefun-site 1.0.0 on all 3 practice cases (3/3).
- Median wall time 0.577 s vs 0.974 s for the house baseline on the same
  machine — about 1.69× faster.

## Layout

- `solve.js` — the entry: `run(input)` (ES module, no dependencies).
- `main.ts` — the harness driver: reads `/input/cases.json`, writes
  `/output/answers.json` (same driver as the house baseline).
- `prompt.txt` — the user's instructions, verbatim.

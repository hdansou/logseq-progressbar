# Changelog

All notable changes to the Logseq Progress Bar plugin will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

---

## [1.2.0] - 2026-05-26

Property-ident resolution moves from a single regex to a DB-backed cache.
Logseq's user-property idents have graph-specific suffixes (e.g.
`:user.property/check-pgUd_nnQ`) and the old regex missed any suffix
containing `_` — the bar would silently render 0 % even though the user
could see the checkbox. The new cache resolves friendly names → idents at
plugin init, settings change, and graph switch. The regex stays as a
fallback for cache misses, with its character class widened to match
Logseq's actual squuid alphabet.

A second real-graph case landed in the same pass: a `#Checklist`-tagged
block whose class declares a checkbox property is rendered ☐ by Logseq's
UI but doesn't have the value stored on the block until the user ticks
it. The plugin now treats these inherited defaults as `false` (Todo) so
the bar matches what the user sees.

### Added

- **Property-ident cache** (`src/identCache.ts`) — one Datascript query
  resolves every property's `:db/ident`, title, and type per graph.
  Aggregator does exact-match lookup against the cache; falls back to
  the regex only when the cache misses. Eliminates the suffix-alphabet
  guessing game and collision risk.
- **Class-property inheritance for unset checkboxes** — when a block is
  tagged with a class that declares a `:checkbox` property as a
  class-property and the value isn't directly stored, the aggregator
  defaults to `false` (Todo bucket). Without this, untouched checkbox
  blocks were silently excluded from progress counts.
- 33 new unit tests covering the cache (18) and the inherited-default
  + resolved-idents paths in the aggregator (15). Suite: 132 → 165.

### Changed

- Widened the regex-fallback suffix character class from `[A-Za-z0-9]+`
  to `[A-Za-z0-9_]+` so `_`-bearing squuid suffixes
  (e.g. `check-pgUd_nnQ`) match. AGENTS.md updated to match.
- `ProgressBarConfig` gains optional `resolvedIdents`, `propertyTypes`,
  and `tagClassProps` fields, snapshotted from the cache at config-read
  time. Pure types — no behaviour change for non-DB callers.

### Fixed

- User-property idents with underscore in the random suffix
  (`:user.property/<name>-pgUd_nnQ`) are now matched. Previously the
  regex `[A-Za-z0-9]+` excluded `_`, so any block carrying such a key
  rendered as "no value" and was silently dropped from the bar.

---

## [1.1.0] - 2026-05-15

Checkbox-property tracking lands as the headline feature: tagged blocks
with a `:logseq.property/type :checkbox` property roll up into the same
progress bar as enum-status children, with `#Checklist` → `check` shipped
as a turnkey default in settings. Wiring the feature up against a real
Logseq DB graph surfaced five SDK-shape bugs that the unit tests didn't
catch (user-property ident hash suffixes, compiled-DSL `:in $ %` crash,
colon-prefixed `:block/tags` key, single-property fallback, stale-slot
`provideUI` noise, plus an aggregator `false`-filter bug). All fixed and
covered by 27 new tests (suite: 105 → 132).

### Added

- **Checkbox-property tracking** (Phase 8) — tagged blocks with a
  `:logseq.property/type :checkbox` property now roll up into the same
  progress bar as enum-status children. `true` → Done bucket + counted as
  completed; `false` → Todo bucket + not completed. The `completeValues`
  map is bypassed for boolean values, so a checkbox tag needs only a single
  line in `propertyMappings` (e.g., `"Checklist": "check"`).
- **Default `Checklist` → `check` mapping** shipped in settings. The plugin
  does not create the class or property in the user's graph — users author
  their own class (any name works; rename in settings if needed).
- **`rewriteCompiledDsl`** in `src/query.ts` — round-trips Logseq's
  compiled simple-query datalog (`[:find … :in $ % :where (task ?b #{…})]`)
  back into clean DSL so `dslToBlockQuery` can emit rule-free datalog.
- Diagnostic: failed datascript queries now log the offending datalog and
  `queryUUID`, not just the error object.
- 16 new tests across `aggregator.test.ts` (boolean + ident-suffix
  matching) and `query-rewrite-compiled.test.ts`. Suite: 105 → 121.

### Fixed

- **User-defined property idents with hash suffixes** (`user.property/
check-F44tqsqr`) were not matched by the aggregator, causing every
  user-authored checkbox property to be silently skipped. Matcher now
  accepts `/<name>` or `/<name>-<hash>` via an anchored regex that won't
  over-match longer property names like `check-version`.
- **Compiled-DSL query blocks crashed with `:in $ %` error.** When Logseq
  stores a simple `(task …)` query as pre-compiled datalog in
  `:block/title`, the rule call `(task ?b #{…})` requires a rules input
  the plugin's `datascriptQuery` call doesn't supply. Pipeline now detects
  this shape and re-routes through `dslToBlockQuery`, which produces
  native datalog with no `%` dependency.
- **`false` values were silently filtered** by the aggregator's truthy
  guard (`if (!value) continue`), which would have caused unchecked items
  to never enter the count. Guard tightened to `value === null`.
- **Stale-slot `provideUI` warnings** — when async DB work straddled a
  slot unmount, `logseq.provideUI` was called for slots Logseq had already
  removed, producing `can not resolve selector target #slot__xxx` console
  noise. All three `provideUI` call sites in `renderProgressBar` now go
  through a `safeProvideUI` helper that re-checks `UI.checkSlotValid`
  immediately before the call and drops the entry from `activeRenderers`
  if the slot is gone.
- **Tag reader skipped colon-prefixed `:block/tags` key.** In DB graphs,
  `getBlockProperties` returns tags under `":block/tags"` (leading colon)
  as a plain string array. The reader was checking `"tags"` and
  `"block/tags"` only — every child returned `tags: []`, which made
  `resolveProperty` fall back to the wrong mapped property, so every
  Checklist/Tido child got silently skipped. Lookup chain extended.
- **Aggregator fallback used only first property** — when no tag matched
  (or tag resolution returned `[]`), `resolveProperty` returned only the
  first mapped property, skipping every other tag's mapping. Replaced
  with `resolvePropertyCandidates` that returns an ordered list and the
  aggregator tries each in turn. Defensive: a Checklist child with empty
  tags now still counts via its `check` property.

### Changed

- **`readPropertyValue` simplified** — two early-return fast paths
  duplicated logic the suffix-regex loop already covers. Replaced with a
  single anchored regex (`^:?(.+/)?<name>(?:-[A-Za-z0-9]+)?$`) that
  matches all four observed key shapes: plain `check`,
  `logseq.property/check`, `:logseq.property/check`, and
  `:user.property/check-F44tqsqr`. As a side effect, exact-match lookups
  are now case-insensitive (previously case-sensitive).
- **`toBlockData` halves SDK round-trips per child** — the old
  `getBlockTagNames` re-called `getBlock` _and_ `getBlockProperties` for
  each block after `toBlockData` had already fetched both. Tag extraction
  is now a pure `extractTagNames` helper that operates on the props
  already in hand.
- **`countQueryStatuses` switch consolidated** — the `datalog-map` and
  `datalog-vec` branches differed only in how the inner vector was
  extracted; merged into a single branch with one ternary.
- Bundle size: 120.81 kB → 120.47 kB (−340 bytes). Test suite: 105 → 132
  (15 new tests across aggregator, query-rewrite-compiled, and a new
  scanner-children regression file).

---

## [1.0.0] - 2026-05-01

First marketplace-ready release. Plugin is feature-complete for the Logseq DB
graph: renderer macro, slash command, query-block auto-detect (DSL + custom
datascript), real-time updates via `DB.onChanged`, and theme-aware colors.

### Added

- **Unified query mode** (Phase 7) — query blocks can now use either the simple DSL (`(task "Todo" "Done")`) or a full custom datascript query as a `{:query [:find … :where …]}` map or bare `[:find … :where …]` vector. Renderer is auto-detected when placed in a query block's title; the explicit `query: <uuid>` param still works for cross-block references. Results are pulled as block entities and grouped/counted in the plugin via `aggregate()`, sharing the exact code path used by children and page modes.
  - New `src/query.ts` module: `classifyQuery`, `extractDatalogVector`, `parseDSL`, `dslToBlockQuery`, `entityToBlockData`, `enrichPull`, `QueryParseError`.
  - `scanner.ts` shrinks ~170 LOC; `buildStatusCountQuery` and `transformCountResults` removed.
  - `enrichPull` injects ref-resolution hints into wildcard `(pull ?b [*])` patterns so user-supplied datalog returns resolved property titles.
- **Core data layer** (Phase 1)
  - Renderer macro argument parser with pipe-delimited value support (`src/parser.ts`)
  - Plugin settings schema with 12 configurable options (`src/config.ts`)
  - Config resolver merging global settings with per-instance overrides (`src/config.ts`)
  - Block scanner: children/descendants, page-level, and query modes (`src/scanner.ts`)
  - Tag filter with strict and inclusive modes (`src/scanner.ts`)
  - Status aggregator with custom property and completion mapping (`src/aggregator.ts`)
  - Display format labels: percent, fraction, both (`src/aggregator.ts`)
- **UI rendering** (Phase 2)
  - Segmented pill-shaped progress bar with CSS transitions (`src/renderer.ts`)
  - Color system with 11 default status colors, dark/light variants (`src/colors.ts`)
  - User color overrides via JSON settings (`src/colors.ts`)
  - Hover tooltip with full status breakdown
  - Width modes: full, compact, custom pixel values
  - Empty/zero state handling (show or hide)
  - Theme-aware CSS using Logseq CSS variables (`src/renderer.ts`)
- **Trigger modes** (Phase 3)
  - Manual renderer macro: `{{renderer :progress-bar, ...}}` (`src/index.ts`)
  - Slash command: `/progress-bar` to insert macro
  - Query integration (DSL + custom datascript, auto-detected)
  - Real-time updates via `DB.onChanged` event listener
  - Settings change reactivity — bars re-render on settings update
- **Unit tests** — 105 tests across 12 test files
- **DB-graph manifest** — declared `supportsDB`, `supportsDBOnly`, and `minSDKVersion: 0.3.2` in `package.json#logseq`
- Project scaffolding: Vite + TypeScript, package.json, tsconfig, index.html
- README.md with usage, settings reference, and examples

### Changed

- **SDK upgrade** — bumped `@logseq/libs` from `^0.2.8` → `^0.3.2`. No source changes required; the plugin's API surface (Editor, DB, App, UI, provide\*, settings lifecycle) is unchanged between 0.2.x and 0.3.x. Host transport moved to MessageChannel (transparent with fallback); `onSettingsChanged` now emits clean `(next, prev)` snapshots.
- Query-block raw-string resolution accepts any of `(`, `{`, `[` as a valid query opener (DSL, datalog map, or bare datalog vector).
- Verbose info-level logs gated behind a `debug` setting (or `window.__LOGSEQ_PROGRESSBAR_DEBUG__ = true`); errors and warnings still surface.

### Removed

- In-DB `[status, count]` aggregation datalog that only worked for DSL queries. Counting now happens in JS after pulling block entities — one grouping engine for every scan mode.

### Fixed

- **Plugin handshake timeout** — migrated to `vite-plugin-logseq`, upgraded `@logseq/libs` to `^0.2.8`, changed dev script to `vite build --watch`
- **ESM compatibility** — upgraded Vite to `^7.0.0`, Vitest to `^3.0.0`, separated `vitest.config.ts` from `vite.config.ts`
- **Query DSL resolution** — in DB graphs, `logseq.property/query` is a reference entity, not a raw string. Resolved via datascript pull with inlined `#uuid` (SDK `datascriptQuery` doesn't pass `:in` parameters correctly).
- **Double-bar render** — Query-class blocks render the same block title through multiple slot instances; switched `provideUI` key from block-scoped to slot-scoped so each slot renders independently.
- **Wildcard `(pull ?b [*])` returning 0%** — wildcard pull leaves status refs as unresolved `{:db/id N}` stubs. `enrichPull` now injects `{:logseq.property/<tracked> [:block/title]}` hints automatically.

### Known limitations

- Auto-detect mode (rendering bars on parent blocks without an explicit renderer) is not yet implemented.
- ESLint + Prettier are not yet configured.

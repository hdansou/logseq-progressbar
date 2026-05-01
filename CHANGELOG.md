# Changelog

All notable changes to the Logseq Progress Bar plugin will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
- **SDK upgrade** — bumped `@logseq/libs` from `^0.2.8` → `^0.3.2`. No source changes required; the plugin's API surface (Editor, DB, App, UI, provide*, settings lifecycle) is unchanged between 0.2.x and 0.3.x. Host transport moved to MessageChannel (transparent with fallback); `onSettingsChanged` now emits clean `(next, prev)` snapshots.
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

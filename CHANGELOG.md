# Changelog

All notable changes to the Logseq Progress Bar plugin will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
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
  - Query integration: `query: <uuid>` param fetches query results
  - Real-time updates via `DB.onChanged` event listener
  - Settings change reactivity — bars re-render on settings update
- **Unit tests** — 60 tests across 5 test files
  - Parser: 18 tests, Config: 10 tests, Aggregator: 12 tests, Colors: 11 tests, Renderer: 9 tests
- Project scaffolding: Vite + TypeScript, package.json, tsconfig, index.html
- README.md with usage, settings reference, and examples

### Fixed
- **Plugin handshake timeout** — migrated to `vite-plugin-logseq`, upgraded `@logseq/libs` to `^0.2.8`, changed dev script to `vite build --watch`
- **ESM compatibility** — upgraded Vite to `^7.0.0`, Vitest to `^3.0.0`, separated `vitest.config.ts` from `vite.config.ts`
- **Query DSL resolution** — in DB graphs, `logseq.property/query` is a reference entity, not a raw string. Resolved via datascript pull with inlined `#uuid` (SDK `datascriptQuery` doesn't pass `:in` parameters correctly)
- **Complex DSL queries** — `DB.q()` fails for DSL with `(between ...)` clauses (date bindings not available from plugin API). Added 3-tier fallback: full DSL → strip between clause → `getTagObjects` fallback

### Known Limitations
- `(between ...)` date clauses in queries are stripped when re-executing from plugin; query results may include items outside the original date range
- Auto-detect mode not yet implemented
- ESLint + Prettier not yet configured

### Not Yet Implemented
- Auto-detect mode (scan page for tagged children without explicit renderer)
- ESLint + Prettier setup
- Visual QA in running Logseq instance
- Performance testing with 50+ tasks
- Production build and marketplace publishing

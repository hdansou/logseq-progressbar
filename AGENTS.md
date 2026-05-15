# AGENTS.md

High-signal landmines and conventions for agents working on this plugin.
Anything you can learn from `README.md`, `REQUIREMENTS.md`, `TASKS.md`,
`CHANGELOG.md`, `TESTING.md`, `package.json`, or the source is **not** here.

## Logseq DB-graph SDK shapes — the biggest landmine

`logseq.Editor.getBlockProperties(uuid)` returns keys with a **leading
colon** in DB graphs. This is not in the `@logseq/libs` types and bit us
repeatedly during Phase 9 fixes. The shapes you will see:

- `":block/tags"` → plain string array, e.g. `["Tido"]`. Not entities.
- `":user.property/<name>-<8charhash>"` → user-defined properties get a
  random Logseq-generated suffix at class creation. The display name and
  ident are different.
- `":logseq.property/<name>"` → built-in properties.

`readPropertyValue` in `src/aggregator.ts` and `extractTagNames` in
`src/scanner.ts` already handle all four shapes (plain, colon-prefixed,
namespace-prefixed, hash-suffixed). For new property access, route through
them or reuse the regex `^:?(.+/)?<name>(?:-[A-Za-z0-9]+)?$` exactly —
the anchored boundary stops `check` from matching `check-version-XXXXXXXX`.

`(pull ?b [*])` returns property refs as `{:db/id N}` stubs. User-supplied
datalog must go through `enrichPull` first so refs come back as resolved
`:block/title` strings.

Logseq sometimes stores simple `(task …)` queries as compiled datalog that
declares `:in $ %`. The `%` is rules input we don't pass.
`rewriteCompiledDsl` in `src/query.ts` round-trips back to clean DSL —
don't try to expand the rules (they're host-internal).

## Design boundaries

**No graph mutation.** Plugin reads, never writes. No class creation, no
property creation, no `upsertBlockProperty`. Users author classes
themselves. If a feature seems to require mutation, surface that as a
constraint to the user instead of working around it.

**Auto-detect mode is unimplemented.** The `autoDetect` setting exists in
the schema but the `onRouteChanged` handler doesn't. Manual
`{{renderer :progress-bar}}` is the only render trigger today. Phase 3.4
in `TASKS.md` lists what's missing.

## `provideUI` calls must go through `safeProvideUI`

Async DB work between `onMacroRendererSlotted` and `provideUI` can straddle
a slot unmount. `safeProvideUI` (inline in `src/index.ts` inside
`renderProgressBar`) checks `UI.checkSlotValid` first and drops the entry
from `activeRenderers` if the slot is gone. New `provideUI` call sites
must use it — otherwise the console fills with `can not resolve selector
target #slot__xxx` warnings.

## DRY · KISS · YAGNI are actively enforced

Not aspirational — applied as a review pass before merge. Recent precedent:

- **YAGNI** — rejected auto-creating a `#Checklist` class on first install
  (graph-mutation boundary); rejected building a general Logseq rule
  expander (only `(task ?v #{…})` is detected, the one shape that
  surfaced).
- **DRY** — three early-return paths in `readPropertyValue` collapsed
  into one anchored regex; `datalog-map`/`datalog-vec` switch branches
  merged when they diverged only in `vec` extraction.
- **KISS** — `getBlockTagNames` deleted in favor of a sync
  `extractTagNames` that operates on already-fetched props (halved SDK
  calls per child).

Before adding new code, ask: can I delete something instead? Is this a
real requirement now, or a hypothetical for later? Three similar lines
beat a premature abstraction.

## TDD discipline expected for non-trivial changes

Each task in `TASKS.md` Phase 7+ went RED (failing test) → GREEN (minimal
impl) → REFACTOR. Tests live in `src/__tests__/<concern>.test.ts`. Add a
new `## Phase N` block in `TASKS.md` when starting multi-task work; mark
`[x]` per landed commit.

## `CHANGELOG.md` accumulates under `[Unreleased]`

Add entries under `### Added` / `### Changed` / `### Fixed` while iterating.
At release time, move the whole `[Unreleased]` block under a versioned
heading (e.g. `## [1.1.0] - YYYY-MM-DD`). Don't write directly into a
versioned block — it locks the changelog of a past release.

## `scanPage` is exported but unused

`src/scanner.ts`, exported, imported nowhere. Survives because
`REQUIREMENTS.md` §2 documents page-level scope as a feature. Don't delete
without aligning with the user. Don't extend it without re-wiring a caller
first — otherwise you'll be testing dead code.

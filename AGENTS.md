# AGENTS.md

High-signal landmines and conventions for agents working on this plugin.
Anything you can learn from `README.md`, `REQUIREMENTS.md`, `TASKS.md`,
`CHANGELOG.md`, `TESTING.md`, `package.json`, or the source is **not** here.

## Logseq DB-graph SDK shapes — the biggest landmine

`logseq.Editor.getBlockProperties(uuid)` returns keys with a **leading
colon** in DB graphs. This is not in the `@logseq/libs` types and bit us
repeatedly during Phase 9 fixes. The shapes you will see:

- `":block/tags"` → plain string array, e.g. `["Tido"]`. Not entities.
- `":user.property/<name>-<suffix>"` → user-defined properties get a
  random Logseq-generated suffix at class creation. The suffix is a
  6-12 char base64url-ish string and CAN contain `_` and `-` (e.g.
  `check-pgUd_nnQ`). The display name and ident are different.
- `":logseq.property/<name>"` → built-in properties.

Property lookup goes through two paths, in order:

1. **`identCache` (preferred)** — `src/identCache.ts` queries every
   property's `:db/ident`, title, and type from the live graph at plugin
   init / settings change / graph switch, and exposes
   `lookup(shortName) → ident[]`, `lookupType(ident)`, and
   `isClassProperty(tagTitle, ident)`. `readPropertyValue` does exact
   ident matching against block-property keys via this cache.
2. **Regex fallback** — used only when the cache misses (pre-init,
   brand-new property created after refresh). Pattern is
   `^:?(.+/)?<name>(?:-[A-Za-z0-9_]+)?$`. The `_` in the char class is
   load-bearing — Logseq's squuid alphabet includes it. The anchored
   boundary stops `check` from matching `check-version-XXXXXXXX`.

Class-property inheritance: when a block is tagged with a class that
declares a `:checkbox` property AND the property isn't stored directly
on the block, Logseq renders ☐ in the UI but `getBlockProperties` returns
nothing for that key. The aggregator handles this by default-falsing
unset checkbox class-properties (`blockHasInheritedClassProperty` in
`src/aggregator.ts`), driven by the `tagClassProps` field of
`ProgressBarConfig` (populated from
`:logseq.property.class/properties` via identCache). When debugging a
"why isn't this block counted?" report, check this path first.

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

**Auto-detect mode is unimplemented.** The `autoDetect` setting was removed
in 1.3.0 because nothing read it. Manual `{{renderer :progress-bar}}` is
the only render trigger today. REQUIREMENTS §1.1 keeps the intent.

**Setting a class property tags the block.** `upsert_block_property(uuid,
"logseq.property/status", …)` makes Logseq add `#Task` to the block. An
"untagged" fixture must use a property no class owns (the live seed uses
`check`), or strict-mode tests have nothing to exclude.

**`width:100%` does not make the bar block-wide.** The host mounts the
macro slot `inline-flex` inside the title, so `full` renders at the bar's
minimum width next to the title (the README screenshot look). Not a bug to
"fix" with CSS on `.pb-wrapper`; it needs the slot itself to be block-level.

## `provideUI` calls must go through `safeProvideUI`

Async DB work between `onMacroRendererSlotted` and `provideUI` can straddle
a slot unmount. `safeProvideUI` (inline in `src/index.ts` inside `render`)
first drops the call when a newer render of the same slot has started
(`slots.isCurrent`), then checks `UI.checkSlotValid` and forgets the slot
if it is gone. New `provideUI` call sites must use it — otherwise the
console fills with `can not resolve selector target #slot__xxx` warnings.

## `src/index.ts` is the only file that may import `@logseq/libs`

Every other module takes an `SdkPort` (`src/sdk.ts`) or plain data, so it
runs under vitest with a fake port. If a new feature needs another SDK
call, add it to the port and to the adapter's port object — never reach
for the `logseq` global from a pure module. `src/__sdk_guard__.ts` pins the
SDK floor at compile time; bump it together with `minSDKVersion`.

## The ident cache refreshes before every re-render pass

`identCache.refresh` runs at the start of each debounced pass (two
Datascript queries), not only on settings/graph events. A class or property
created after plugin load would otherwise stay unknown and its inherited
checkbox defaults would be skipped — that was the first live finding of the
2026-10-15 pass. Keep it there.

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
impl) → REFACTOR. Tests live next to their module (`src/<module>.test.ts`);
`src/matrix.test.ts` sweeps every feature × every settings permutation and
must gain a fixture for every new feature. Work since 2026-10-15 is
tracked in `tasks/todo.md` (checkboxes per landed commit) and corrections
in `tasks/lessons.md`; `TASKS.md` is the Phase 0–9 history.

## Live tests are the acceptance bar

`pnpm e2e` (web app) and `pnpm e2e:desktop` (desktop app) share
`scripts/e2e/seed.browser.js` + `matrix.browser.js`. Payloads run through
`playwright-cli eval` / `cdp.mjs eval`: single expression, no top-level
`;`, no arrow functions. The matrix wraps `logseq.api.*` write functions
with counters and fails on a single plugin write — keep it that way; it is
the proof behind the README privacy section.

## `CHANGELOG.md` accumulates under `[Unreleased]`

Add entries under `### Added` / `### Changed` / `### Fixed` while iterating.
At release time, move the whole `[Unreleased]` block under a versioned
heading (e.g. `## [1.1.0] - YYYY-MM-DD`). Don't write directly into a
versioned block — it locks the changelog of a past release.

## `scanPage` is exported but unused

`src/scanner.ts`, exported, imported by no production code (one unit test
keeps it honest). Survives because `REQUIREMENTS.md` §2 documents
page-level scope as a feature. Don't delete without aligning with the
user. Don't extend it without re-wiring a caller first.

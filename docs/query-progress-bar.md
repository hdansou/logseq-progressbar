# Progress Bar: Architecture & Data Flow

Current as of Phase 9 (2026-05). Reflects the unified `datascriptQuery`
pipeline from Phase 7 plus the Phase 8/9 checkbox-tracking and real-graph
SDK fixes. Supersedes the pre-Phase-7 "four-attempt fallback" architecture.

## Overview

The plugin renders a single `{{renderer :progress-bar}}` macro through two
selectable scan paths:

1. **Query mode** — the block hosting the macro has a `:logseq.property/query`
   (or the macro carries an explicit `query: <uuid>` arg).
2. **Children mode** — fallback for any block without a query property.
   Scans the block's descendants.

Both paths converge on the same aggregation engine
(`src/aggregator.ts:aggregate`) so rolling up enum statuses, checkbox
booleans, and mixed children works identically regardless of scan path.

---

## 1. Entry point — `index.ts:main → renderProgressBar`

`logseq.App.onMacroRendererSlotted` fires for every visible
`{{renderer :progress-bar}}`. Each invocation creates a slot-scoped
instance key (`pb-<slot>`) and is tracked in `activeRenderers` so
`DB.onChanged` / `onSettingsChanged` / `onThemeModeChanged` can re-render
the right bars without scanning the page.

`renderProgressBar` flow (`src/index.ts:52-121`):

```
parse args → resolve config → countQueryStatuses(uuid) ──┐
                                                          ▼
                                  null? ──── yes ──→ scanChildren + filterByTags + aggregate
                                  no                       │
                                  │                        ▼
                                  └────────────→ stats: StatusCounts
                                                          │
                                  stats.total === 0? ─── yes ──→ renderEmpty (if showOnEmpty) | ""
                                  no                       │
                                  ▼                        ▼
                            buildSegments  ────→  renderBar(html)
                                                          │
                                                          ▼
                                            safeProvideUI(slot, html)
```

`safeProvideUI` re-checks `logseq.UI.checkSlotValid(slot)` immediately
before each `provideUI` call. Async DB work between the macro firing and
the call can straddle a slot unmount; without the guard, Logseq logs
`can not resolve selector target #slot__xxx`.

---

## 2. Query mode — `scanner.ts:countQueryStatuses`

One pipeline, every query shape:

```
queryUUID
   │
   ▼
resolveQueryRaw ────► raw string starting with "(" | "{" | "["
   │                  (or null → caller falls back to children mode)
   ▼
classifyQuery  ────► "dsl" | "datalog-map" | "datalog-vec" | "empty" | "unknown"
   │
   ▼
┌─ "dsl" ──────────────────────► parseDSL + dslToBlockQuery
├─ "datalog-map" ───► extractDatalogVector ──┐
└─ "datalog-vec" ───► raw.trim() ────────────┤
                                              ▼
                              rewriteCompiledDsl(vec)
                                ├─ matched: route to dslToBlockQuery
                                └─ null:    enrichPull(vec, trackedProperty)
   │
   ▼
datalog string (always native, never declares :in $ %)
   │
   ▼
logseq.DB.datascriptQuery(datalog)
   │
   ▼
rowsToBlocks → entityToBlockData[]
   │
   ▼
aggregate(blocks, config) → StatusCounts
```

### Raw-query resolution (`scanner.ts:resolveQueryRaw`)

Two strategies. Strategy 1 (preferred): a datascript pull that follows
the `:logseq.property/query` reference chain directly:

```clojure
[:find ?q .
 :where
 [?b :block/uuid #uuid "<uuid>"]
 [?b :logseq.property/query ?qid]
 [?qid :block/title ?q]]
```

Strategy 2 (fallback): `logseq.Editor.getBlock(uuid)` and walk
`logseq.property/query` on the returned object. Kept for environments
where the datascript pull is flaky.

Returns `null` if the block has no `:logseq.property/query`. The caller
treats that as the signal to fall back to children mode.

### Why round-trip compiled DSL back to DSL? (`query.ts:rewriteCompiledDsl`)

Logseq sometimes stores simple `(task "Done" "Todo")` queries as
**pre-compiled datalog** in `:block/title`:

```clojure
[:find (pull ?b [*])
 :in $ %
 :where (task ?b #{"Done" "Todo"})]
```

The `:in $ %` declares a rules input we don't pass — `datascriptQuery`
throws `Too few inputs passed, expected: [$ %]`. `rewriteCompiledDsl`
extracts the status set, emits a clean `(task "Done" "Todo")` DSL string,
and the pipeline takes the regular DSL branch from there. Simpler than
implementing a Logseq rule expander.

### Why enrichPull on raw datalog? (`query.ts:enrichPull`)

User-supplied `(pull ?b [*])` patterns return property refs as
`{:db/id N}` stubs. `enrichPull` injects ref-resolution hints
(`{:block/tags [:block/title]}` and `{:logseq.property/<tracked>
[:block/title]}`) so the aggregator sees resolved title strings instead
of stubs. No-op for explicit pull specs — merging into arbitrary pull
shapes would need a real EDN parser (YAGNI).

### Entity → BlockData adapter (`query.ts:entityToBlockData`)

Tolerates the four key shapes Logseq's JSON normalization may emit
(`block/uuid`, `:block/uuid`, plain `uuid`, plain `:uuid`). Picks up
properties with `logseq.property/` or `:logseq.property/` prefixes;
user-defined property idents are handled downstream by the aggregator's
suffix matcher.

---

## 3. Children mode — `scanner.ts:scanChildren`

Used when the block hosting the macro has no `:logseq.property/query`.

```
parentUUID
   │
   ▼
logseq.Editor.getBlock(uuid, {includeChildren: true})
   │   (block.children is a tree; nil/empty → return [])
   ▼
collectBlocks (depth-first, honors config.depth)
   │
   ▼  per child uuid:
toBlockData
   ├── logseq.Editor.getBlockProperties(uuid) → props
   └── extractTagNames(props, block)          → tag titles
   │
   ▼
BlockData[]
   │
   ▼
filterByTags (strict mode only — drops untagged blocks)
   │
   ▼
aggregate(blocks, config) → StatusCounts
```

### Why `extractTagNames` instead of a tag SDK call?

DB graphs return tags under the colon-prefixed key
`":block/tags"` in `getBlockProperties`, as a plain string array
(`["Tido"]`). `extractTagNames` (`scanner.ts:270-298`) walks that key
chain (`:block/tags` → `block/tags` → `tags` → top-level `block.tags`)
and handles both plain-string and entity-object element shapes. Pure /
synchronous — runs on the props already fetched, so `toBlockData`
doesn't double its SDK round-trips.

---

## 4. Aggregation — `aggregator.ts:aggregate`

```
for each block:
  1. resolvePropertyCandidates(block.tags, mapping)
     ├── tag-matched properties first
     └── fallback: ALL mapped properties (defensive when tag reader returns [])
  2. for each candidate in order, readPropertyValue(props, candidate)
     ├── anchored regex `^:?(.+/)?<name>(?:-[A-Za-z0-9]+)?$`
     ├── covers plain, `logseq.property/`, `:logseq.property/`,
     │   AND `user.property/<name>-<8charhash>` shapes
     └── stop on first non-null value
  3. label / completion:
     ├── boolean true  → label "Done", completed++
     ├── boolean false → label "Todo"
     └── string        → label = value, completed iff value ∈ completeSet
  4. counts[label]++, total++
```

The anchored boundary in the property regex stops looking up `check` from
false-matching `check-version-XXXX`. Booleans bypass the `completeValues`
map entirely — `true` always counts as complete, `false` never does. This
keeps a checkbox tag's configuration to a single line in
`propertyMappings` (e.g. `"Checklist": "check"`).

---

## 5. Rendering — `colors.ts` + `renderer.ts`

`buildSegments` (`colors.ts:64`):
- Computes `percent = count / total * 100` per status label
- Picks a `StatusColor` for `themeMode`, applying any user override
- Sorts: complete states left, pending right, with priority within each
  (Done > Canceled > In Review > Doing > Todo > Backlog)

`renderBar` (`renderer.ts:7`):
- Emits a single `<div class="pb-wrapper">` with one `<div class="pb-segment">`
  per status
- Builds the hover tooltip as the `title` attribute of `pb-bar` (newline-separated
  status: count lines + total)
- Appends the formatted label (`percent` / `fraction` / `both`)

`PLUGIN_CSS` is injected once at plugin init via `logseq.provideStyle`.
Segment widths animate via CSS transition.

---

## 6. Real-time updates

`activeRenderers: Map<key, {slot, args, uuid}>` accumulates every macro
slot the plugin has handled. Three host events drive `rerenderAll`:

| Event                       | Where registered     | Action                              |
| --------------------------- | -------------------- | ----------------------------------- |
| `DB.onChanged`              | `index.ts:167`       | Any DB mutation → re-render all     |
| `onSettingsChanged`         | `index.ts:175`       | Settings panel saved → re-render    |
| `App.onThemeModeChanged`    | `index.ts:38`        | Light/dark toggle → re-render       |

`rerenderAll` (`index.ts:124-133`) checks `UI.checkSlotValid` for each
entry before re-invoking `renderProgressBar`; stale entries are pruned.

---

## 7. File / symbol map

| File                | Role                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| `src/index.ts`      | Plugin lifecycle, macro/slash handlers, `renderProgressBar`, `safeProvideUI`, `rerenderAll`, `activeRenderers` |
| `src/parser.ts`     | `parseRendererArgs` — turns macro arg strings into a config-override record   |
| `src/config.ts`     | `DEFAULTS`, `SETTINGS_SCHEMA`, `readGlobalConfig`, `resolveConfig`            |
| `src/scanner.ts`    | Query mode (`countQueryStatuses`, `resolveQueryRaw`, `buildDslDatalog`, `rowsToBlocks`) + children mode (`scanChildren`, `scanPage`, `collectBlocks`, `toBlockData`, `extractTagNames`) + tag filter (`filterByTags`) |
| `src/query.ts`      | Pure pipeline pieces: `classifyQuery`, `extractDatalogVector`, `parseDSL`, `dslToBlockQuery`, `rewriteCompiledDsl`, `enrichPull`, `entityToBlockData`, `QueryParseError` |
| `src/aggregator.ts` | `aggregate`, `formatLabel`, `resolvePropertyCandidates`, `readPropertyValue`  |
| `src/colors.ts`     | `getStatusColor`, `buildSegments`, `parseColorOverrides`                      |
| `src/renderer.ts`   | `renderBar`, `renderEmpty`, `PLUGIN_CSS`                                      |
| `src/debug.ts`      | `debug()` — gated console.log (settings flag or `window.__LOGSEQ_PROGRESSBAR_DEBUG__`) |
| `src/types.ts`      | `ProgressBarConfig`, `StatusCounts`, `StatusColor`, `BarSegment`              |

---

## 8. Key design decisions

| Decision                                                              | Rationale                                                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| One pipeline for DSL, datalog-map, datalog-vec                        | DRY — children, page, and query modes all feed `aggregate()`                                                         |
| Rewrite compiled `(task ?v #{…})` to clean DSL instead of rule expansion | Avoids replicating Logseq's host-internal rule library; one path keeps emitting native datalog                       |
| Anchored regex for property-key match                                 | User-defined property idents get a random hash suffix; the anchor stops `check` from matching `check-version-XXXX` |
| Booleans bypass `completeValues`                                      | `true`/`false` carry their own complete semantics; checkbox tags need only one settings line                          |
| Plugin never mutates the user's graph                                 | Design boundary — users author classes/properties themselves                                                          |
| Auto-detect (no manual renderer) deferred                             | Phase 3.4 unimplemented; manual `{{renderer :progress-bar}}` is the only render trigger today                         |

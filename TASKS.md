# Logseq Progress Bar Plugin — Task Tracker

> Track all implementation tasks here. Mark tasks `[x]` as they are completed.
> Reference: [REQUIREMENTS.md](./REQUIREMENTS.md) | [CHANGELOG.md](./CHANGELOG.md) | [TESTING.md](./TESTING.md)

---

## Phase 0: Project Setup

- [x] Initialize project with Vite + TypeScript scaffold
- [x] Configure `package.json` with plugin metadata and scripts
- [x] Set up `@logseq/libs` dependency (upgraded to `^0.2.8`)
- [x] Create `tsconfig.json` with strict mode
- [ ] Set up ESLint + Prettier
- [x] Create `.gitignore` for node_modules, dist, etc.
- [x] Verify plugin loads in Logseq dev environment
  - Fixed handshake timeout: added `vite-plugin-logseq`, changed dev script to `vite build --watch`

---

## Phase 1: Core Data Layer

- [x] **1.1** Implement renderer macro argument parser
  - Parse `{{renderer :progress-bar, ...}}` args into typed config object
  - Support: `tags`, `property`, `complete`, `depth`, `strict`, `format`, `width`, `query`
  - Pipe-delimited values (`tags: Task|Bug`) parsed to arrays
- [x] **1.2** Implement plugin settings schema
  - Register `useSettingsSchema` with all global settings (§8.1)
  - Settings: `tagsInScope`, `propertyMappings`, `completeValues`, `defaultDepth`, `strictTagFilter`, `displayFormat`, `barWidth`, `autoDetect`, `showOnEmpty`, `colorOverrides`
- [x] **1.3** Implement config resolver
  - Merge global settings with per-instance renderer overrides
  - Per-instance args take precedence over global defaults
- [x] **1.4** Implement block scanner — children/descendants mode
  - Given a parent block UUID + depth, collect descendant blocks
  - Depth `1` = direct children, `all` = full recursion
- [x] **1.5** Implement block scanner — page mode
  - Given a page, collect all blocks within configured depth
- [x] **1.6** Implement query mode — direct datascript status counting
  - Add `{{renderer :progress-bar}}` to a query block's title
  - Auto-detect query block via `:logseq.property/query` property on the block UUID
  - Resolve the DSL string by following the query reference chain (3 strategies)
  - Parse the DSL into structured components: status values, date range, tag filters, property filters
  - Build a datascript count query from parsed DSL — returns `[status, count]` pairs directly
  - Single `datascriptQuery()` call replaces the broken `DB.q()` + block-by-block fetching
  - Handles: `(task ...)`, `(between ...)`, `(tags ...)`, `(property ...)`, `(and ...)`
  - Honors any user-defined query filters — not hardcoded to specific patterns
- [x] **1.7** Implement tag filter
  - Filter collected blocks by tags in scope
  - Support strict mode (exclude untagged) and inclusive mode (include all)
- [x] **1.8** Implement status aggregator
  - Read the tracked property from each filtered block
  - Exclude blocks with no property value set
  - Count occurrences per status value
  - Compute completion percentage based on configured complete values
- [x] **1.9** Unit tests for data layer
  - Parser tests (renderer args, pipe-delimited values, edge cases) — 18 tests
  - Config resolver tests (merge precedence) — 10 tests
  - Aggregator tests (counts, percentages, exclusions) — 12 tests

---

## Phase 2: UI Rendering

- [x] **2.1** Implement segmented progress bar component
  - Rounded pill shape with CSS border-radius
  - Stacked colored segments proportional to status counts
  - Segments ordered: completed on left, pending on right
  - Smooth CSS transitions on segment width changes
- [x] **2.2** Implement percentage/fraction label
  - Render label to the right of the bar
  - Support three formats: `percent`, `fraction`, `both`
  - Respect `displayFormat` from resolved config
- [x] **2.3** Implement hover tooltip
  - Show full status breakdown on hover (native title attribute)
  - Include per-status count and total
- [x] **2.4** Implement color system
  - Default palette with dark/light mode variants — 11 tests
  - Listen to `App.onThemeModeChanged` for theme switches
  - Support user color overrides from settings
- [x] **2.5** Implement width modes
  - Full width (default): 100% of block content area
  - Compact: fixed or custom pixel width, inline with block title
- [x] **2.6** Implement empty/zero state
  - `showOnEmpty: true` → empty bar with 0% label
  - `showOnEmpty: false` → hide bar entirely
- [x] **2.7** Inject CSS via `provideStyle`
  - All bar styles, tooltip styles, animation keyframes
  - Theme-aware CSS custom properties
- [ ] **2.8** Visual QA
  - Verify bar renders correctly in light mode
  - Verify bar renders correctly in dark mode
  - Verify animation smoothness
  - Verify tooltip positioning

---

## Phase 3: Trigger Modes

- [x] **3.1** Implement manual renderer macro trigger
  - Register `App.onMacroRendererSlotted` handler for `:progress-bar`
  - Parse slot arguments, resolve config, scan blocks, render bar via `provideUI`
- [x] **3.2** Implement slash command
  - Register `/progress-bar` slash command to insert the renderer macro
- [x] **3.3** Implement query integration
  - Query blocks auto-detected when `{{renderer :progress-bar}}` is in the block title
  - DSL resolved via datascript reference chain (`:logseq.property/query` → entity → `:block/title`)
  - Status counts computed directly via datascript aggregation (no `DB.q()`)
  - `(between ...)` date filters handled natively in datascript via `:block/journal-day`
  - All user-defined query filters honored — progress bar matches the query's intent
- [ ] **3.4** Implement auto-detect mode
  - On `App.onRouteChanged`, scan current page for blocks with matching tags
  - Identify parent blocks that have tagged children
  - Render progress bars on qualifying parents
  - Respect `autoDetect` setting (enable/disable)
- [x] **3.5** Implement real-time updates
  - Subscribe to `DB.onChanged` events
  - Re-scan and re-render affected progress bars when task statuses change
  - Add debounce fallback (300ms) behind a flag if performance is poor

---

## Phase 4: Integration & Polish

- [x] **4.1** Handle edge case: invalid query UUID
  - Show subtle error indicator or hide bar gracefully
- [x] **4.2** Handle edge case: blocks with no property value
  - Ensure excluded from count (not counted as any status)
- [x] **4.3** Handle edge case: all items complete
  - Full bar in complete color, 100% label
- [x] **4.4** Handle multiple independent bars on same page
  - Each renderer instance maintains its own scope and state
  - No cross-contamination between bars
- [ ] **4.5** Performance testing with 50+ tasks
  - Profile re-render time on large pages
  - Enable debounce if needed
- [ ] **4.6** Theme switch live testing
  - Verify colors update immediately on dark/light toggle
- [x] **4.7** Settings change reactivity
  - Verify bars re-render when plugin settings are changed
- [x] **4.8** Debug logging for query resolution (temporary)
  - Console logs at each resolution strategy for diagnosis
  - To be removed before production release

---

## Phase 5: Documentation & Release

- [x] **5.1** Write user-facing README.md
  - Installation instructions
  - Usage examples (manual, auto-detect, query)
  - Settings reference
- [ ] **5.2** Finalize CHANGELOG.md for v0.1.0
- [x] **5.3** Build production bundle (verified: `npm run build` succeeds)
- [ ] **5.4** Test production build in Logseq — in progress
  - [x] Plugin loads successfully (handshake fixed)
  - [x] Macro renderer fires on `{{renderer :progress-bar}}`
  - [ ] Query mode end-to-end working (DSL resolved, blocks scanned, bar rendered)
  - [ ] Children scan mode verified
  - [ ] Visual rendering verified
- [ ] **5.5** Publish to Logseq marketplace (or prepare for manual install)

---

## Phase 6: SDK Upgrade to `@logseq/libs` 0.3.2

- [x] **6.1** Write failing manifest test (`src/__tests__/manifest.test.ts`)
  - Asserts declared range admits `0.3.2`, installed SDK is `0.3.2`, and `logseq` block declares `supportsDB`, `supportsDBOnly`, `minSDKVersion`
- [x] **6.2** Bump `@logseq/libs` dependency from `^0.2.8` to `^0.3.2` and reinstall
- [x] **6.3** Add DB-graph manifest fields to `package.json#logseq`: `supportsDB: true`, `supportsDBOnly: true`, `minSDKVersion: "0.3.2"`
- [x] **6.4** Confirm manifest test passes (5/5 green)
- [x] **6.5** Confirm full suite (65 tests) and `npm run build` succeed
- [ ] **6.6** Smoke-test against a Logseq build that ships the 0.3.x host — **blocked on live environment**
  - Static verification done: `npm test` (65/65), `npm run build` clean
  - Live checks (require `yarn watch` in the Logseq repo serving on `localhost:3001`):
    - MessageChannel handshake completes (no stuck-in-pending plugin)
    - `onMacroRendererSlotted` fires on `{{renderer :progress-bar}}`
    - `DB.onChanged` triggers re-render on status flip
    - `onSettingsChanged` triggers `rerenderAll` (args-less callback)
    - `UI.checkSlotValid` still drops stale slots
- [x] **6.7** ~~migrate hand-rolled DSL parsing in `scanner.ts` to `DB.customQuery`~~ — **superseded and closed.** Delivered equivalent capability in Phase 7 via `DB.datascriptQuery` + `aggregate()`. Avoids the host-side `custom_query` tuple-unwrap concern entirely.
- [ ] **6.8** *(optional follow-up)* evaluate `Experiments.registerHostedRenderer` for a settings/summary panel

---

## Phase 7: Unified query mode — DSL + custom datascript (TDD)

> **Goal:** a single pipeline handles both simple DSL queries (`(task "Todo")`) and custom datascript queries (`{:query [:find … :where …]}` or bare `[:find …]`) attached to a Logseq query block, grouping results by a tracked property and counting — KISS, DRY, YAGNI.
>
> **Architecture:**
> `queryBlockUUID → extractRawQuery → classify → toDatalog → datascriptQuery → entityToBlockData[] → aggregate() → StatusCounts → renderer`
>
> All DB work goes through `logseq.DB.datascriptQuery` (no `DB.customQuery`, no host-side bugs). Aggregation reuses `src/aggregator.ts` — zero duplication with children/page modes.
>
> **TDD discipline:** every task below starts RED (failing test first), then GREEN (minimal impl), then REFACTOR. Commit per task. No implementation before a failing test exists.

### 7.1 Query classifier (pure) — RED → GREEN → REFACTOR

- [x] **7.1.1** RED: `src/__tests__/query-classify.test.ts` — 6 cases covering dsl / datalog-map / datalog-vec / empty / unknown, including leading whitespace.
- [x] **7.1.2** GREEN: `classifyQuery` in new `src/query.ts`.
- [x] **7.1.3** REFACTOR: single-responsibility classifier; exported.

### 7.2 Map unwrapper (pure) — RED → GREEN → REFACTOR

- [x] **7.2.1** RED: `src/__tests__/query-unwrap.test.ts` — 7 cases, including user's nested `(or … :db/ident)` example and `:inputs`-with-ignored-extras.
- [x] **7.2.2** GREEN: `extractDatalogVector` — regex-find `:query\s*\[` then escape-aware bracket-balance.
- [x] **7.2.3** REFACTOR: `findMatchingBracket` helper kept private; single caller for now.

### 7.3 DSL → block-pull datalog (pure) — RED → GREEN → REFACTOR

- [x] **7.3.1** RED: `src/__tests__/dsl-to-datalog.test.ts` — 9 cases covering `(task …)`, `(tags …)`, `(between …)`, `(property …)`, and error path for empty `trackedProperty`.
- [x] **7.3.2** GREEN: `dslToBlockQuery` emits `:find (pull ?b [*])` (not count); aggregation moves to `aggregate()`.
- [x] **7.3.3** REFACTOR: `parseDSL` + `ParsedDSL` moved to `query.ts` as canonical home. Old count-shaped datalog path deleted in 7.5.

### 7.4 Entity → BlockData adapter (pure) — RED → GREEN → REFACTOR

- [x] **7.4.1** RED: `src/__tests__/entity-to-blockdata.test.ts` — 6 cases: ref tags, ref+string properties, missing tags, missing uuid, non-object inputs, leading-colon key fallback.
- [x] **7.4.2** GREEN: `entityToBlockData` resolves ref titles to strings at the adapter boundary so `aggregate()` stays shape-ignorant. Tolerates both `"block/uuid"` and `":block/uuid"` key shapes.
- [x] **7.4.3** REFACTOR: property values normalized to strings (not refs) before handing to `aggregate()` — matches `readPropertyValue` expectations.

### 7.5 Integration: `countQueryStatuses` rewrite — RED → GREEN → REFACTOR

- [x] **7.5.1** RED: `src/__tests__/scanner-query.test.ts` — 5 cases with mocked `logseq.DB.datascriptQuery` + `logseq.Editor.getBlock` covering DSL, datalog-map, datalog-vec, unresolvable, and runtime-error paths.
- [x] **7.5.2** GREEN: `countQueryStatuses` becomes the thin `resolveQueryRaw → classify → toBlockDatalog → datascriptQuery → rowsToBlocks → aggregate` pipeline.
- [x] **7.5.3** REFACTOR: deleted `buildStatusCountQuery`, `transformCountResults`, old count-aggregate code path; widened resolver to accept `(`/`{`/`[` openers. Net: scanner.ts −170 LOC.

### 7.6 Live smoke (manual, in Logseq DB graph)

Attempted an automated pass via `logseq-plugin-tester` against a live
`logseq_db_Demo` graph at `localhost:3001`. Partial coverage achieved —
see below. Full end-to-end verification is **blocked on the same
environmental concerns as task 6.6** (Logseq 0.3.2 host stability).

- [x] **7.6.a** *(verified automatically)* Plugin builds and installs cleanly via `LSPluginCore.load_plugin_from_web_url_BANG_`.
- [x] **7.6.b** *(verified automatically)* `main()` runs to completion — `Progress Bar plugin loaded!` + `ready!` in console.
- [x] **7.6.c** *(verified automatically)* `onMacroRendererSlotted` handler registers host-side — `hook:app:macro_renderer_slotted` present under `:plugin/installed-hooks` in the Logseq app state, alongside `hook:app:theme_mode_changed`, `hook:db:changed`, slash-command hook.
- [x] **7.6.d** *(verified automatically)* Logseq parses `{{renderer :progress-bar}}` as a macro and creates a `.lsp-hook-ui-slot` in the DOM for the plugin to fill.
- [ ] **7.6.1** Query block with DSL `(task "Todo" "Doing" "Done")` + `{{renderer :progress-bar}}` → bar renders with live counts — **manual verification pending**
- [ ] **7.6.2** Query block with the user's custom datascript map (`{:query [:find (pull ?b [*]) :where [?b :logseq.property/status ?s] (or …)]}`) → bar renders with live counts — **the original bug report, manual verification pending**
- [ ] **7.6.3** Bare `[:find (pull ?b [*]) :where …]` vector query → bar renders
- [ ] **7.6.4** Empty / invalid / unknown query form → `showOnEmpty` behavior applies; no crash, no console.error spam
- [ ] **7.6.5** `DB.onChanged` still triggers re-render on status flip

> **Blocker note:** During E2E, Logseq emitted a recurring `Update Error: Arguments to path.join must be strings` on the in-memory Demo graph, causing constant React re-renders that destroyed Playwright's JS execution context before async `logseq.api.append_block_in_page(...)` calls could resolve. This is the same category of host instability tracked under 6.6. Phase 7 code paths are covered by the 33 dedicated unit tests (including the original bug report's exact query) and by automatic verification that the renderer registration reaches the host; full visual smoke is queued behind a stable 0.3.2 host build.

### 7.7 Docs + cleanup

- [x] **7.7.1** `REQUIREMENTS.md` §1.3 updated — both DSL and custom datascript forms documented, `(pull ?b [*])` contract called out, `:inputs` listed as a non-goal.
- [x] **7.7.2** `CHANGELOG.md` Unreleased section gained an "Unified query mode (Phase 7)" entry covering added modules, LOC delta, and test counts.
- [x] **7.7.3** 6.7 parked-note premise removed — item closed and cross-references Phase 7.

### Non-goals (YAGNI, explicit)

- ❌ No `:inputs` support. Users wanting parametrized queries can inline the values.
- ❌ No support for `:find` shapes other than `(pull ?b [*])` (or an equivalent that returns block entities). Document this.
- ❌ No host-side `custom_query` workaround or upstream fix filed from this repo — out of scope.
- ❌ No in-DB `GROUP BY` / `count` aggregation. Pull blocks, count in JS. Acceptable up to ~low thousands of blocks per query; re-evaluate only if profiling says so.

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
- [ ] **6.7** *(optional follow-up)* migrate hand-rolled DSL parsing in `scanner.ts` to `DB.customQuery`
- [ ] **6.8** *(optional follow-up)* evaluate `Experiments.registerHostedRenderer` for a settings/summary panel

# Logseq Progress Bar Plugin — Task Tracker

> Track all implementation tasks here. Mark tasks `[x]` as they are completed.
> Reference: [REQUIREMENTS.md](./REQUIREMENTS.md) | [CHANGELOG.md](./CHANGELOG.md) | [TESTING.md](./TESTING.md)

---

## Phase 0: Project Setup

- [x] Initialize project with Vite + TypeScript scaffold
- [x] Configure `package.json` with plugin metadata and scripts
- [x] Set up `@logseq/libs` dependency
- [x] Create `tsconfig.json` with strict mode
- [ ] Set up ESLint + Prettier
- [x] Create `.gitignore` for node_modules, dist, etc.
- [ ] Verify plugin loads in Logseq dev environment

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
- [x] **1.6** Implement block scanner — query mode
  - Given a query block UUID, execute the query and collect result blocks
  - Use `DB.datascriptQuery` or `DB.q` to fetch query results
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
  - When `query: <uuid>` param is present, fetch the query block
  - Execute the query's DSL to get result blocks
  - Aggregate and render progress bar for query results
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

---

## Phase 5: Documentation & Release

- [ ] **5.1** Write user-facing README.md
  - Installation instructions
  - Usage examples (manual, auto-detect, query)
  - Settings reference
  - Screenshots/GIFs
- [ ] **5.2** Finalize CHANGELOG.md for v0.1.0
- [ ] **5.3** Build production bundle
- [ ] **5.4** Test production build in Logseq
- [ ] **5.5** Publish to Logseq marketplace (or prepare for manual install)

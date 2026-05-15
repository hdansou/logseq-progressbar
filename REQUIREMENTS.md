# Logseq Progress Bar Plugin — Requirements

## Overview

A Logseq DB-graph plugin that visualizes task/item completion as a segmented progress bar. Progress is derived from configurable properties (e.g., `status`, `state`) on blocks with specified tags (e.g., `#Task`, `#Project`). Supports auto-detection, manual placement via renderer macro, and integration with Logseq Queries.

**Target platform**: Logseq DB graphs only (not file-based graphs).

**SDK**: `@logseq/libs ^0.3.2`. The plugin manifest declares `supportsDB: true`, `supportsDBOnly: true`, and `minSDKVersion: "0.3.2"` in `package.json#logseq`.

---

## 1. Placement & Trigger Modes

### 1.1 Auto-Detect Mode

- Automatically render a progress bar on any block/page whose descendants include blocks with configured tags.
- The bar appears inline with the parent block content.

### 1.2 Manual Mode (Renderer Macro)

- Insert via `{{renderer :progress-bar}}` — uses global plugin settings as defaults.
- Supports per-instance overrides:

  ```txt
  {{renderer :progress-bar, tags: Task|Bug, property: status, depth: 2, complete: Done|Canceled}}
  ```

### 1.3 Query Integration

- Attach a progress bar to a query block — either by including the renderer
  in the query block's own title, or by referencing the block UUID:

  ```txt
  {{renderer :progress-bar, query: <query-block-uuid>}}
  ```

- The bar renders alongside the query block title (e.g., "Current Week Tasks").
- The bar aggregates statuses from the query's result set.
- **Both query forms are supported**:
  - **DSL** — the Logseq simple-query syntax, e.g. `(task "Todo" "Doing")`, `(and (task "Done") (tags [[Project]]))`, `(between [[journal-uuid-1]] [[journal-uuid-2]])`.
  - **Custom datascript** — full datalog, either as a `{:query [:find … :where …]}` map or a bare `[:find … :where …]` vector. The `:find` clause must pull blocks, typically `(pull ?b [*])`.
- Results are grouped by the tracked property and counted in the plugin;
  the progress bar reflects the query's result set regardless of form.
- **Not supported** (non-goals): `:inputs` parameter binding, non-pull
  `:find` shapes. Parametrized queries should inline their values.

---

## 2. Scope & Depth

- **Configurable depth**: User sets how deep the plugin scans for matching blocks.
  - `depth: 1` — direct children only.
  - `depth: 0` or `depth: all` — unlimited recursion (all descendants).
  - Default: unlimited (`all`).
- **Page-level scope**: When placed at the page level, scans all blocks on the page within the configured depth.

---

## 3. Tag Scoping

### 3.1 Tag-to-Property Mapping

- Users define which tags are in scope and which property each tag uses for progress tracking.
- Example configuration:

  | Tag       | Property | Complete Values    |
  | --------- | -------- | ------------------ |
  | `Task`    | `status` | `Done`             |
  | `Project` | `state`  | `Completed`        |
  | `Bug`     | `status` | `Done`, `Canceled` |

### 3.2 Strict Filtering Mode

- **Default (off)**: All children are included; the tag determines which property/value mapping to apply. Untagged blocks use the default mapping.
- **Strict mode (on)**: Only blocks with matching tags are counted. Untagged blocks are excluded entirely.
- Configurable globally and per-instance.

### 3.3 Blocks Without a Status Value

- Blocks that match the tag scope but have no value set for the tracked property are **excluded** from the count.

---

## 4. Status Mapping & Completion

### 4.1 Built-in Status Support

- Default integration with Logseq's built-in `:logseq.property/status` property:
  - Backlog, Todo, Doing, In Review, Done, Canceled.
- Default "complete" value: `Done`.

### 4.2 Custom Property Support

- Users can track any reference/enum property, not just `status`.
- Example: a `state` property with values `Now`, `Next`, `Later`, `Completed`.
- Users define which values count as "complete" per property.

### 4.3 User-Configurable Completion Mapping

- In plugin settings, users map: `property → [complete values]`.
- Per-instance override via renderer args: `complete: Done|Canceled`.

### 4.4 Checkbox-Typed Properties

- A tagged block may declare a property of `:logseq.property/type :checkbox`
  (boolean). Logseq renders the native clickable checkbox at `:block-left`;
  the plugin does **not** render checkbox UI.
- The plugin treats boolean property values as a degenerate two-value enum:
  - `true` → counted in the **Done** bucket (also counted as _completed_).
  - `false` → counted in the **Todo** bucket (not completed).
- The `completeValues` map is bypassed for boolean values — `true` always
  counts as complete, `false` always does not. This keeps a checkbox tag
  configuration to one line (`Checklist → check`) with no separate
  complete-value list.
- Boolean and enum children are aggregated together under a single bar.
  `true`/`Done` share the same bucket; `false`/`Todo` share the same bucket.
- **Default built-in mapping**: `Checklist → check`. The plugin ships this
  default in settings; it does **not** create the class or property in the
  user's graph. Users author the class themselves (any class name works —
  the default just provides a turnkey path).
- Property-type discrimination is **value-based** at read time: a JS boolean
  value triggers the checkbox path. No schema lookup is required.

---

## 5. Visual Design

### 5.1 Bar Style

- **Rounded pill shape** (border-radius on both ends).
- **Segmented/stacked bar** — each status value gets its own colored segment.
- Segments ordered left-to-right: **completed states on the left, pending states on the right**.

### 5.2 Percentage Label

- Displayed on the right side of the bar.
- Shows completion ratio: `Done / Total`.
- **User-configurable display format**:
  - Percentage only: `54%`
  - Fraction only: `7/13`
  - Both: `7/13 · 54%`
  - Configurable in plugin settings; default: percentage only.

### 5.3 Colors

- Sensible default palette that adapts to dark/light mode automatically.
- Users can override colors per status value in plugin settings.
- Default suggestions:

  | Status     | Light Mode | Dark Mode |
  | ---------- | ---------- | --------- |
  | Done       | `#4ade80`  | `#22c55e` |
  | Doing/Now  | `#60a5fa`  | `#3b82f6` |
  | In Review  | `#facc15`  | `#eab308` |
  | Todo/Later | `#e2e8f0`  | `#475569` |
  | Backlog    | `#f1f5f9`  | `#334155` |
  | Canceled   | `#fca5a5`  | `#ef4444` |

### 5.4 Size & Width

- **Default**: Full width of the block content area.
- **Compact mode**: Fixed or custom width (e.g., 200px), inline next to block title.
- User-configurable: global setting + per-instance override.

### 5.5 Animation

- Smooth CSS transitions when segment widths change (e.g., when a task is completed).

### 5.6 Theme Adaptation

- Automatically adapts to Logseq's current theme (dark/light) via `App.onThemeModeChanged`.

---

## 6. Interactivity

### 6.1 Hover Tooltip

- Hovering over the progress bar shows a tooltip with the full status breakdown.
- Example tooltip:

  ```txt
  Done: 7
  Doing: 2
  In Review: 1
  Todo: 3
  ─────────
  Total: 13
  ```

### 6.2 No Click Action

- The bar is purely visual beyond the tooltip. No click interactions.

---

## 7. Multiple Progress Bars

- A single page can have **multiple independent progress bars**, each tracking its own scope.
- User chooses between:
  - **Single aggregate bar** for the entire page.
  - **Multiple bars** — one per parent block, query, or sub-project.
- Each renderer instance is independent and can have its own overrides.

---

## 8. Settings Schema

### 8.1 Global Plugin Settings

| Setting            | Type    | Default                                    | Description                                                           |
| ------------------ | ------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `tagsInScope`      | string  | `"Task, Checklist"`                        | Comma-separated list of tags to track                                 |
| `propertyMappings` | object  | `{"Task": "status", "Checklist": "check"}` | Tag-to-property mapping (checkbox properties bypass `completeValues`) |
| `completeValues`   | object  | `{"status": ["Done"]}`                     | Property-to-complete-values mapping (string properties only)          |
| `defaultDepth`     | string  | `"all"`                                    | Default scan depth (`"1"`, `"2"`, ..., `"all"`)                       |
| `strictTagFilter`  | boolean | `false`                                    | Only count blocks with matching tags                                  |
| `displayFormat`    | enum    | `"percent"`                                | `"percent"`, `"fraction"`, `"both"`                                   |
| `barWidth`         | enum    | `"full"`                                   | `"full"`, `"compact"`, or pixel value                                 |
| `autoDetect`       | boolean | `true`                                     | Enable auto-detect mode                                               |
| `showOnEmpty`      | boolean | `false`                                    | Show bar when zero matching blocks                                    |
| `colorOverrides`   | object  | `{}`                                       | Per-status color overrides                                            |

### 8.2 Per-Instance Renderer Overrides

Supported params in `{{renderer :progress-bar, ...}}`:

| Param      | Example                    | Description                |
| ---------- | -------------------------- | -------------------------- |
| `tags`     | `tags: Task\|Bug`          | Override tags in scope     |
| `property` | `property: state`          | Override tracked property  |
| `complete` | `complete: Done\|Canceled` | Override complete values   |
| `depth`    | `depth: 2`                 | Override scan depth        |
| `strict`   | `strict: true`             | Override strict tag filter |
| `format`   | `format: both`             | Override display format    |
| `width`    | `width: 200px`             | Override bar width         |
| `query`    | `query: <uuid>`            | Track a query's results    |

---

## 9. Edge Cases

| Scenario                                     | Behavior                     |
| -------------------------------------------- | ---------------------------- |
| Zero matching blocks, `showOnEmpty: false`   | Hide progress bar entirely   |
| Zero matching blocks, `showOnEmpty: true`    | Show empty bar with 0%       |
| Block has matching tag but no property value | Exclude from count           |
| All items complete                           | Full green bar, 100%         |
| Query returns no results                     | Same as zero matching blocks |
| Query block is deleted/invalid UUID          | Show error indicator or hide |

---

## 10. Performance

- **Real-time updates** via `DB.onChanged` event listener — every DB
  mutation triggers `rerenderAll` over `activeRenderers`. Each entry's
  slot is re-validated (`UI.checkSlotValid`) and stale slots are pruned
  before re-rendering.
- No debounce in current implementation — graphs of 50+ blocks have
  rendered fine in practice. Add a debounce layer behind a setting if
  profiling shows real-time updates degrading.
- Compute progress from in-memory data; query mode uses a single
  `datascriptQuery` to pull all matching blocks with their tags +
  tracked property resolved inline (no per-block round-trips).

---

## 11. Technical Implementation Notes

### 11.1 Plugin API Usage

Targets `@logseq/libs ^0.3.2`. Concrete calls used by the current
implementation (not aspirational):

- **Rendering**: `App.onMacroRendererSlotted` for `{{renderer :progress-bar}}`.
  Each invocation registers in `activeRenderers` for re-render bookkeeping.
- **Query results**: `DB.datascriptQuery` for both query-block resolution
  (`:logseq.property/query → :block/title`) and bulk pulls of matching
  blocks with inline tag / tracked-property resolution.
- **Children mode**: `Editor.getBlock(uuid, {includeChildren: true})` for
  the parent + `Editor.getBlockProperties(childUuid)` per child. Tags are
  read from the props record under `":block/tags"` (DB graphs), with
  fallbacks for legacy key shapes. No separate `getTag`/`getTagObjects`
  calls.
- **Settings**: `useSettingsSchema` + `onSettingsChanged` for the global
  settings panel. The plugin's `onSettingsChanged` handler is args-less
  and just calls `rerenderAll`.
- **Theme**: `App.onThemeModeChanged` for dark/light adaptation.
- **UI**: `provideUI` + `provideStyle`. **All `provideUI` calls go through
  the local `safeProvideUI` helper** in `renderProgressBar` which
  re-checks `UI.checkSlotValid` immediately before the call — slots can
  unmount during the async DB work between the macro firing and the
  render.
- **Lifecycle**: `logseq.beforeunload` clears `activeRenderers` and runs
  the off-hook list collected during `main()`.

### 11.2 Renderer Macro Format

```txt
{{renderer :progress-bar}}
{{renderer :progress-bar, tags: Task|Bug, property: status}}
{{renderer :progress-bar, query: 69acb093-df21-438d-9bae-72decf188ed2}}
{{renderer :progress-bar, tags: Project, property: state, complete: Completed, format: both, width: 300px}}
```

### 11.3 Data Flow

```txt
1. Trigger (DB.onChanged | onSettingsChanged | onThemeModeChanged | macro slot)
2. renderProgressBar(slot, args, blockUuid):
   2a. Parse args + resolve config (global ↔ per-instance overrides)
3. countQueryStatuses(uuid):
   ├── resolveQueryRaw → classify → toBlockDatalog → datascriptQuery
   │   → entityToBlockData[] → aggregate → StatusCounts
   └── returns null if the block has no :logseq.property/query
4. (fallback when 3 returns null) scanChildren → filterByTags → aggregate
5. buildSegments(counts, total, completeValues, themeMode, overrides)
6. renderBar(segments, stats, config) → HTML
7. safeProvideUI(template) — drops the call if the slot is gone
```

### 11.4 Architecture reference

Detailed pipeline walkthrough, design decisions, and file/symbol map:
[`docs/query-progress-bar.md`](./docs/query-progress-bar.md).

---

## 12. Out of Scope (v1)

- File-based graph support.
- Click-to-filter or click-to-navigate interactions.
- Export/share progress bar as image.
- Progress tracking over time (historical charts).
- Notifications or alerts on completion milestones.

# Logseq Progress Bar Plugin — Testing Plan

> Reference: [REQUIREMENTS.md](./REQUIREMENTS.md) | [TASKS.md](./TASKS.md)

---

## 1. Testing Strategy

### 1.1 Test Levels

| Level                 | Tool                | Scope                                                                 |
| --------------------- | ------------------- | --------------------------------------------------------------------- |
| **Unit tests**        | Vitest              | Pure functions: arg parser, config resolver, aggregator, color system |
| **Integration tests** | Vitest + mocks      | Plugin API interactions: block scanning, query execution, settings    |
| **Manual E2E tests**  | Logseq dev instance | Full plugin behavior in a running Logseq DB graph                     |

### 1.2 Approach

- Unit tests are automated and run on every build (`npm test`).
- Integration tests mock `@logseq/libs` API calls.
- Manual E2E tests use a dedicated test graph with pre-built scenarios.
- Visual tests are manual — screenshot comparisons for bar rendering.

---

## 2. Unit Test Cases

### 2.1 Renderer Argument Parser

| #   | Test Case                        | Input                                    | Expected Output                        |
| --- | -------------------------------- | ---------------------------------------- | -------------------------------------- |
| U01 | Empty args                       | `{{renderer :progress-bar}}`             | Default config (all global settings)   |
| U02 | Single tag                       | `tags: Task`                             | `tags: ["Task"]`                       |
| U03 | Multiple tags (pipe-delimited)   | `tags: Task\|Bug\|Feature`               | `tags: ["Task", "Bug", "Feature"]`     |
| U04 | Property override                | `property: state`                        | `property: "state"`                    |
| U05 | Complete values (pipe-delimited) | `complete: Done\|Canceled`               | `completeValues: ["Done", "Canceled"]` |
| U06 | Depth numeric                    | `depth: 2`                               | `depth: 2`                             |
| U07 | Depth all                        | `depth: all`                             | `depth: Infinity` or `"all"`           |
| U08 | Strict mode                      | `strict: true`                           | `strict: true`                         |
| U09 | Format option                    | `format: both`                           | `displayFormat: "both"`                |
| U10 | Width pixel value                | `width: 200px`                           | `barWidth: "200px"`                    |
| U11 | Query UUID                       | `query: 69acb093-...`                    | `queryUUID: "69acb093-..."`            |
| U12 | Multiple params combined         | `tags: Task, property: status, depth: 1` | All three parsed correctly             |
| U13 | Whitespace tolerance             | `tags:  Task \| Bug `                    | `tags: ["Task", "Bug"]` (trimmed)      |
| U14 | Unknown param ignored            | `foo: bar, tags: Task`                   | `tags: ["Task"]`, `foo` ignored        |

### 2.2 Config Resolver

| #   | Test Case                                | Expected                                                        |
| --- | ---------------------------------------- | --------------------------------------------------------------- |
| U20 | Global settings only (no overrides)      | Returns global settings as-is                                   |
| U21 | Per-instance overrides merge over global | Override values take precedence                                 |
| U22 | Partial override                         | Only overridden fields change; rest from global                 |
| U23 | Empty global + per-instance              | Per-instance values used, missing fields get hardcoded defaults |

### 2.3 Status Aggregator

| #   | Test Case                          | Input Blocks                  | Expected                               |
| --- | ---------------------------------- | ----------------------------- | -------------------------------------- |
| U30 | All done                           | 5 blocks, all `Done`          | `{Done: 5}`, 100%                      |
| U31 | Mixed statuses                     | 2 Done, 1 Doing, 3 Todo       | `{Done: 2, Doing: 1, Todo: 3}`, 33%    |
| U32 | No matching blocks                 | Empty array                   | `{}`, 0%, triggers empty state         |
| U33 | Blocks with no property value      | 3 blocks, 1 has no status     | Only 2 counted                         |
| U34 | Custom property values             | `state: Now, Next, Completed` | Correct counts, `Completed` = complete |
| U35 | Multiple complete values           | `complete: [Done, Canceled]`  | Both count toward completion           |
| U36 | Single block                       | 1 block, `Todo`               | `{Todo: 1}`, 0%                        |
| U37 | All canceled (canceled = complete) | 3 Canceled                    | 100%                                   |

### 2.4 Color System

| #   | Test Case                          | Expected                                  |
| --- | ---------------------------------- | ----------------------------------------- |
| U40 | Default colors in light mode       | Returns light mode palette                |
| U41 | Default colors in dark mode        | Returns dark mode palette                 |
| U42 | User color override applied        | Override replaces default for that status |
| U43 | Unknown status gets fallback color | Falls back to a neutral gray              |

### 2.5 Display Format

| #   | Test Case       | Format     | Count | Total | Expected Label  |
| --- | --------------- | ---------- | ----- | ----- | --------------- |
| U50 | Percent         | `percent`  | 7     | 13    | `54%`           |
| U51 | Fraction        | `fraction` | 7     | 13    | `7/13`          |
| U52 | Both            | `both`     | 7     | 13    | `7/13 · 54%`    |
| U53 | Zero percent    | `percent`  | 0     | 10    | `0%`            |
| U54 | Hundred percent | `percent`  | 10    | 10    | `100%`          |
| U55 | Rounding        | `percent`  | 1     | 3     | `33%` (rounded) |

---

## 3. Integration Test Cases

### 3.1 Block Scanner

| #   | Test Case                      | Setup                                                   | Expected                               |
| --- | ------------------------------ | ------------------------------------------------------- | -------------------------------------- |
| I01 | Direct children only (depth 1) | Parent with 3 children, 2 grandchildren                 | Returns 3 blocks                       |
| I02 | All descendants (depth all)    | Same setup                                              | Returns 5 blocks                       |
| I03 | Depth 2                        | Parent → children → grandchildren → great-grandchildren | Returns children + grandchildren only  |
| I04 | Page-level scan                | Page with 10 top-level blocks, each with children       | Returns all blocks at configured depth |
| I05 | Empty parent                   | Parent with no children                                 | Returns empty array                    |

### 3.2 Tag Filter

| #   | Test Case                   | Setup                                      | Expected                      |
| --- | --------------------------- | ------------------------------------------ | ----------------------------- |
| I10 | Strict mode — only tagged   | 5 blocks: 3 #Task, 2 untagged              | Returns 3                     |
| I11 | Inclusive mode — all blocks | Same setup                                 | Returns 5                     |
| I12 | Multiple tags in scope      | 3 #Task, 2 #Bug, 1 #Feature (not in scope) | Strict: 5, ignoring #Feature  |
| I13 | Tag-to-property mapping     | #Task → `status`, #Project → `state`       | Correct property read per tag |

### 3.3 Query Integration

| #   | Test Case               | Setup                                 | Expected                       |
| --- | ----------------------- | ------------------------------------- | ------------------------------ |
| I20 | Valid query UUID        | Query block returning 8 tasks         | Aggregates 8 blocks            |
| I21 | Invalid query UUID      | Non-existent UUID                     | Returns error/empty gracefully |
| I22 | Query with zero results | Valid query, no matching blocks       | Empty state triggered          |
| I23 | Query results change    | Task status updated while bar visible | Bar re-renders with new counts |

### 3.4 Real-Time Updates

| #   | Test Case              | Action                               | Expected                                  |
| --- | ---------------------- | ------------------------------------ | ----------------------------------------- |
| I30 | Task completed         | Change block status from Todo → Done | Bar segments update, percentage increases |
| I31 | Task added             | New #Task block added under parent   | Bar re-counts, total increases            |
| I32 | Task removed           | #Task block deleted                  | Bar re-counts, total decreases            |
| I33 | Tag removed from block | Remove #Task tag from a block        | Block excluded from count                 |

---

## 4. Manual E2E Test Scenarios

### 4.1 Test Graph Setup

Create a test DB graph with the following structure:

```
Page: "Test Progress Bar"
├── Block: "Project Alpha" #Project (state: Now)
│   ├── Block: "Design UI" #Task (status: Done)
│   ├── Block: "Implement API" #Task (status: Doing)
│   ├── Block: "Write tests" #Task (status: Todo)
│   ├── Block: "Deploy" #Task (status: Backlog)
│   └── Block: "Untagged note" (no tag, no status)
├── Block: "Project Beta" #Project (state: Later)
│   ├── Block: "Research" #Task (status: Done)
│   ├── Block: "Prototype" #Task (status: Done)
│   └── Block: "Launch" #Task (status: In Review)
├── Block: "{{renderer :progress-bar}}"
├── Block: "{{renderer :progress-bar, tags: Task, format: both, width: 300px}}"
├── Block: "{{renderer :progress-bar, query: <query-uuid>}}"
└── Query: "Current Week Tasks" (DSL query for #Task)
```

### 4.2 E2E Test Cases

| #   | Scenario               | Steps                                                                             | Expected Result                                 |
| --- | ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| E01 | Basic render           | Load page with `{{renderer :progress-bar}}`                                       | Segmented bar appears with correct counts       |
| E02 | Manual with overrides  | Insert `{{renderer :progress-bar, tags: Task, format: both}}`                     | Bar shows only #Task blocks, label: `2/4 · 50%` |
| E03 | Query progress bar     | Insert `{{renderer :progress-bar, query: <uuid>}}`                                | Bar reflects query result statuses              |
| E04 | Auto-detect            | Enable auto-detect, navigate to page with #Task children                          | Bars appear on parent blocks automatically      |
| E05 | Real-time update       | Change a task from Todo → Done                                                    | Bar animates, percentage updates                |
| E06 | Theme switch           | Toggle dark/light mode                                                            | Colors update immediately                       |
| E07 | Empty state — hidden   | Set `showOnEmpty: false`, no matching blocks                                      | Bar not visible                                 |
| E08 | Empty state — shown    | Set `showOnEmpty: true`, no matching blocks                                       | Empty bar with 0%                               |
| E09 | Multiple bars          | Two renderer macros with different tag scopes                                     | Each bar shows independent counts               |
| E10 | Compact width          | `{{renderer :progress-bar, width: 200px}}`                                        | Bar renders at 200px inline                     |
| E11 | Custom property        | `{{renderer :progress-bar, tags: Project, property: state, complete: Completed}}` | Bar tracks `state` property on #Project blocks  |
| E12 | Settings change        | Change `displayFormat` in plugin settings                                         | All bars re-render with new format              |
| E13 | Tooltip hover          | Hover over progress bar                                                           | Tooltip shows status breakdown                  |
| E14 | 100% complete          | All tasks in scope are Done                                                       | Full green bar, 100%                            |
| E15 | Strict mode            | `{{renderer :progress-bar, strict: true}}`                                        | Untagged blocks excluded                        |
| E16 | Large page (50+ tasks) | Page with 60 #Task blocks                                                         | Bar renders without lag, updates smoothly       |

---

## 5. Visual Test Checklist

| #   | Check                                             | Pass? |
| --- | ------------------------------------------------- | ----- |
| V01 | Bar has rounded pill shape                        |       |
| V02 | Segments are proportionally sized                 |       |
| V03 | Completed segments are on the left                |       |
| V04 | Pending segments are on the right                 |       |
| V05 | Percentage label aligned to right of bar          |       |
| V06 | Tooltip appears on hover, positioned correctly    |       |
| V07 | Tooltip does not overflow viewport                |       |
| V08 | Colors match default palette in light mode        |       |
| V09 | Colors match default palette in dark mode         |       |
| V10 | Segment transitions animate smoothly              |       |
| V11 | Compact mode bar is inline with block content     |       |
| V12 | Full-width bar spans block content area           |       |
| V13 | Bar does not break block layout or cause overflow |       |
| V14 | Multiple bars on same page render independently   |       |

---

## 6. Performance Benchmarks

| Metric                     | Target         | Method                                    |
| -------------------------- | -------------- | ----------------------------------------- |
| Initial render (10 tasks)  | < 50ms         | `performance.now()` around render cycle   |
| Initial render (50 tasks)  | < 200ms        | Same                                      |
| Re-render on status change | < 100ms        | Measure from `DB.onChanged` to DOM update |
| Memory (idle, 5 bars)      | < 5MB overhead | Browser DevTools heap snapshot            |

If targets are not met, enable debounce (300ms) and re-measure.

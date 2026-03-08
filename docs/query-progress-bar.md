# Query Progress Bar: Architecture & Data Flow

## Overview

The progress bar plugin supports two scan modes: **child-block scanning** (default) and **query-block scanning**. This document covers the query path end-to-end, from detecting a query block through rendering the final progress bar.

The query path solves a hard problem: re-executing Logseq query DSL from the plugin sandbox, where several API features (date bindings, task predicates) don't work the same as in Logseq's internal query engine.

---

## 1. Query Block Detection (`index.ts:61-75`)

When `{{renderer :progress-bar}}` is placed inside a block, the plugin needs to determine whether that block is a **query node** (Logseq `#Query` block) or a regular block with children.

**Auto-detection via datascript:**

```clojure
[:find (pull ?b [:logseq.property/query]) .
 :where [?b :block/uuid #uuid "<blockUuid>"]]
```

If the entity has a `:logseq.property/query` property (even as a reference `{db/id: N}`), the block is treated as a query block and `config.queryUUID` is set to the block's UUID.

This means users don't need to pass `query: <uuid>` in the macro arguments -- the plugin figures it out automatically.

**Manual override:** Users can still pass `query: <uuid>` as a renderer argument to point at a different query block.

---

## 2. DSL Resolution (`scanner.ts:269-345`)

In DB graphs, `:logseq.property/query` stores a **reference** (`{db/id: N}`) to a property value entity, not the raw DSL string. The SDK's `getBlockProperty` returns the definition entity, not the actual value. Three strategies attempt to extract the DSL string:

### Strategy 1: Pull full entity

```clojure
[:find (pull ?b [*]) .
 :where [?b :block/uuid #uuid "<uuid>"]]
```

Walks all key-value pairs looking for a string that starts with `(` and ends with `)` (valid DSL). Checks one level of nested objects too.

### Strategy 2: Resolve the query reference's title

```clojure
[:find ?q .
 :where
 [?b :block/uuid #uuid "<uuid>"]
 [?b :logseq.property/query ?qid]
 [?qid :block/title ?q]]
```

Follows the reference chain: block -> query property ref -> the ref's `:block/title`, which contains the actual DSL string.

### Strategy 3: `getBlock()` + deep inspect

Falls back to `logseq.Editor.getBlock(uuid)` and recursively inspects the block object and its `.properties` for DSL strings.

**Result:** A DSL string like `(and (task "Done" "Doing" "Todo") (between [[uuid1]] [[uuid2]]))`

---

## 3. Four-Attempt Query Execution (`scanner.ts:59-95`)

The resolved DSL may contain clauses the plugin API can't handle. A fallback chain tries progressively simpler approaches:

### Attempt 1: Execute full DSL via `DB.q()`

```typescript
const res = await logseq.DB.q(queryStr);
```

Works for simple queries like `(tags [[Task]])`. Fails for queries with `(between ...)` (needs date bindings) or `(task ...)` (may return empty in DB graphs via plugin API).

### Attempt 2: Strip `(between ...)` and retry

`stripBetweenClause()` removes date-range clauses:

```
Input:  (and (task "Done" "Doing" "Todo") (between [[uuid1]] [[uuid2]]))
Output: (task "Done" "Doing" "Todo")
```

Also cleans up leftover `(and X)` wrappers to just `X`.

**Trigger condition:** Attempt 1 returned empty (`!queryResults?.length`). This is important -- an empty array `[]` from attempt 1 no longer blocks fallbacks.

### Attempt 3: Datascript task status query

Parses `(task "Done" "Doing" "Todo")` to extract status values, then queries directly:

```clojure
[:find (pull ?b [:block/uuid])
 :where
 [?b :logseq.property/status ?s]
 [?s :block/title "Done"]
 ;; Optional date filtering:
 [?b :block/page ?p]
 [?p :block/journal-day ?d]
 [(>= ?d 20260307)]
 [(<= ?d 20260309)]]
```

**Date parsing from journal UUIDs:** DB graph journal pages use deterministic UUIDs with pattern `00000001-YYYY-MMDD-0000-000000000000`. The function `parseBetweenDates()` extracts `YYYYMMDD` integers for datascript comparison.

Runs one query per status value, deduplicates results by UUID.

### Attempt 4: `getTagObjects()` fallback

Extracts `[[tag]]` references from the DSL via regex and calls `logseq.Editor.getTagObjects(tagName)` for each. Last resort when all other approaches fail.

---

## 4. UUID Resolution (`scanner.ts:99-118`)

**The problem:** `DB.q()` in DB graphs returns entities as `{id: N}` (numeric entity IDs) without a `uuid` field. The rest of the pipeline needs string UUIDs to call `getBlock()`, `getBlockProperties()`, etc.

**The fix:** For each result missing `.uuid`, resolve it via datascript:

```clojure
[:find ?u .
 :where [<entity-id> :block/uuid ?u]]
```

The resolved UUID (which may come back as a UUID object) is coerced to a string and attached to the block before passing to `toBlockData()`.

---

## 5. Block Data Assembly (`scanner.ts:390-430`)

Each block with a resolved UUID is enriched into a `BlockData`:

```typescript
interface BlockData {
  uuid: string;
  tags: string[];              // e.g. ["Task"]
  properties: Record<string, unknown>;  // e.g. {status: "Done"}
}
```

**Tag extraction** handles multiple formats from the SDK:
- `props.tags` (array of strings)
- `props["block/tags"]` (alternative key)
- Tag reference objects with `.name`, `.title`, or `.content` fields

---

## 6. Aggregation Pipeline

### Tag Filtering (`scanner.ts:352-366`)

- **Strict mode:** Only blocks with at least one matching tag from `config.tags`
- **Inclusive mode** (default): All blocks pass through; tag-to-property mapping happens during aggregation

### Status Counting (`aggregator.ts`)

For each block:
1. Find the property to read via tag-to-property mapping
2. Extract the string value (handles nested objects with `.name`/`.title`)
3. Increment `counts[statusValue]`
4. Check if the value is in `completeValues` to count completions

**Output:** `StatusCounts { counts: {"Done": 3, "Todo": 2}, total: 5, completed: 3, percent: 60 }`

### Segment Building (`colors.ts`)

Each status becomes a `BarSegment` with:
- Percentage width: `count / total * 100`
- Color from theme-aware palette (defaults for done/doing/todo/canceled, or user overrides)
- Sort order: completed first, then by priority (Done > Canceled > In Review > Doing > Todo > Backlog)

---

## 7. HTML Rendering (`renderer.ts`)

```html
<div class="pb-wrapper" data-id="pb-<uuid>">
  <div class="pb-bar" title="Done: 3&#10;Todo: 2&#10;───&#10;Total: 5">
    <div class="pb-segment" style="width:60%;background:#22c55e"></div>
    <div class="pb-segment" style="width:40%;background:#9ca3af"></div>
  </div>
  <span class="pb-label">60%</span>
</div>
```

Segment widths animate with `transition: width 0.4s ease-in-out`.

---

## 8. Real-Time Updates

The plugin maintains an `activeRenderers` Map tracking every rendered progress bar by `slot + blockUuid`.

Three events trigger `rerenderAll()`:
- **`DB.onChanged`** -- any database mutation (task status change, block edit)
- **`onSettingsChanged`** -- plugin settings update
- **`onThemeModeChanged`** -- light/dark theme switch

Each re-render checks `logseq.UI.checkSlotValid(slot)` first. Invalid slots (navigated away) are pruned from the map.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Auto-detect via datascript, not block tags | Tags can be renamed; `:logseq.property/query` is the source of truth |
| Four-attempt fallback chain | Plugin API `DB.q()` doesn't support all DSL features (date bindings, task predicates) |
| Resolve UUIDs from entity IDs | `DB.q()` returns `{id: N}` in DB graphs, not `{uuid: "..."}` |
| Parse journal UUIDs for date range | `(between ...)` references journal pages by their deterministic UUID pattern |
| Use `:logseq.property/status` not `:logseq.task/status` | DB graphs store task status under the generic property namespace |
| Check `!queryResults?.length` not `!queryResults` | Empty arrays from successful-but-empty queries must not block fallback attempts |

---

## File Map

| File | Role |
|------|------|
| `index.ts:61-75` | Query block auto-detection |
| `scanner.ts:42-120` | `scanQuery()` -- orchestrates DSL resolution, fallback chain, UUID resolution |
| `scanner.ts:125-215` | Task status parsing, date parsing, datascript fallback queries |
| `scanner.ts:269-345` | `resolveQueryDSL()` -- three-strategy DSL extraction |
| `aggregator.ts` | Status counting and completion percentage |
| `colors.ts` | Theme-aware color mapping and segment sorting |
| `renderer.ts` | HTML generation with tooltips and animations |
| `types.ts` | `ProgressBarConfig`, `StatusCounts`, `BarSegment` interfaces |

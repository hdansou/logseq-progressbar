# Lessons

Corrections and patterns accumulated during development on this project.
Read at the start of every session. Updated after every correction.

---

<!-- Format:
## [Date] — [Category]
**Mistake**: What went wrong
**Correction**: What should have happened
**Rule**: Preventive rule for the future
-->

## 2026-10-15 — Property writes re-enter DB.onChanged (carried over from logseq-callout)

**Mistake**: A sibling plugin wrote a block property from a scan that was
itself triggered by `DB.onChanged`. Logseq stamps `:block/updated-at` on
every property write, even an unchanged one, so the write produced a
transaction, the hook fired again, and the plugin looped at the debounce
interval.

**Correction**: Decide writes in a pure function that compares the current
value first; only write when it differs.

**Rule**: This plugin never writes to the graph (AGENTS.md boundary). Keep
it that way, and prove it in every live run with host-side counters on
`logseq.api` write functions. If a feature ever needs a write, it must be
idempotent at the decision level and the hook must be filtered.

## 2026-10-15 — DB-graph entity refs come back as `{ id }` (carried over)

**Mistake**: Reading `name` / `title` directly off `block.tags` / `block.refs`
from tree calls. In DB graphs those are bare `{ id: number }` refs.

**Correction**: `getBlockProperties(uuid)` returns `":block/tags"` as plain
strings (what this plugin uses); `getBlock(uuid).tags` carries full entities;
`getPageBlocksTree()` blocks still carry `{ id }` only.

**Rule**: Verify the shape on a real DB graph before reading a name off a ref
object; resolve ids through the matching `getX(id)` and cache per session.

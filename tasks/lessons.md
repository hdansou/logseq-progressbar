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

## 2026-10-15 — Setting `status` auto-tags the block with #Task

**Mistake**: The live seed created "untagged" blocks by setting
`logseq.property/status` on them; Logseq DB adds the `Task` tag whenever a
Task class property is set, so the strict-filter scenarios had nothing to
exclude and the override-display bar read 2/2 instead of 1/1.

**Correction**: Untagged fixtures carry a non-class property (`check`) instead.

**Rule**: In DB graphs a class property implies its class. Never assume a
block stays untagged after a property write; read `:block/tags` back.

## 2026-10-15 — The ident cache went stale the moment a class was created

**Mistake**: `identCache` was refreshed only at init, settings change and
graph switch. A `Checklist`/`Tido` class created after the plugin loaded was
unknown until the next settings change, so tagged-but-unset checkbox blocks
were not counted (the exact "why isn't this block counted?" report in
AGENTS.md) — the live seed showed 50 % where 33 % was right.

**Correction**: Refresh the cache at the start of every debounced re-render
pass (two Datascript queries per burst, cheap next to the per-slot scans).

**Rule**: Any cache of graph schema must be refreshed on the same trigger as
the data it decorates, not only on configuration events.

## 2026-10-15 — The shared dev-server plugin silently widened CORS to `*`

**Mistake**: `vite-logseq-safe-plugin.ts` (copied from logseq-callout) sets
`cors: true` in its `config` hook, overriding the `server.cors.origin`
restriction in `vite.config.ts`. `curl -H "Origin: http://evil.example"`
got `Access-Control-Allow-Origin: *` although the config said localhost:3001.
logseq-callout has the same line.

**Correction**: The plugin no longer touches `cors`; verified with curl from
an allowed and a foreign origin.

**Rule**: Verify a security setting from the outside (curl with a foreign
Origin), never from the config file alone; a later hook can override it.

## Desktop test instance: graph removal leaves a registry entry

`logseq graph remove -g <name>` after `stop.sh` deletes the graph directory,
but the instance had already written the graph into `~/.logseq/graphs.edn`
when it switched to it, and the CLI does not take that entry back out. The
app lists graphs by scanning the directory, so the stale entry is invisible
in All graphs, but a content diff of `graphs.edn` will show it. Removing the
graph from the instance's All graphs page *before* `stop.sh` keeps the
registry clean; do that when the proof must cover `graphs.edn` too.

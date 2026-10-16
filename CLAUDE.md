# CLAUDE.md

Guidance for Claude Code in this repository. Non-discoverable landmines
(Logseq DB SDK shapes, inheritance paths, design boundaries) live in
`AGENTS.md` — read it first; this file is the operating manual.

## Agent Operating Principles

1. **Plan mode default** — any non-trivial task (3+ steps or an
   architectural decision) starts in plan mode; re-plan when something goes
   sideways instead of pushing on.
2. **Self-improvement loop** — after any correction from the owner, add the
   pattern to `tasks/lessons.md`; read it at session start.
3. **Verification before done** — `pnpm typecheck && pnpm test` after every
   change; `pnpm e2e` before claiming a behaviour works; never mark a task
   complete without proof.
4. **No graph mutation** — the plugin reads and renders, never writes.
   `pnpm e2e` counts every SDK call and fails on a single write.
5. **DRY · KISS · YAGNI** — applied as a review pass before merge; delete
   before adding; three similar lines beat a premature abstraction.
6. **Conventional commits by category** (`feat:` / `fix:` / `refactor:` /
   `test:` / `chore(deps):` / `chore(security):` / `docs:` /
   `chore(release):`). No push, tag or release without the owner's go-ahead.

## Workflow

1. Plan (plan mode) → write checkboxes into `tasks/todo.md`.
2. TDD per task: RED (failing test next to the module) → GREEN → REFACTOR.
3. `CHANGELOG.md` `[Unreleased]` entry as each change lands.
4. Live verification (`pnpm e2e`, and `pnpm e2e:desktop` for changes the
   desktop host could see differently).
5. Docs (`README.md`, `REQUIREMENTS.md`, `AGENTS.md`, this file) in the same
   pass; commit per category.

## Project Overview

**logseq-progressbar** renders `{{renderer :progress-bar}}` as a segmented
progress bar over the statuses of a block's descendants or a query's
results. DB graphs only (`supportsDBOnly`), `web: true`, `effect: false`
(the plugin never touches `parent.document`; `provideUI` / `provideStyle`
go through the SDK).

## Stack

- TypeScript (ES2020), Vite 7 (esbuild minify, no sourcemaps).
- `@logseq/libs` ^0.3.4 (npm `next` tag; `latest` is the legacy 0.0.x
  line). `src/__sdk_guard__.ts` fails typecheck below `minSDKVersion`.
- pnpm 12 (`packageManager`, `pnpm-lock.yaml`; overrides live in
  `pnpm-workspace.yaml` — pnpm 12 ignores `package.json#pnpm`). Node 24
  (`.nvmrc`); the shell default may be 22 — `nvm use` first. The Node 24
  corepack shim may lack pnpm; `/opt/homebrew/bin/pnpm` works.
- vitest 5 + `@vitest/coverage-v8`, 80 % gate on all four metrics
  (`src/index.ts` and the guard excluded).

## Commands

```bash
pnpm install        # deps (pnpm audit must stay at 0)
pnpm dev            # Vite dev server at http://localhost:8296 (CORS limited to localhost:3001; HMR reloads the plugin)
pnpm watch          # rebuild dist/ on change (no server)
pnpm build          # production build → dist/
pnpm typecheck      # tsc --noEmit (includes the SDK-floor guard)
pnpm test           # vitest run --coverage (CI-blocking; unit + 1872-case matrix)
pnpm test:watch
pnpm e2e            # live matrix in the Logseq web app (~4 min; see scripts/e2e/progress-matrix.sh header)
pnpm e2e:desktop    # live matrix in a second desktop instance (see scripts/e2e/desktop-matrix.sh header)
pnpm audit          # must report "No known vulnerabilities found"
```

## Testing

- **Web app** at `http://localhost:3001`: `pnpm watch` in
  `~/Projects/src/github.com/logseq` (pnpm, not yarn). `pnpm e2e` registers
  the plugin from `:8296` via `LSPluginCore.register` (key
  `logseq-progressbar`), seeds "Progress Matrix" idempotently, runs the
  matrix and prints counters. `KEEP=1 pnpm e2e` leaves the tab open. The
  in-memory Demo graph is wiped by a page reload; the registration survives.
- **Desktop app**: `scripts/e2e/launch-desktop.sh 9333` (launch.sh plus the
  timer-throttling flags) → `cdp.mjs graph <throwaway containing "test">`
  → `pnpm build` → `pnpm e2e:desktop`. The plugin must be an unpacked
  install from this folder so the instance loads it as
  `lsp://logseq.com/external/…`. Settings are applied by overriding the
  plugin frame's `logseq.settings` getter; the runner diffs
  `~/.logseq/settings/logseq-progressbar.json` before/after. Stop with the
  skill's `stop.sh`; remove the throwaway graph from All graphs.
- **Payload rules** (`playwright-cli eval` / `cdp.mjs eval`): one
  expression, no top-level `;`, no arrow functions, result stored on
  `window.__…` and polled.
- Host-side counters: wrap `logseq.api.<fn>` in the host page; the plugin's
  SDK calls arrive there by name. The test's own writes go through the saved
  originals so they are not counted.

## Architecture

| File | Role |
|---|---|
| `src/index.ts` | Thin adapter — the only `import "@logseq/libs"`. Builds `SdkPort`, tracks slots, debounces re-renders (300 ms DB / 100 ms settings, graph / 50 ms theme), refreshes the ident cache before each pass, owns `safeProvideUI`, unsubscribes everything in `beforeunload`. Excluded from coverage. |
| `src/sdk.ts` | `SdkPort`: `datascriptQuery`, `getBlock`, `getBlockProperties`, `getPageBlocksTree`. |
| `src/progress.ts` | `resolveInstance` → `computeStats` (query mode, else children) → `renderTemplate`. |
| `src/slots.ts` | Slot registry with a per-slot generation counter (stale renders are dropped). |
| `src/settings.ts` | Schema, `readGlobalConfig(raw)` with defensive coercion, `resolveConfig`. |
| `src/scanner.ts`, `src/query.ts` | Children/page walk; query classify → datalog → entity adapter (see `docs/query-progress-bar.md`). |
| `src/identCache.ts` | Property ident / type / class-property cache from two Datascript queries. |
| `src/aggregator.ts`, `src/colors.ts`, `src/renderer.ts` | Counting, palette + colour validation, HTML + width validation + CSS. |
| `src/matrix.test.ts` | Every feature × every settings permutation. |
| `scripts/e2e/` | Live matrices; `seed.browser.js` + `matrix.browser.js` shared by both runners. |
| `vite-logseq-safe-plugin.ts` | Dev-only: HMR plugin reload, writes the dev `dist/index.html`. Must not touch `cors`. |

Property lookup, class-property inheritance, compiled-DSL rewriting and the
`{:db/id N}` pull stubs are explained in `AGENTS.md`.

## Known Issues

- **Auto-detect mode is not implemented** (REQUIREMENTS §1.1); the setting
  that advertised it was removed in 1.3.0.
- **`full` width is not block-wide**: the host mounts the macro slot
  `inline-flex` in the title, so the bar renders at its minimum width next
  to the title (README screenshot look). A block-wide bar needs a
  block-level slot, which the host does not offer.
- **Every slot re-renders on any DB change** (bounded by the 300 ms
  debounce). Query mode can depend on any block, so the hook is not
  page-filtered. `getCurrentPage` is not used at all.
- **Slot hooks cannot be unsubscribed** (`onMacroRendererSlotted` returns
  void); the host drops them on unload.
- **Ident cache and new classes**: refreshed before every pass since 1.3.0;
  before that a class created after load was invisible until a settings
  change.
- **Setting a class property tags the block** (`status` → `#Task`); see
  `AGENTS.md`.
- **Desktop test instance**: a hidden Electron window throttles timers to
  one wake per minute after ~5 min; `launch-desktop.sh` passes the flags
  that disable it, and the runner measures a 1 s timer first. Never run two
  matrices on one instance.
- **Query mode is incomplete** (assessed live 2026-10-15, `tasks/todo.md`
  Phase 9): `or` / `not` / relative `between` / `priority` / `page-tags`
  are ignored or inverted silently, user and checkbox properties are not
  read in query mode, `:inputs` and compiled rules other than `(task ?b
  #{…})` fail. The host's `logseq.api.q` is broken for DSL in the current
  build, so the plugin must keep (and finish) its own compiler.
- **`scanPage` is unused** by production code (kept for REQUIREMENTS §2).

# Tasks

## Current: Production-hardening pass (2026-10-15)

Status: in progress
Started: 2026-10-15
Plan: `~/.claude/plans/purrfect-petting-nebula.md` (approved 2026-10-15)

Brings the repo in line with the owner's current plugin standards
(reference: logseq-callout v1.1.0): CSP + CORS, validated SDK input, pnpm +
Node 24, `@logseq/libs` 0.3.4 with SDK-floor guard, zero advisories, thin
adapter + pure modules with an 80 % coverage gate, feature × settings
matrices (unit, web app, desktop app), docs.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped

### Phase 0 — bookkeeping
- [x] `tasks/todo.md` (this file), `tasks/lessons.md`
- [x] `TASKS.md` pointer to this file; `CHANGELOG.md` `[Unreleased]` opened

### Phase 1 — toolchain & dependencies
- [x] npm → pnpm (`packageManager`, lockfile, overrides in `pnpm-workspace.yaml` — pnpm 12 ignores `package.json#pnpm`), `engines.node >=24`, `.nvmrc`
- [x] `@logseq/libs ^0.3.4`, `minSDKVersion 0.3.4`, `web`/`effect` flags inside `logseq{}`
- [x] `src/__sdk_guard__.ts` (`typeof logseq.Commands`, 0.3.4-only)
- [x] vite ^7.3.7, vitest ^5 + coverage-v8, @types/node ^24; drop `vite-plugin-logseq`; add `vite-logseq-safe-plugin.ts`; dev port 8296; CORS → localhost:3001
- [x] `pnpm audit` = 0 (overrides verified by resolved version)
- [x] `vitest.config.ts` merged into `vite.config.ts`; `manifest.test.ts` updated
- [x] CI + publish on pnpm / Node 24, test step (coverage gate thresholds land with Phase 2 once the split lifts coverage past 80 %)

### Phase 2 — thin adapter + injected SDK port (TDD)
- [x] `src/sdk.ts` — `SdkPort`
- [x] `src/settings.ts` (from `config.ts`) — `readGlobalConfig(raw)`, hardened coercion, `autoDetect` removed
- [x] `src/scanner.ts`, `src/identCache.ts` take `sdk`
- [x] `src/progress.ts` — `computeStats`, `renderTemplate`
- [x] `src/slots.ts` — registry + generation counter
- [x] `src/renderer.ts` — single `escape`, `cssWidth` / `cssColor` validators, `renderEmpty` width, dead CSS removed
- [x] `src/debug.ts` — `setDebug`
- [x] `src/index.ts` — thin adapter: debounce, stored off-hooks, slash unregister, `safeProvideUI`
- [x] tests moved next to modules; coverage gate 80 % excluding adapter + guard

### Phase 3 — matrix test
- [x] `src/matrix.test.ts`: 13 feature fixtures × 144 settings permutations = 1872 cases (caught: #Tido out-of-scope block is dropped by strict mode — documented behaviour, encoded as a strict-sensitive expectation)

### Phase 4 — light bugs
- [x] width / colour CSS injection (validators) — `cssWidth`, `isSafeColor`
- [x] depth / JSON / enum settings coercion
- [x] `renderEmpty` ignores width; `.pb-full-width` dead rule
- [x] out-of-order renders (generation counter)
- [~] `autoDetect` setting removed (schema done; README / REQUIREMENTS in Phase 7)
- [x] Tabler glyph check — not applicable: `grep -rn tabler src/` is empty; the plugin renders no icon glyphs

### Phase 5 — live run, web app (`pnpm e2e`)
- [x] `scripts/e2e/progress-matrix.sh`, `seed.browser.js`, `matrix.browser.js`
- [x] host-side counters: 0 write calls over the whole matrix (2880 reads / 48 permutations); reads stable 5 s after the last change (122 → 122)
- [x] 48 permutations × 11 scenarios = 539 checks green; status + checkbox flips re-render (1/4, 2/3); theme light/dark palette verified by computed colour; journal-page append → one burst (61 reads), bars unchanged

### Phase 6 — live run, desktop app (`pnpm e2e:desktop`)
- [ ] owner loads this folder once as an unpacked plugin in Logseq-DB.app (not in externals yet)
- [x] `scripts/e2e/desktop-matrix.sh` + `launch-desktop.sh` written (not yet run) with throttling flags, throwaway graph, settings override (shared settings file untouched, verified by content)
- [ ] matrix green; instance stopped; throwaway graph removed

### Phase 7 — docs
- [ ] README (pnpm, port, privacy = no graph writes, testing); REQUIREMENTS (§1.1, §8.1, §10, §11, §13); CLAUDE.md; AGENTS.md; `docs/query-progress-bar.md`; TESTING.md; CHANGELOG

### Phase 8 — release (owner's go-ahead only)
- [ ] 1.3.0: bump, date changelog, tag, push, confirm workflows + zip

### Findings log
- F11 (live) Setting `logseq.property/status` auto-tags the block with #Task — "untagged" fixtures must use a non-class property.
- F12 (live) identCache was stale for classes created after plugin load → unset inherited checkboxes not counted until a settings change. Fixed: refresh before every re-render pass.
- F13 (live) `vite-logseq-safe-plugin.ts` forced `cors: true`, overriding the localhost:3001 restriction (logseq-callout has the same line). Fixed here; verified with curl from a foreign Origin.
- F14 (live) The plugin iframe loads under the CSP from :8296 with no CSP violations; the only console error on the page is the host's own React key warning.
- F1 No CSP in `index.html`; `vite-plugin-logseq` sets `cors: true` unconditionally.
- F2 `barWidth` (settings and `width:` renderer arg) and `colorOverrides` land in `style=""` unvalidated; `escapeAttr` misses `&` and `<`.
- F3 `onSettingsChanged`, `onMacroRendererSlotted` off-hooks and the slash `CommandUnregister` are dropped; only theme / DB / graph hooks are unsubscribed.
- F4 `DB.onChanged` → `rerenderAll()` on every change, no debounce; concurrent async renders of one slot can publish out of order.
- F5 `autoDetect` setting exists in the schema but nothing reads it.
- F6 `.pb-full-width` is never applied; `renderEmpty` ignores `barWidth`.
- F7 `defaultDepth` `0`/`-1`/`abc` → `parseInt || Infinity` → `-1` scans nothing; JSON settings are not shape-checked (an array parses fine and breaks `Object.values`).
- F8 `npm audit` 2026-10-15: 10 advisories (2 critical tinypool/vitest, 4 high, 3 moderate, 1 low).
- F9 Manifest lacks `web` / `effect`; `engines.node >=20`; no `.nvmrc`; npm lockfile.
- F10 No Tabler glyphs in this plugin — the glyph-codepoint check does not apply.

### Progress log
- 2026-10-15: survey + plan approved; Phase 0 landed.
- 2026-10-15: Phase 1 (pnpm/Node 24/libs 0.3.4/audit 0), CSP, Phase 2 split (212 tests, coverage 95/87/100/97), Phase 3 matrix (1872 cases) landed.
- 2026-10-15: Phase 5 web matrix green (`pnpm e2e`): 48 × 11, 0 writes, no loop, real-time, theme, other-page. Found and fixed F11–F13. Desktop runner written, waiting on the unpacked install (Phase 6).

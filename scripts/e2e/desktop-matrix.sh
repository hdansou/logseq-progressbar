#!/usr/bin/env bash
# Live acceptance matrix in the Logseq DESKTOP app, driven over CDP through the
# owner's test-logseq-desktop skill (a second app instance with its own profile).
#
#   S=~/.claude/skills/test-logseq-desktop/scripts
#   logseq graph create -g progressbar-desktop-test
#   scripts/e2e/launch-desktop.sh 9333          # launch.sh + timer-throttling flags
#   node $S/cdp.mjs --port 9333 graph progressbar-desktop-test
#   pnpm build                                  # the dev install loads dist/ from this folder
#   pnpm e2e:desktop [port]                     # defaults to 9333
#   $S/stop.sh 9333                             # then remove the graph from All graphs
#
# The plugin must be installed in the desktop app as an unpacked plugin from
# this folder (Plugins → ⋯ → Load unpacked plugin); the instance shares
# ~/.logseq with the user's app and loads it as `lsp://logseq.com/external/…`.
#
# A hidden Electron window gets Chromium's intensive timer throttling after
# ~5 min (one wake per minute): the plugin's debounce and every wait here
# crawl. launch-desktop.sh passes the flags that disable it; the runner
# measures a 1 s timer and warns when it is throttled.
#
# Settings permutations are applied by overriding the plugin frame's
# in-memory settings; the shared ~/.logseq/settings/<id>.json is never
# written (the user's running Logseq watches that file). The runner diffs the
# file's content before/after to prove it. Refuses to run on a graph that is
# not named like a throwaway (contains "test").
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT=${1:-9333}
CDP=${CDP:-$HOME/.claude/skills/test-logseq-desktop/scripts/cdp.mjs}
[[ -f "$CDP" ]] || { echo "cdp.mjs not found at $CDP (test-logseq-desktop skill)"; exit 2; }
curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/json" || { echo "no CDP instance on port $PORT (scripts/e2e/launch-desktop.sh first)"; exit 2; }

PLUGIN_ID=$(node -e 'console.log(require("./package.json").logseq.id)')
SETTINGS_FILE="$HOME/.logseq/settings/$PLUGIN_ID.json"
ev() { node "$CDP" --port "$PORT" eval -e "$1" 2>&1 | tail -1; }
payload() { sed -e "s|__PLUGIN_ID__|$PLUGIN_ID|" -e "s|__APPLY__|override|" -e "s|__FRAME__|$(basename "$PWD")/dist|" "$1"; }

GRAPH=$(ev 'return (await logseq.api.get_current_graph()).name')
[[ "$GRAPH" == *test* ]] || { echo "refusing: instance is on graph $GRAPH (switch to a throwaway graph with cdp.mjs graph <name>)"; exit 3; }
LOADED=$(ev "return String(LSPluginCore.registeredPlugins.get(\"$PLUGIN_ID\")?.loaded)")
[[ "$LOADED" == "true" ]] || { echo "plugin $PLUGIN_ID is not loaded in the instance (is it an unpacked install from this folder?)"; exit 3; }
ORIGIN=$(ev 'return [...document.querySelectorAll("iframe")].map(f => f.src).find(s => /progressbar/.test(s)) || ""')
[[ "$ORIGIN" == *"$(basename "$PWD")/dist"* ]] || { echo "plugin frame is not the dev install from this folder: $ORIGIN"; exit 3; }
TIMER=$(ev 'const t0 = performance.now(); await new Promise(r => setTimeout(r, 1000)); return Math.round(performance.now() - t0)')
HIDDEN=$(ev 'return String(document.hidden)')
if (( TIMER > 2500 )); then echo "⚠ timers are throttled (1 s timer took ${TIMER} ms, window hidden=$HIDDEN): relaunch with scripts/e2e/launch-desktop.sh or bring the window to the front"; fi
echo "→ graph: $GRAPH (window hidden=$HIDDEN, 1 s timer = ${TIMER} ms)"
echo "→ plugin: $ORIGIN"
SETTINGS_BEFORE=$(cat "$SETTINGS_FILE" 2>/dev/null || echo "")

TMP=$(mktemp -d -t pb-matrix)/payload.js
payload scripts/e2e/seed.browser.js > "$TMP"; node "$CDP" --port "$PORT" eval "$TMP" >/dev/null 2>&1 || true
for ((i = 0; i < 24; i++)); do r=$(ev 'return window.__seedResult ? JSON.stringify(window.__seedResult) : null'); [[ "$r" != "null" && -n "$r" ]] && break; sleep 5; done
echo "→ seed: $r"
sleep 3
payload scripts/e2e/matrix.browser.js > "$TMP"; node "$CDP" --port "$PORT" eval "$TMP" >/dev/null 2>&1 || true
echo "→ running 48 permutations × 11 scenarios (the desktop app takes a few minutes)"
last=""
for ((i = 0; i < 120; i++)); do
  r=$(ev 'return window.__matrixResult ? JSON.stringify(window.__matrixResult) : null'); [[ "$r" != "null" && -n "$r" ]] && break
  p=$(ev 'return String(window.__matrixProgress)'); [[ "$p" != "$last" ]] && { echo "   $p"; last=$p; }
  sleep 10
done
rm -rf "$(dirname "$TMP")"
SETTINGS_AFTER=$(cat "$SETTINGS_FILE" 2>/dev/null || echo "")
if [[ "$SETTINGS_BEFORE" != "$SETTINGS_AFTER" ]]; then echo "✗ $SETTINGS_FILE changed during the run"; SETTINGS_CHANGED=1; else echo "→ $SETTINGS_FILE unchanged (content identical)"; SETTINGS_CHANGED=0; fi
echo "$r" | node -e '
  let raw = require("fs").readFileSync(0, "utf8").trim()
  let r; try { r = JSON.parse(raw); if (typeof r === "string") r = JSON.parse(r) } catch { console.error("unreadable report:", raw); process.exit(4) }
  if (r.fatal) { console.error("FATAL:", r.fatal); process.exit(4) }
  console.log(`   permutations: ${r.permutations}, block checks: ${r.blocksChecked}, failures: ${r.failures.length}`)
  console.log(`   plugin writes during matrix: ${r.counters.matrixWrites}, reads: ${r.counters.matrixReads}, writes overall: ${r.counters.totalWrites}`)
  console.log(`   realtime: ${JSON.stringify(r.realtime)}`)
  console.log(`   theme: ${JSON.stringify(r.theme)}  other-page: ${JSON.stringify(r.otherPage)}`)
  for (const f of r.failures) console.log("   ✗ " + f)
  if (r.counters.totalWrites > 0) { console.log("   ✗ the plugin wrote to the graph"); process.exit(1) }
  process.exit(r.failures.length || Number(process.argv[1]) ? 1 : 0)' "$SETTINGS_CHANGED"

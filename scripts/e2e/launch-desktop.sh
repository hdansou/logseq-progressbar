#!/usr/bin/env bash
# Second Logseq desktop instance for `pnpm e2e:desktop`: the owner's
# test-logseq-desktop launch.sh, plus the Chromium flags that stop a hidden
# window from throttling timers to one wake per minute (which stalls the
# plugin's debounce and every wait in the matrix).
#   scripts/e2e/launch-desktop.sh [port]   # prints the profile dir
set -eu
PORT="${1:-9333}"
PROFILE="${TMPDIR:-/tmp}/logseq-cdp-$PORT"
APP="${LOGSEQ_APP:-/Applications/Logseq-DB.app/Contents/MacOS/Logseq}"
[ -x "$APP" ] || { echo "Logseq app not found at $APP (set LOGSEQ_APP)" >&2; exit 1; }
if curl -s -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "port $PORT is already serving CDP; stop that instance first (stop.sh $PORT)" >&2; exit 1
fi
rm -rf "$PROFILE"; mkdir -p "$PROFILE"
nohup "$APP" --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  >"$PROFILE.log" 2>&1 &
i=0
until curl -s -m 2 "http://127.0.0.1:$PORT/json/list" | grep -q '"type": *"page"'; do
  i=$((i + 1)); [ "$i" -gt 40 ] && { echo "no page target after 2 minutes; see $PROFILE.log" >&2; exit 1; }
  sleep 3
done
sleep 5
echo "$PROFILE"

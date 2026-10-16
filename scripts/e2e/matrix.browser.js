// Live acceptance matrix: every seeded scenario × every host-settings
// permutation, plus real-time, no-write/no-loop, theme and other-page
// checks. Runs inside the Logseq host page (single expression, no top-level
// semicolon, no arrow functions — see seed.browser.js).
// Placeholders: __PLUGIN_ID__, __APPLY__ ("settings" | "override"), __FRAME__.
void (window.__matrixResult = null, window.__matrixProgress = "starting", (async function () {
  var PAGE = "Progress Matrix"
  var api = window.logseq.api
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
  var failures = []
  var checked = 0

  // --- host-side counters: every call the plugin makes lands on logseq.api.<fn> ---
  var WRITES = ["upsert_block_property", "remove_block_property", "set_block_icon", "remove_block_icon", "update_block", "insert_block", "insert_batch_block", "remove_block", "move_block", "append_block_in_page", "prepend_block_in_page", "set_block_collapsed", "add_block_tag", "remove_block_tag", "create_page", "delete_page", "upsert_property", "create_tag"]
  var READS = ["datascript_query", "get_block", "get_block_properties", "get_page_blocks_tree"]
  if (!window.__pbCounters) {
    var raw = {}, counters = { writes: [], reads: [] }
    WRITES.concat(READS).forEach(function (name) {
      var fn = api[name]
      if (typeof fn !== "function") return
      raw[name] = fn
      var bucket = WRITES.indexOf(name) >= 0 ? counters.writes : counters.reads
      api[name] = function () { bucket.push({ fn: name, t: performance.now() }); return fn.apply(api, arguments) }
    })
    window.__pbCounters = { raw: raw, counters: counters }
  }
  var raw = window.__pbCounters.raw, counters = window.__pbCounters.counters
  // The test's own graph edits go through the raw functions so the counters only see the plugin.
  var testWrite = function (name) { return raw[name].apply(api, Array.prototype.slice.call(arguments, 1)) }
  var resetCounters = function () { counters.writes.length = 0; counters.reads.length = 0 }

  // --- settings application (see callout's matrix for the two modes) ---
  var APPLY = "__APPLY__"
  var plugin = LSPluginCore._registeredPlugins.get("__PLUGIN_ID__")
  var frameWin = APPLY === "override" ? document.querySelector('iframe[src*="__FRAME__"]').contentWindow : null
  var baseSettings = frameWin ? JSON.parse(JSON.stringify(frameWin.logseq.settings)) : (plugin ? JSON.parse(JSON.stringify(plugin.settings.toJSON ? plugin.settings.toJSON() : plugin.settings._settings || {})) : {})
  var applySettings = function (s) {
    if (APPLY === "override") {
      var merged = Object.assign({}, baseSettings, s)
      Object.defineProperty(frameWin.logseq, "settings", { configurable: true, get: function () { return merged } })
      frameWin.logseq.emit("settings:changed", merged, baseSettings)
    } else {
      for (var k in s) plugin.settings.set(k, s[k])
    }
  }
  var restoreSettings = function () {
    if (APPLY === "override") { delete frameWin.logseq.settings; frameWin.logseq.emit("settings:changed", baseSettings, baseSettings) }
    else { ["displayFormat", "barWidth", "strictTagFilter", "showOnEmpty", "defaultDepth"].forEach(function (k) { if (k in baseSettings) plugin.settings.set(k, baseSettings[k]) }) }
  }

  // --- scenarios on the page ---
  var tree = (await raw.get_page_blocks_tree(PAGE)) || []
  var byKey = {}
  for (var i = 0; i < tree.length; i++) { var m = /^pb:([a-z-]+)/.exec(tree[i].title || ""); if (m) byKey[m[1]] = tree[i] }
  var need = ["enum", "checkbox", "mixed", "untagged", "nested", "override-tags", "override-display", "query-dsl", "query-map", "query-ref", "empty"]
  var missing = need.filter(function (k) { return !byKey[k] })
  if (missing.length) return { fatal: "scenarios missing on " + PAGE + ": " + missing.join(", ") }
  await raw.push_state ? api.push_state("page", { name: PAGE }) : null
  await sleep(2000)

  // Expected stats per scenario given the effective settings (strict / depth).
  var E = function (counts, completed) { var total = 0; for (var k in counts) total += counts[k]; return { counts: counts, total: total, completed: completed } }
  var expected = function (key, s) {
    switch (key) {
      case "enum": return E({ Done: 2, Doing: 1, Todo: 1 }, 2)
      case "checkbox": return s.strictTagFilter ? E({ Done: 1, Todo: 1 }, 1) : E({ Done: 1, Todo: 2 }, 1)
      case "mixed": return E({ Done: 2, Todo: 2 }, 2)
      case "untagged": return s.strictTagFilter ? E({ Done: 1 }, 1) : E({ Done: 1, Todo: 1 }, 1)
      case "nested": return s.defaultDepth === "1" ? E({ Todo: 1 }, 0) : E({ Todo: 1, Done: 2 }, 2)
      case "override-tags": return E({ Completed: 1, Now: 1 }, 1)
      case "override-display": return E({ Done: 1 }, 1)
      case "query-dsl": case "query-ref": return E({ Done: 2, Todo: 1 }, 2)
      case "query-map": return E({ Done: 2, Todo: 1, Doing: 1 }, 2)
      case "empty": return E({}, 0)
    }
  }
  var forced = { "override-display": { format: "both", width: "300px" } }
  var labelFor = function (ex, format) {
    var pct = ex.total ? Math.round(ex.completed / ex.total * 100) : 0
    return format === "fraction" ? ex.completed + "/" + ex.total : format === "both" ? ex.completed + "/" + ex.total + " · " + pct + "%" : pct + "%"
  }
  var widthFor = function (w) { return w === "compact" ? "200px" : w === "full" ? "100%" : w }

  // Read the rendered bar of a scenario out of the host DOM.
  var readBar = function (key) {
    var el = document.querySelector('.ls-block[blockid="' + byKey[key].uuid + '"] .lsp-hook-ui-slot .pb-wrapper, .ls-block[blockid="' + byKey[key].uuid + '"] .lsp-hook-ui-slot .pb-error')
    if (!el) return null
    if (el.classList.contains("pb-error")) return { error: el.textContent }
    var segs = Array.prototype.map.call(el.querySelectorAll(".pb-segment"), function (d) {
      return { label: d.getAttribute("data-label"), width: d.style.width, bg: getComputedStyle(d).backgroundColor }
    })
    var label = el.querySelector(".pb-label, .pb-empty-label")
    return { empty: el.classList.contains("pb-empty"), width: el.style.width, label: label ? label.textContent.trim() : "", segments: segs }
  }
  var checkScenario = function (name, key, s) {
    var ex = expected(key, s)
    var f = forced[key] || {}
    var bar = readBar(key)
    var fail = function (what, got) { failures.push(name + " " + key + ": " + what + " (got " + JSON.stringify(got) + ")") }
    checked++
    if (ex.total === 0) {
      if (!s.showOnEmpty) { if (bar) fail("expected no bar", bar); return }
      if (!bar || !bar.empty) return fail("expected empty placeholder", bar)
      if (bar.width !== widthFor(f.width || s.barWidth)) fail("placeholder width " + widthFor(f.width || s.barWidth), bar.width)
      return
    }
    if (!bar || bar.error) return fail("no bar", bar)
    var wantLabel = labelFor(ex, f.format || s.displayFormat)
    if (bar.label !== wantLabel) fail("label " + wantLabel, bar.label)
    var wantWidth = widthFor(f.width || s.barWidth)
    if (bar.width !== wantWidth) fail("width " + wantWidth, bar.width)
    var wantSegs = Object.keys(ex.counts).map(function (k) { return k + ": " + ex.counts[k] }).sort()
    var gotSegs = bar.segments.map(function (x) { return x.label }).sort()
    if (JSON.stringify(wantSegs) !== JSON.stringify(gotSegs)) fail("segments " + wantSegs.join(" | "), gotSegs)
    var sum = 0
    bar.segments.forEach(function (x) { sum += parseFloat(x.width) })
    if (Math.abs(sum - 100) > 0.1) fail("segment widths sum to 100", sum)
    if (ex.completed > 0 && bar.segments.length && !/^(Done|Completed):/.test(bar.segments[0].label)) fail("completed segment first", bar.segments[0].label)
  }
  // Wait until every scenario label matches, then run the strict checks (bounded).
  var settleAndCheck = async function (name, s) {
    for (var attempt = 0; attempt < 12; attempt++) {
      await sleep(500)
      var ok = need.every(function (key) {
        var ex = expected(key, s), bar = readBar(key), f = forced[key] || {}
        if (ex.total === 0) return s.showOnEmpty ? !!(bar && bar.empty) : !bar
        return !!(bar && !bar.error && bar.label === labelFor(ex, f.format || s.displayFormat) && bar.width === widthFor(f.width || s.barWidth))
      })
      if (ok) break
    }
    need.forEach(function (key) { checkScenario(name, key, s) })
  }

  // --- the matrix ---
  var perms = []
  var formats = ["percent", "fraction", "both"], widths = ["full", "compact"], bools = [true, false], depths = ["all", "1"]
  formats.forEach(function (f) { widths.forEach(function (w) { bools.forEach(function (st) { bools.forEach(function (se) { depths.forEach(function (d) {
    perms.push({ displayFormat: f, barWidth: w, strictTagFilter: st, showOnEmpty: se, defaultDepth: d })
  }) }) }) }) })
  resetCounters()
  for (var p = 0; p < perms.length; p++) {
    var s = perms[p]
    var name = s.displayFormat + " " + s.barWidth + " strict=" + s.strictTagFilter + " empty=" + s.showOnEmpty + " depth=" + s.defaultDepth
    window.__matrixProgress = (p + 1) + "/" + perms.length + " " + name
    applySettings(s)
    await settleAndCheck(name, s)
  }
  var matrixWrites = counters.writes.length
  var matrixReads = counters.reads.length

  // --- real-time: flip a status and a checkbox through the (raw) API ---
  var base = { displayFormat: "fraction", barWidth: "full", strictTagFilter: false, showOnEmpty: false, defaultDepth: "all" }
  applySettings(base)
  await settleAndCheck("realtime-base", base)
  var realtime = {}
  var kids = await raw.get_block(byKey["enum"].uuid, { includeChildren: true })
  var firstDone = (kids.children || []).filter(function (c) { return /enum done 1/.test(c.title || c.content || "") })[0]
  var ckids = await raw.get_block(byKey["checkbox"].uuid, { includeChildren: true })
  var checkOff = (ckids.children || []).filter(function (c) { return /check off/.test(c.title || c.content || "") })[0]
  if (!firstDone || !checkOff) failures.push("realtime: seeded children not found")
  else {
    resetCounters()
    await testWrite("upsert_block_property", firstDone.uuid, "logseq.property/status", "Todo")
    await sleep(2500)
    realtime.afterStatusFlip = (readBar("enum") || {}).label
    if (realtime.afterStatusFlip !== "1/4") failures.push("realtime: enum bar after Done→Todo expected 1/4 (got " + realtime.afterStatusFlip + ")")
    await testWrite("upsert_block_property", checkOff.uuid, "check", true)
    await sleep(2500)
    realtime.afterCheckFlip = (readBar("checkbox") || {}).label
    if (realtime.afterCheckFlip !== "2/3") failures.push("realtime: checkbox bar after false→true expected 2/3 (got " + realtime.afterCheckFlip + ")")
    // No loop: reads must stop after the debounced burst.
    var readsAt2s = counters.reads.length
    await sleep(5000)
    realtime.readsAfterFlips = readsAt2s
    realtime.readsFiveSecondsLater = counters.reads.length
    if (counters.reads.length !== readsAt2s) failures.push("no-loop: " + (counters.reads.length - readsAt2s) + " SDK reads in the 5 s after the last change (plugin keeps re-rendering)")
    realtime.writesDuringRealtime = counters.writes.length
    await testWrite("upsert_block_property", firstDone.uuid, "logseq.property/status", "Done")
    await testWrite("upsert_block_property", checkOff.uuid, "check", false)
    await sleep(2500)
    realtime.restored = (readBar("enum") || {}).label + " / " + (readBar("checkbox") || {}).label
    if (realtime.restored !== "2/4 / 1/3") failures.push("realtime: bars after restoring expected 2/4 / 1/3 (got " + realtime.restored + ")")
  }

  // --- theme: segment colours follow the host theme ---
  var theme = {}
  var currentTheme = document.documentElement.getAttribute("data-theme") || (document.documentElement.classList.contains("dark") ? "dark" : "light")
  var doneColor = function () { var b = readBar("enum"); var seg = b && b.segments.filter(function (x) { return /^Done/.test(x.label) })[0]; return seg && seg.bg }
  api.set_theme_mode("light"); await sleep(2000); theme.light = doneColor()
  api.set_theme_mode("dark"); await sleep(2000); theme.dark = doneColor()
  api.set_theme_mode(currentTheme); await sleep(1500)
  if (theme.light !== "rgb(74, 222, 128)") failures.push("theme light: Done segment expected rgb(74, 222, 128) (got " + theme.light + ")")
  if (theme.dark !== "rgb(34, 197, 94)") failures.push("theme dark: Done segment expected rgb(34, 197, 94) (got " + theme.dark + ")")

  // --- a change on another page: one debounced re-render burst, bars unchanged ---
  var other = {}
  resetCounters()
  var today = await api.get_today_page()
  var before = (readBar("enum") || {}).label
  var stray = await testWrite("append_block_in_page", today.uuid || today.name, "pb e2e stray block " + Date.now())
  await sleep(2500)
  var readsAfterOther = counters.reads.length
  await sleep(3000)
  other.readsInBurst = readsAfterOther
  other.readsLater = counters.reads.length
  other.label = (readBar("enum") || {}).label
  if (counters.reads.length !== readsAfterOther) failures.push("other-page: reads kept coming after the debounced burst")
  if (other.label !== before) failures.push("other-page: enum bar changed (" + before + " → " + other.label + ")")
  if (stray && stray.uuid) await testWrite("remove_block", stray.uuid)
  await sleep(1500)

  restoreSettings()
  await sleep(1000)
  return {
    done: true, permutations: perms.length, blocksChecked: checked, failures: failures,
    counters: { matrixWrites: matrixWrites, matrixReads: matrixReads, totalWrites: counters.writes.length },
    realtime: realtime, theme: theme, otherPage: other
  }
})().then(function (v) { window.__matrixResult = v }, function (e) { window.__matrixResult = { fatal: String(e && e.stack || e) } }))

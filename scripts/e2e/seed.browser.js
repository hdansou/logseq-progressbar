// Seeds the "Progress Matrix" page: one scenario block per feature, each
// carrying the renderer macro and the children / query it needs. Idempotent
// (scenarios are found by their `pb:<key>` title prefix). Runs inside the
// Logseq host page via `playwright-cli eval` or `cdp.mjs eval`, so it must
// stay a single expression with no top-level semicolon and no arrow
// functions. Placeholders: __PLUGIN_ID__.
void (window.__seedResult = null, (async function () {
  var api = window.logseq.api
  var PAGE = "Progress Matrix"
  var out = { created: [], errors: [] }
  var fail = function (what, e) { out.errors.push(what + ": " + (e && e.message || e)) }

  // --- classes & properties the scenarios depend on (never touched if present) ---
  var ensureProperty = async function (name, type) {
    var p = await api.get_property(name)
    if (!p) { p = await api.upsert_property(name, { type: type }); out.created.push("property " + name) }
    return p
  }
  var ensureTag = async function (name, classProps) {
    var t = await api.get_page(name)
    if (!t) { t = await api.create_tag(name); out.created.push("tag " + name) }
    if (classProps && classProps.length) {
      // add_tag_property rejects plugin-made tags ("Not a valid tag"); set the class-property list directly.
      var declared = await api.datascript_query('[:find [?pi ...] :where [?c :block/uuid #uuid "' + t.uuid + '"] [?c :logseq.property.class/properties ?p] [?p :db/ident ?pi]]') || []
      var missing = classProps.filter(function (p) { return declared.indexOf(p.ident) < 0 })
      if (missing.length) await api.upsert_block_property(t.uuid, ":logseq.property.class/properties", classProps.map(function (p) { return p.id }))
    }
    return t
  }
  var check = await ensureProperty("check", "checkbox")
  var state = await ensureProperty("state", "default")
  await ensureTag("Checklist", [check])
  await ensureTag("Tido", [check])
  await ensureTag("Project", [state])
  await ensureTag("PBQ")

  // --- page & existing scenarios ---
  var tree = (await api.get_page_blocks_tree(PAGE)) || []
  if (tree.length === 0) { await api.create_page(PAGE, null, { redirect: false }); tree = [] }
  var have = {}
  for (var i = 0; i < tree.length; i++) { var m = /^pb:([a-z-]+)/.exec(tree[i].title || ""); if (m) have[m[1]] = tree[i] }

  // child spec: [title, tags[], props{}] ; nested via a 4th element (children)
  var addChild = async function (parentUuid, spec) {
    var b = await api.insert_block(parentUuid, spec[0], { sibling: false })
    var tags = spec[1] || []
    for (var t = 0; t < tags.length; t++) await api.add_block_tag(b.uuid, tags[t])
    var props = spec[2] || {}
    for (var k in props) await api.upsert_block_property(b.uuid, k, props[k])
    var kids = spec[3] || []
    for (var c = 0; c < kids.length; c++) await addChild(b.uuid, kids[c])
    return b
  }
  var task = function (title, status, kids) { return [title, ["Task"], { "logseq.property/status": status }, kids] }
  var cl = function (title, value) { return [title, ["Checklist"], { "check": value }] }
  var scenario = async function (key, args, children, query) {
    if (have[key]) return have[key]
    try {
      var block = await api.append_block_in_page(PAGE, "pb:" + key + " {{renderer :progress-bar" + (args ? ", " + args : "") + "}}")
      if (query) await api.upsert_block_property(block.uuid, "logseq.property/query", query)
      for (var c = 0; c < (children || []).length; c++) await addChild(block.uuid, children[c])
      have[key] = block
      out.created.push("scenario " + key)
    } catch (e) { fail(key, e) }
    return have[key]
  }

  await scenario("enum", "", [task("enum done 1", "Done"), task("enum doing", "Doing"), task("enum todo", "Todo"), task("enum done 2", "Done")])
  await scenario("checkbox", "", [cl("check on", true), cl("check off", false), ["tido unset", ["Tido"], {}]])
  await scenario("mixed", "", [task("mixed done", "Done"), cl("mixed on", true), cl("mixed off", false), task("mixed todo", "Todo")])
  // Setting `status` auto-tags a block with #Task (Logseq DB), so untagged blocks carry `check` instead.
  await scenario("untagged", "", [task("untagged done", "Done"), ["untagged todo", [], { "check": false }], ["untagged plain", [], {}]])
  await scenario("nested", "", [task("nested todo", "Todo", [task("nested done 1", "Done", [task("nested done 2", "Done")])])])
  await scenario("override-tags", "tags: Project, property: state, complete: Completed", [
    ["project completed", ["Project"], { "state": "Completed" }],
    ["project now", ["Project"], { "state": "Now" }],
    task("override task done", "Done")])
  await scenario("override-display", "format: both, width: 300px, depth: 1, strict: true", [task("od done", "Done", [task("od todo", "Todo")]), ["od untagged", [], { "check": true }]])
  // Query scenarios share four PBQ-tagged tasks (one is Doing, outside the DSL's status set).
  await scenario("query-pool", "tags: Task", [["pool done 1", ["Task", "PBQ"], { "logseq.property/status": "Done" }], ["pool done 2", ["Task", "PBQ"], { "logseq.property/status": "Done" }], ["pool todo", ["Task", "PBQ"], { "logseq.property/status": "Todo" }], ["pool doing", ["Task", "PBQ"], { "logseq.property/status": "Doing" }]])
  await scenario("query-dsl", "", [], '(and (task "Todo" "Done") (tags [[PBQ]]))')
  await scenario("query-map", "", [], '{:query [:find (pull ?b [*]) :where [?b :block/tags ?t] [?t :block/title "PBQ"] [?b :logseq.property/status ?s]]}')
  if (have["query-dsl"]) await scenario("query-ref", "query: " + have["query-dsl"].uuid, [])
  await scenario("empty", "", [])

  await api.push_state("page", { name: PAGE })
  out.scenarios = Object.keys(have)
  return out
})().then(function (v) { window.__seedResult = v }, function (e) { window.__seedResult = { fatal: String(e && e.stack || e) } }))

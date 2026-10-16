/**
 * Property metadata cache for the current graph.
 *
 *   - `byShortName`     friendly name → `:db/ident[]` (e.g. `check` → `[":user.property/check-pgUd_nnQ"]`)
 *   - `typeByIdent`     `:db/ident` → property type (`"checkbox"`, `"default"`, …)
 *   - `classPropsByTag` tag title → set of `:db/ident` declared as class-properties on that tag
 *
 * The last one lets the aggregator default an *unset* checkbox property to
 * `false` when the block is tagged with a class that declares the property.
 * Logseq's UI shows ☐ for these inherited defaults; without this map the
 * plugin would silently exclude every block the user hasn't ticked yet.
 */

import type { SdkPort } from "./sdk";

interface IdentCacheState {
  byShortName: Map<string, string[]>;
  typeByIdent: Map<string, string>;
  classPropsByTag: Map<string, Set<string>>;
}

function empty(): IdentCacheState {
  return {
    byShortName: new Map(),
    typeByIdent: new Map(),
    classPropsByTag: new Map(),
  };
}

let state: IdentCacheState = empty();

// ─── Public API ────────────────────────────────────────────────────────

/** Sync read. Returns [] if the name hasn't been resolved. */
export function lookup(shortName: string): string[] {
  return state.byShortName.get(shortName.toLowerCase()) ?? [];
}

/** Sync read. Returns the property type for an ident, or null. */
export function lookupType(ident: string): string | null {
  return state.typeByIdent.get(stripLeadingColon(ident)) ?? null;
}

/** True if `tagTitle` is a class that declares `propIdent` as a class-property. */
export function isClassProperty(tagTitle: string, propIdent: string): boolean {
  const set = state.classPropsByTag.get(tagTitle.toLowerCase());
  if (!set) return false;
  return set.has(stripLeadingColon(propIdent));
}

/** Snapshot of every known tag → class-property ident array. */
export function getAllClassProps(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [tag, set] of state.classPropsByTag.entries()) {
    out[tag] = [...set];
  }
  return out;
}

/** Drop everything. Called on graph switch before re-resolving. */
export function clear(): void {
  state = empty();
}

/**
 * Pull property metadata from the live graph: idents + titles + types, and
 * the inverse of `:logseq.property.class/properties` so we know which tags
 * declare which properties.
 *
 * Two queries (parallel). Failure on either leaves the relevant map empty;
 * the aggregator degrades to its regex matcher and to the strict
 * "skip-if-unset" behaviour.
 */
export async function refresh(sdk: SdkPort, shortNames: string[]): Promise<void> {
  if (shortNames.length === 0) {
    state = empty();
    return;
  }

  let propRows: unknown = null;
  let classRows: unknown = null;
  await Promise.all([
    (async () => {
      try {
        propRows = await sdk.datascriptQuery(`
          [:find ?ident ?title ?type
           :where
           [?p :db/ident ?ident]
           [(get-else $ ?p :block/title "") ?title]
           [(get-else $ ?p :logseq.property/type "") ?type]]
        `);
      } catch (e) {
        console.warn("[progress-bar] identCache: property query failed", e);
      }
    })(),
    (async () => {
      try {
        classRows = await sdk.datascriptQuery(`
          [:find ?prop-ident ?tag-title
           :where
           [?c :logseq.property.class/properties ?p]
           [?c :block/title ?tag-title]
           [?p :db/ident ?prop-ident]]
        `);
      } catch (e) {
        console.warn("[progress-bar] identCache: class-property query failed", e);
      }
    })(),
  ]);

  const built = buildIndexes(propRows, classRows);
  state = {
    byShortName: pickShortNames(built.titleIndex, built.tailIndex, shortNames),
    typeByIdent: built.typeByIdent,
    classPropsByTag: built.classPropsByTag,
  };
}

// ─── Internals (exposed for tests) ─────────────────────────────────────

/** Seed all three maps for tests; missing keys clear that section. */
export function _seedForTest(opts: {
  byShortName?: Record<string, string[]>;
  typeByIdent?: Record<string, string>;
  classPropsByTag?: Record<string, string[]>;
}): void {
  state = empty();
  if (opts.byShortName) {
    for (const [k, v] of Object.entries(opts.byShortName)) {
      state.byShortName.set(k.toLowerCase(), v);
    }
  }
  if (opts.typeByIdent) {
    for (const [k, v] of Object.entries(opts.typeByIdent)) {
      state.typeByIdent.set(stripLeadingColon(k), v);
    }
  }
  if (opts.classPropsByTag) {
    for (const [k, v] of Object.entries(opts.classPropsByTag)) {
      state.classPropsByTag.set(k.toLowerCase(), new Set(v.map(stripLeadingColon)));
    }
  }
}

export function _clearForTest(): void {
  state = empty();
}

export function buildIndexes(
  propRows: unknown,
  classRows: unknown
): {
  titleIndex: Map<string, string[]>;
  tailIndex: Map<string, string[]>;
  typeByIdent: Map<string, string>;
  classPropsByTag: Map<string, Set<string>>;
} {
  const titleIndex = new Map<string, string[]>();
  const tailIndex = new Map<string, string[]>();
  const typeByIdent = new Map<string, string>();
  const classPropsByTag = new Map<string, Set<string>>();

  if (Array.isArray(propRows)) {
    for (const row of propRows) {
      if (!Array.isArray(row) || row.length < 1) continue;
      const ident = normalizeIdent(row[0]);
      if (!ident) continue;
      const title = typeof row[1] === "string" ? row[1].trim() : "";
      const type = normalizeType(row[2]);

      if (title) push(titleIndex, title.toLowerCase(), ident);

      const tail = identTail(ident);
      if (tail) {
        push(tailIndex, tail.toLowerCase(), ident);
        const stripped = stripSuffix(tail);
        if (stripped !== tail) push(tailIndex, stripped.toLowerCase(), ident);
      }

      if (type) typeByIdent.set(stripLeadingColon(ident), type);
    }
  }

  if (Array.isArray(classRows)) {
    for (const row of classRows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const propIdent = normalizeIdent(row[0]);
      const tagTitle = typeof row[1] === "string" ? row[1].trim() : "";
      if (!propIdent || !tagTitle) continue;
      const key = tagTitle.toLowerCase();
      let set = classPropsByTag.get(key);
      if (!set) {
        set = new Set();
        classPropsByTag.set(key, set);
      }
      set.add(stripLeadingColon(propIdent));
    }
  }

  return { titleIndex, tailIndex, typeByIdent, classPropsByTag };
}

function pickShortNames(
  titleIndex: Map<string, string[]>,
  tailIndex: Map<string, string[]>,
  shortNames: string[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const name of shortNames) {
    const lower = name.toLowerCase();
    const merged = new Set<string>([
      ...(titleIndex.get(lower) ?? []),
      ...(tailIndex.get(lower) ?? []),
    ]);
    if (merged.size > 0) out.set(lower, [...merged]);
  }
  return out;
}

function push(map: Map<string, string[]>, key: string, val: string): void {
  const arr = map.get(key);
  if (arr) {
    if (!arr.includes(val)) arr.push(val);
  } else {
    map.set(key, [val]);
  }
}

/** Coerce SDK shapes (keyword object, string with/without colon) → ":ns/name". */
function normalizeIdent(raw: unknown): string | null {
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    return s.startsWith(":") ? s : `:${s}`;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const candidate =
      (typeof o.ns === "string" && typeof o.name === "string"
        ? `:${o.ns}/${o.name}`
        : undefined) ??
      (typeof o.toString === "function" ? String(o) : undefined);
    if (typeof candidate === "string" && candidate.includes("/")) {
      return candidate.startsWith(":") ? candidate : `:${candidate}`;
    }
  }
  return null;
}

/** Normalize property type: ":checkbox" / "checkbox" / {keyword} → "checkbox". */
function normalizeType(raw: unknown): string {
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return "";
    return s.startsWith(":") ? s.slice(1) : s;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    if (typeof o.toString === "function") return normalizeType(String(raw));
  }
  return "";
}

function stripLeadingColon(s: string): string {
  return s.startsWith(":") ? s.slice(1) : s;
}

/** Returns the segment after the last `/` in an ident, or "" if none. */
function identTail(ident: string): string {
  const slash = ident.lastIndexOf("/");
  return slash < 0 ? "" : ident.slice(slash + 1);
}

/**
 * Strip the Logseq-generated suffix from a property tail.
 * Suffix shape: `-<6-to-12 base64url-ish chars>`. Conservative bounds keep
 * legitimately-hyphenated names like `next-action` intact.
 */
function stripSuffix(tail: string): string {
  return tail.replace(/-[A-Za-z0-9_-]{6,12}$/, "");
}

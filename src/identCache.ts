/**
 * Friendly-name → :db/ident[] cache for property lookups.
 *
 * Logseq DB user properties have idents like `:user.property/check-pgUd_nnQ`
 * where the suffix is graph-specific. Rather than match those at read-time
 * with a regex (which can't cover every suffix alphabet and risks false
 * positives), we ask the DB for all property idents up front and build two
 * indexes:
 *
 *   - titleIndex: lowercase `:block/title` → ident[]
 *   - tailIndex:  lowercase ident-tail (with `-<suffix>` stripped) → ident[]
 *
 * For each configured short name (e.g. `check`), we union the matches from
 * both indexes. Built-ins like `:logseq.property/status` are found via the
 * tail index; user properties are found via the title index.
 */

let cache: Map<string, string[]> = new Map();

/** Internal — exposed for tests to seed without hitting the SDK. */
export function _seedForTest(entries: Record<string, string[]>): void {
  cache = new Map();
  for (const [k, v] of Object.entries(entries)) {
    cache.set(k.toLowerCase(), v);
  }
}

/** Internal — exposed for tests so each case starts from a clean slate. */
export function _clearForTest(): void {
  cache = new Map();
}

/** Sync read. Returns [] if the name hasn't been resolved. */
export function lookup(shortName: string): string[] {
  return cache.get(shortName.toLowerCase()) ?? [];
}

/** Drop everything. Called on graph switch before re-resolving. */
export function clear(): void {
  cache = new Map();
}

/**
 * Pull every property's `:db/ident` and `:block/title` from the live graph
 * and populate the cache for the supplied short names. One round-trip.
 *
 * Failure modes (no SDK, query error, malformed rows) leave the cache
 * empty so the aggregator falls back to its regex matcher.
 */
export async function refresh(shortNames: string[]): Promise<void> {
  if (shortNames.length === 0) {
    cache = new Map();
    return;
  }

  let rows: unknown;
  try {
    rows = await logseq.DB.datascriptQuery(`
      [:find ?ident ?title
       :where
       [?p :db/ident ?ident]
       [(get-else $ ?p :block/title "") ?title]]
    `);
  } catch (e) {
    console.warn("[progress-bar] identCache: query failed, will fall back to regex matcher", e);
    cache = new Map();
    return;
  }

  const { titleIndex, tailIndex } = buildIndexes(rows);
  const next = new Map<string, string[]>();
  for (const name of shortNames) {
    const lower = name.toLowerCase();
    const merged = new Set<string>([
      ...(titleIndex.get(lower) ?? []),
      ...(tailIndex.get(lower) ?? []),
    ]);
    if (merged.size > 0) next.set(lower, [...merged]);
  }
  cache = next;
}

/** Exposed for unit tests — pure index construction over query-shaped rows. */
export function buildIndexes(rows: unknown): {
  titleIndex: Map<string, string[]>;
  tailIndex: Map<string, string[]>;
} {
  const titleIndex = new Map<string, string[]>();
  const tailIndex = new Map<string, string[]>();
  if (!Array.isArray(rows)) return { titleIndex, tailIndex };

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 1) continue;
    const ident = normalizeIdent(row[0]);
    if (!ident) continue;
    const title = typeof row[1] === "string" ? row[1].trim() : "";

    if (title) push(titleIndex, title.toLowerCase(), ident);

    const tail = identTail(ident);
    if (tail) {
      push(tailIndex, tail.toLowerCase(), ident);
      const stripped = stripSuffix(tail);
      if (stripped !== tail) push(tailIndex, stripped.toLowerCase(), ident);
    }
  }

  return { titleIndex, tailIndex };
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

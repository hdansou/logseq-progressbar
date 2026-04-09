# Logseq Progress Bar Plugin

Visualize task completion as segmented progress bars in Logseq DB graphs.

Track progress derived from configurable properties (`status`, `state`, or any custom enum) on blocks with specified tags (`#Task`, `#Project`, etc.). Supports manual placement, query integration, and real-time updates.

**DB graphs only** — file-based graphs are not supported.

---

## Installation

### From Local Build

1. Clone the repo and build:

  ```bash
  cd logseq-progressbar
  npm install
  npm run build
  ```

2. In Logseq, go to **Settings → Advanced → Enable Developer mode**
3. Open **Plugins** (three-dot menu → Plugins)
4. Click the three-dot menu in the Plugins panel → **Load unpacked plugin**
5. Select the `logseq-progressbar` directory

### Development

```bash
npm run dev       # Build with watch mode
npm run test      # Run unit tests
npm run build     # Production build
```

Load the plugin via **Plugins → Load plugin from web url** → `http://127.0.0.1:8080/`

---

## Usage

### Basic — Slash Command

Type `/progress-bar` in any block to insert a progress bar that tracks child blocks.

### Manual — Renderer Macro

Insert the macro directly:

```txt
{{renderer :progress-bar}}
```

The bar scans descendant blocks for configured tags and aggregates their statuses.

### With Overrides

Override any global setting per-instance:

```txt
{{renderer :progress-bar, tags: Task|Bug, property: status, format: both}}
```

```txt
{{renderer :progress-bar, tags: Project, property: state, complete: Completed, width: 300px}}
```

### With a Query

Attach a progress bar to a Logseq query block by UUID:

```txt
{{renderer :progress-bar, query: 69acb093-df21-438d-9bae-72decf188ed2}}
```

The bar aggregates statuses from the query's result set.

---

## Renderer Parameters

All parameters are optional. Global plugin settings are used as defaults.

| Param      | Example                    | Description                                      |
| ---------- | -------------------------- | ------------------------------------------------ |
| `tags`     | `tags: Task\|Bug`          | Tags to track (pipe-separated)                   |
| `property` | `property: state`          | Property to read for progress                    |
| `complete` | `complete: Done\|Canceled` | Values that count as "complete" (pipe-separated) |
| `depth`    | `depth: 2`                 | Scan depth (`1`, `2`, ..., or `all`)             |
| `strict`   | `strict: true`             | Only count blocks with matching tags             |
| `format`   | `format: both`             | Label format: `percent`, `fraction`, or `both`   |
| `width`    | `width: 200px`             | Bar width: `full`, `compact`, or CSS value       |
| `query`    | `query: <uuid>`            | Track a query block's results                    |

---

## Settings

Open **Plugins → Progress Bar → Settings** to configure global defaults.

### Tag & Property Configuration

| Setting           | Default                | Description                                         |
| ----------------- | ---------------------- | --------------------------------------------------- |
| Tags in Scope     | `Task`                 | Comma-separated tag names to track                  |
| Property Mappings | `{"Task": "status"}`   | JSON mapping each tag to its progress property      |
| Complete Values   | `{"status": ["Done"]}` | JSON mapping each property to its "complete" values |

### Display Settings

| Setting              | Default   | Description                                   |
| -------------------- | --------- | --------------------------------------------- |
| Default Scan Depth   | `all`     | How deep to scan (`all` or a number)          |
| Strict Tag Filtering | `false`   | Exclude untagged blocks from the count        |
| Display Format       | `percent` | `percent` (54%), `fraction` (7/13), or `both` |
| Bar Width            | `full`    | `full` (100% width) or `compact` (inline)     |
| Auto-Detect Mode     | `true`    | Auto-show bars on blocks with tagged children |
| Show on Empty        | `false`   | Show an empty 0% bar when no items match      |

### Color Overrides

Override segment colors per status value (JSON):

```json
{
  "Done": { "light": "#22c55e", "dark": "#16a34a" },
  "Doing": { "light": "#3b82f6", "dark": "#2563eb" }
}
```

---

## Default Colors

| Status       | Light Mode | Dark Mode |
| ------------ | ---------- | --------- |
| Done         | #4ade80    | #22c55e   |
| Doing / Now  | #60a5fa    | #3b82f6   |
| In Review    | #facc15    | #eab308   |
| Todo / Later | #e2e8f0    | #475569   |
| Backlog      | #f1f5f9    | #334155   |
| Canceled     | #fca5a5    | #ef4444   |

Colors adapt automatically to Logseq's dark/light theme.

---

## How It Works

1. The renderer macro triggers on `{{renderer :progress-bar, ...}}`
2. Global settings are merged with per-instance overrides
3. Descendant blocks (or query results) are scanned at the configured depth
4. Blocks are filtered by tags in scope
5. The tracked property is read from each block; blocks with no value are skipped
6. Status counts are aggregated and a completion percentage is calculated
7. A segmented pill-shaped bar is rendered with completed segments on the left
8. Hovering shows a tooltip with the full status breakdown
9. The bar updates in real-time when task statuses change (`DB.onChanged`)

---

## Examples

### Track tasks under a project block

```txt
- Project Alpha #Project
  - Design UI #Task (status: Done)
  - Implement API #Task (status: Doing)
  - Write tests #Task (status: Todo)
  - {{renderer :progress-bar}}
```

Result: segmented bar showing 1/3 complete (33%).

### Track with custom property

```txt
- Q1 Goals
  - Launch product #Project (state: Completed)
  - Hire team #Project (state: Now)
  - Raise funding #Project (state: Later)
  - {{renderer :progress-bar, tags: Project, property: state, complete: Completed}}
```

### Compact inline bar with fraction

```txt
- Sprint 12 {{renderer :progress-bar, format: fraction, width: 200px}}
  - Fix login bug #Task (status: Done)
  - Add search #Task (status: Doing)
  - Update docs #Task (status: Todo)
```

---

## Development

### Project Structure

```txt
src/
├── types.ts        — Shared TypeScript types
├── parser.ts       — Renderer macro argument parser
├── config.ts       — Plugin settings schema + config resolver
├── scanner.ts      — Block scanning (children, page, query)
├── aggregator.ts   — Status counting + completion calculation
├── colors.ts       — Color palette + segment ordering
├── renderer.ts     — HTML rendering + CSS styles
├── index.ts        — Main entry: triggers, events, lifecycle
└── __tests__/      — Unit tests (60 tests)
```

### Running Tests

```bash
npm test            # Run once
npm run test:watch  # Watch mode
```

---

## License

MIT

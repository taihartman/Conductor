# Constants & Localization Standards

Zero tolerance for inline literals in component and service code. Every magic number, user-visible string, and color value must live in a centralized config file.

## Constant Registries

| Scope | File | What goes here |
|---|---|---|
| Extension identity, commands, log prefixes, FS paths, truncation limits | `src/constants.ts` | `COMMANDS`, `LOG_PREFIX`, `FS_PATHS`, `TRUNCATION`, `SPECIAL_NAMES` |
| Shared type discriminators (used by both extension and webview) | `src/models/sharedConstants.ts` | `RECORD_TYPES`, `SESSION_STATUSES`, `ACTIVITY_TYPES`, `STATUS_GROUPS` |
| Tool summarization registry | `src/config/toolSummarizers.ts` | `TOOL_SUMMARIZERS` map + `summarizeToolInput()` |
| Webview UI strings | `webview-ui/src/config/strings.ts` | `UI_STRINGS` — every user-visible string |
| Webview colors | `webview-ui/src/config/colors.ts` | `COLORS` (rgba/hex for JS styles), `SIZES` (max-heights) |
| Webview status display | `webview-ui/src/config/statusConfig.ts` | `STATUS_CONFIG` — labels, animations, CSS vars per status |

| Formatting utilities | `webview-ui/src/utils/formatters.ts` | `formatModel`, `formatTokens`, `formatCost`, `timeAgo`, etc. |

Extension code imports from `src/constants.ts` (which re-exports `sharedConstants`). Webview code imports from `webview-ui/src/config/*` or the `@shared/*` alias for shared constants.

## Rules

### Strings

- **Every user-visible string** (button labels, tooltips, placeholders, empty states, error messages, aria labels) must be in `UI_STRINGS`.
- Status display labels go in `STATUS_CONFIG`, not `UI_STRINGS`.
- Log prefixes go in `LOG_PREFIX`. Use the pattern `[Conductor:<Component>]`.
- Command IDs go in `COMMANDS`. They must match `package.json` contributes entries.
- Template strings with dynamic content: extract the static parts to `UI_STRINGS`, compose at the call site.

### Colors

- **No inline hex (`#xxx`) or `rgba()`** in component files. Add to `COLORS` in `colors.ts`.
- Prefer CSS custom properties (`var(--fg-primary)`, `var(--bg-secondary)`) over `COLORS` entries when a VS Code theme variable exists.
- `COLORS` is for values that have no CSS variable equivalent (backgrounds with specific opacity, indicator colors, etc.).
- **Exception: SVG artwork** — SVG fill/stroke colors in mascot/illustration components are design artifacts and may remain inline. Mark with `// inline-ok: svg artwork`.


### Numbers

- **No inline magic numbers** in extension code. Promote to a named constant in `src/constants.ts` or at module scope.
- Timing values (ms): add to a `TIMING` object or existing `TRUNCATION`/settings objects.
- Character limits: add to `TRUNCATION` in `src/constants.ts`.
- **Component layout dimensions** (padding, width, height, font-size in `style={{}}` objects) may remain inline when they're one-off design values tied to that specific component. Mark with `// inline-ok`.
- When the same dimension appears in 2+ components, extract to `SIZES` in `colors.ts` or a component-level named constant.

### The `// inline-ok` Convention

Any intentional inline literal must have a `// inline-ok` comment (optionally with a reason). This signals "I considered extracting this and decided it belongs here." Examples:

```typescript
// inline-ok: one-off layout value
style={{ padding: '12px 16px' }}

// inline-ok: svg artwork
<circle fill="#b8a0d8" />
```

Code without `// inline-ok` on an inline literal is treated as a violation to be fixed.

**JSX placement rule**: In `.tsx` files, `// inline-ok` after a closing `>` becomes rendered text, not a comment. Place it correctly:

```tsx
// WRONG — renders "// inline-ok" as visible text in the UI
<div style={{ fontSize: '12px' }}> // inline-ok

// CORRECT — inside the style object
<div style={{ fontSize: '12px' /* inline-ok */ }}>

// CORRECT — as a JSX comment between tags
<div style={{ fontSize: '12px' }}>{/* inline-ok */}

// CORRECT — on a JSX prop (before the closing >)
<div
  style={{ fontSize: '12px' }} // inline-ok
>
```

### Naming

- Module-level constants: `UPPER_SNAKE_CASE` (`IDLE_TIMEOUT_MS`, `MAX_ACTIVITIES`).
- Constant objects: `UPPER_SNAKE_CASE` keys (`COMMANDS.OPEN`, `LOG_PREFIX.PANEL`).
- All constant objects must use `as const` for literal type preservation.
- Named exports only — no default exports from config files.

### Adding New Constants

1. Check the registry table above to find the correct file.
2. Add the constant with a JSDoc comment explaining its purpose.
3. If it's a new category that doesn't fit an existing object, create a new object — don't scatter loose `export const` values.
4. If the constant is used by both extension and webview, it goes in `src/models/sharedConstants.ts` and gets re-exported from `src/constants.ts`.

### Formatting Utilities

Before writing a new formatter function, check `webview-ui/src/utils/formatters.ts`. Existing formatters: `formatModel`, `formatTokens`, `formatCost`, `formatCostCompact`, `timeAgo`, `formatDuration`, `getSessionDisplayName`. Add new formatters there, not inline in components.

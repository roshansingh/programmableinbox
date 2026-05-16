# Iris Theme Color Palette — InboxUI Design Spec

**Date**: 2026-05-16  
**Status**: APPROVED  
**Scope**: Replace InboxUI theme colors with Iris palette (light + dark variants)

---

## 1. Overview

Replicate the Iris design system color palette in InboxUI by updating CSS variables in `app/globals.css`. This is a direct color value replacement with no structural, component, or configuration changes.

**Goal**: InboxUI theme visually matches the Iris console design (both light and dark modes).

---

## 2. Files to Modify

### Primary
- **`app/globals.css`** — Update CSS variable values in `:root` (light) and `.dark` (dark) blocks

### Untouched
- `tailwind.config.ts` — Already wired to use `hsl(var(--name))` syntax
- Component files — Reference same variable names, no changes needed
- `tailwind.config.ts`, `theme-provider.tsx`, layout files — No changes

---

## 3. Color Mapping

### Light Theme (`:root` block)

| Variable | Current (oklch) | Iris HSL | Iris Hex |
|----------|---|---|---|
| `--background` | oklch(0.99...) | `240 17% 97%` | #f4f4f8 |
| `--foreground` | oklch(0.165...) | `225 27% 7%` | #0c0e15 |
| `--card` | oklch(1 0 0) | `0 0% 100%` | #ffffff |
| `--card-foreground` | oklch(0.165...) | `225 27% 7%` | #0c0e15 |
| `--popover` | oklch(1 0 0) | `0 0% 100%` | #ffffff |
| `--popover-foreground` | oklch(0.165...) | `225 27% 7%` | #0c0e15 |
| `--primary` | oklch(0.548...) | `236 72% 58%` | #4a52e0 |
| `--primary-foreground` | oklch(0.99 0 0) | `0 0% 100%` | #ffffff |
| `--secondary` | oklch(0.95...) | `240 14% 94%` | #ececf2 |
| `--secondary-foreground` | oklch(0.165...) | `225 27% 7%` | #0c0e15 |
| `--muted` | oklch(0.96...) | `240 14% 94%` | #ececf2 |
| `--muted-foreground` | oklch(0.508...) | `225 12% 42%` | #5e6478 |
| `--accent` | oklch(0.95...) | `236 72% 58%` | #4a52e0 |
| `--accent-foreground` | oklch(0.165...) | `0 0% 100%` | #ffffff |
| `--destructive` | oklch(0.577...) | `0 51% 53%` | #c44a4a |
| `--destructive-foreground` | oklch(0.99 0 0) | `0 0% 100%` | #ffffff |
| `--success` | (undefined) | `153 64% 29%` | #006b4a |
| `--warning` | (undefined) | `38 67% 38%` | #a07820 |
| `--border` | oklch(0.91...) | `232 15% 89%` | #dedfe8 |
| `--input` | oklch(0.91...) | `232 15% 89%` | #dedfe8 |
| `--ring` | oklch(0.548...) | `236 72% 58%` | #4a52e0 |
| `--chart-1` | oklch(0.548...) | `236 72% 58%` | #4a52e0 |
| `--chart-2` | oklch(0.628...) | `219 80% 50%` | #2563eb |
| `--chart-3` | oklch(0.698...) | `263 65% 60%` | #8b5cf6 |
| `--chart-4` | oklch(0.468...) | `153 64% 36%` | #059669 |
| `--chart-5` | oklch(0.728...) | `38 75% 50%` | #d97706 |
| `--sidebar` | oklch(0.985...) | `240 17% 97%` | #f4f4f8 |
| `--sidebar-foreground` | oklch(0.165...) | `225 27% 7%` | #0c0e15 |
| `--sidebar-primary` | oklch(0.548...) | `236 72% 58%` | #4a52e0 |
| `--sidebar-primary-foreground` | oklch(0.99 0 0) | `0 0% 100%` | #ffffff |
| `--sidebar-accent` | oklch(0.95...) | `240 14% 94%` | #ececf2 |
| `--sidebar-accent-foreground` | oklch(0.165...) | `225 27% 7%` | #0c0e15 |
| `--sidebar-border` | oklch(0.91...) | `232 15% 89%` | #dedfe8 |
| `--sidebar-ring` | oklch(0.548...) | `236 72% 58%` | #4a52e0 |
| `--radius` | 0.5rem | `0.625rem` | (unchanged) |

### Dark Theme (`.dark` block)

| Variable | Current (oklch) | Iris HSL | Iris Hex |
|----------|---|---|---|
| `--background` | oklch(0.125...) | `225 27% 7%` | #0c0e15 |
| `--foreground` | oklch(0.97 0 0) | `228 25% 92%` | #e6e8f1 |
| `--card` | oklch(0.145...) | `225 23% 12%` | #161a26 |
| `--card-foreground` | oklch(0.97 0 0) | `228 25% 92%` | #e6e8f1 |
| `--popover` | oklch(0.145...) | `224 27% 14%` | #1a1f2e |
| `--popover-foreground` | oklch(0.97 0 0) | `228 25% 92%` | #e6e8f1 |
| `--primary` | oklch(0.648...) | `237 100% 74%` | #7c83ff |
| `--primary-foreground` | oklch(0.99 0 0) | `225 27% 7%` | #0c0e15 |
| `--secondary` | oklch(0.225...) | `224 27% 14%` | #1a1f2e |
| `--secondary-foreground` | oklch(0.97 0 0) | `228 25% 92%` | #e6e8f1 |
| `--muted` | oklch(0.205...) | `225 23% 12%` | #161a26 |
| `--muted-foreground` | oklch(0.648...) | `225 16% 55%` | #7a82a0 |
| `--accent` | oklch(0.225...) | `237 100% 74%` | #7c83ff |
| `--accent-foreground` | oklch(0.97 0 0) | `225 27% 7%` | #0c0e15 |
| `--destructive` | oklch(0.477...) | `0 100% 74%` | #ff7a7a |
| `--destructive-foreground` | oklch(0.99 0 0) | `225 27% 7%` | #0c0e15 |
| `--success` | (undefined) | `153 64% 60%` | #34d399 |
| `--warning` | (undefined) | `38 75% 63%` | #e8b95a |
| `--border` | oklch(0.225...) | `228 31% 19%` | #222840 |
| `--input` | oklch(0.225...) | `228 31% 19%` | #222840 |
| `--ring` | oklch(0.648...) | `237 100% 74%` | #7c83ff |
| `--chart-1` | oklch(0.648...) | `237 100% 74%` | #7c83ff |
| `--chart-2` | oklch(0.728...) | `200 85% 65%` | #06b6d4 |
| `--chart-3` | oklch(0.798...) | `270 75% 70%` | #c084fc |
| `--chart-4` | oklch(0.568...) | `153 64% 60%` | #34d399 |
| `--chart-5` | oklch(0.828...) | `38 75% 63%` | #e8b95a |
| `--sidebar-background` | oklch(0.165...) | `225 27% 7%` | #0c0e15 |
| `--sidebar-foreground` | oklch(0.97 0 0) | `228 25% 92%` | #e6e8f1 |
| `--sidebar-primary` | oklch(0.648...) | `237 100% 74%` | #7c83ff |
| `--sidebar-primary-foreground` | oklch(0.99 0 0) | `225 27% 7%` | #0c0e15 |
| `--sidebar-accent` | oklch(0.225...) | `225 23% 12%` | #161a26 |
| `--sidebar-accent-foreground` | oklch(0.97 0 0) | `228 25% 92%` | #e6e8f1 |
| `--sidebar-border` | oklch(0.225...) | `228 31% 19%` | #222840 |
| `--sidebar-ring` | oklch(0.648...) | `237 100% 74%` | #7c83ff |

---

## 4. Implementation

**Single file change**: `app/globals.css`

1. Locate the `:root { ... }` block (light theme variables)
2. Replace all `oklch(...)` values with corresponding `HSL` values from the Iris Light table above
3. Locate the `.dark { ... }` block (dark theme variables)
4. Replace all `oklch(...)` values with corresponding `HSL` values from the Iris Dark table above
5. Keep all variable names, selectors, and comments unchanged
6. Update `--radius` from `0.5rem` to `0.625rem` (Iris default)

**No other files change.**

---

## 5. Testing

1. **Start dev server**: `npm run dev`
2. **Light mode verification**:
   - Open http://localhost:4000
   - Verify background is light gray (#f4f4f8)
   - Verify primary accent is blue (#4a52e0) on buttons, links
   - Verify cards are white (#ffffff)
   - Verify text is dark (#0c0e15)
3. **Dark mode verification**:
   - Toggle dark mode (theme toggle or system preference)
   - Verify background is very dark (#0c0e15)
   - Verify primary accent is light purple (#7c83ff) on buttons, links
   - Verify cards are dark gray (#161a26)
   - Verify text is light (#e6e8f1)
4. **Component spot-checks**:
   - Button (primary, secondary, destructive)
   - Card / input fields
   - Sidebar (if visible)
   - Borders / dividers

---

## 6. Scope & Constraints

- **In scope**: CSS variable color values only
- **Out of scope**: Component structure, tailwind config, fonts, border-radius logic, spacing
- **Constraint**: No widget content changes (as requested)

---

## 7. Success Criteria

- All color variables updated from oklch → HSL (Iris palette)
- Light theme visually matches Iris light design
- Dark theme visually matches Iris dark design
- No component layout or structure changes
- Tests pass (npm run test)

---

## 8. Source Reference

Iris theme source: `/design/iris-theme/app/globals.css`  
InboxUI target: `/app/globals.css`

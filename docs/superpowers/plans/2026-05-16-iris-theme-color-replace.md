# Iris Theme Color Palette Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace InboxUI's theme colors with the Iris design system palette (light + dark variants) by updating CSS variables in `app/globals.css`.

**Architecture:** Direct color value replacement in CSS custom properties. Light theme (`:root` block) and dark theme (`.dark` block) both updated to Iris HSL values. No component, config, or structure changes. TDD approach: verify current colors → update values → test in browser.

**Tech Stack:** CSS (custom properties / variables), Tailwind CSS, next-themes

---

## Task 1: Verify Current Light Theme Colors

**Files:**
- Reference: `app/globals.css` (current state)
- Reference: `design/iris-theme/app/globals.css` (Iris source)

- [ ] **Step 1: Open `app/globals.css` and view current `:root` block**

```bash
head -50 app/globals.css
```

Expected output: `:root { ... }` block with oklch color values like `oklch(0.99 0 0)`, `oklch(0.548...)`, etc.

- [ ] **Step 2: Verify the block contains these variables**

Look for: `--background`, `--foreground`, `--primary`, `--card`, `--border`, `--chart-1` through `--chart-5`, `--sidebar-*`, etc.

Expected: ~35 variables in the `:root` block.

- [ ] **Step 3: Start the dev server and view light theme**

```bash
npm run dev
```

Open http://localhost:4000 in browser and take a screenshot of the light theme (current state).

Expected: Current InboxUI light theme colors (purplish primary, light background).

- [ ] **Step 4: Document current state**

Note in comments: "Original oklch-based colors, replacing with Iris HSL palette"

---

## Task 2: Update Light Theme Colors (`:root` block)

**Files:**
- Modify: `app/globals.css` (lines containing `:root { ... }` through closing `}`)

Use the Iris Light color mappings from the design spec section 3.

- [ ] **Step 1: Replace `--background` value**

Find:
```css
--background: oklch(0.99 0 0);
```

Replace with:
```css
--background: 240 17% 97%;         /* #f4f4f8 */
```

- [ ] **Step 2: Replace `--foreground` value**

Find:
```css
--foreground: oklch(0.165 0 0);
```

Replace with:
```css
--foreground: 225 27% 7%;          /* #0c0e15  ink */
```

- [ ] **Step 3: Replace `--card` value**

Find:
```css
--card: oklch(1 0 0);
```

Replace with:
```css
--card: 0 0% 100%;                 /* #ffffff  surface */
```

- [ ] **Step 4: Replace `--card-foreground` value**

Find:
```css
--card-foreground: oklch(0.165 0 0);
```

Replace with:
```css
--card-foreground: 225 27% 7%;
```

- [ ] **Step 5: Replace `--popover` value**

Find:
```css
--popover: oklch(1 0 0);
```

Replace with:
```css
--popover: 0 0% 100%;
```

- [ ] **Step 6: Replace `--popover-foreground` value**

Find:
```css
--popover-foreground: oklch(0.165 0 0);
```

Replace with:
```css
--popover-foreground: 225 27% 7%;
```

- [ ] **Step 7: Replace `--primary` value**

Find:
```css
--primary: oklch(0.548 0.186 251.731);
```

Replace with:
```css
--primary: 236 72% 58%;            /* #4a52e0  accent */
```

- [ ] **Step 8: Replace `--primary-foreground` value**

Find:
```css
--primary-foreground: oklch(0.99 0 0);
```

Replace with:
```css
--primary-foreground: 0 0% 100%;
```

- [ ] **Step 9: Replace `--secondary` value**

Find:
```css
--secondary: oklch(0.95 0.008 251.731);
```

Replace with:
```css
--secondary: 240 14% 94%;          /* #ececf2  sunk */
```

- [ ] **Step 10: Replace `--secondary-foreground` value**

Find:
```css
--secondary-foreground: oklch(0.165 0 0);
```

Replace with:
```css
--secondary-foreground: 225 27% 7%;
```

- [ ] **Step 11: Replace `--muted` value**

Find:
```css
--muted: oklch(0.96 0.004 251.731);
```

Replace with:
```css
--muted: 240 14% 94%;
```

- [ ] **Step 12: Replace `--muted-foreground` value**

Find:
```css
--muted-foreground: oklch(0.508 0.024 251.731);
```

Replace with:
```css
--muted-foreground: 225 12% 42%;   /* #5e6478 */
```

- [ ] **Step 13: Replace `--accent` value**

Find:
```css
--accent: oklch(0.95 0.008 251.731);
```

Replace with:
```css
--accent: 236 72% 58%;
```

- [ ] **Step 14: Replace `--accent-foreground` value**

Find:
```css
--accent-foreground: oklch(0.165 0 0);
```

Replace with:
```css
--accent-foreground: 0 0% 100%;
```

- [ ] **Step 15: Replace `--destructive` value**

Find:
```css
--destructive: oklch(0.577 0.245 27.325);
```

Replace with:
```css
--destructive: 0 51% 53%;          /* #c44a4a */
```

- [ ] **Step 16: Replace `--destructive-foreground` value**

Find:
```css
--destructive-foreground: oklch(0.99 0 0);
```

Replace with:
```css
--destructive-foreground: 0 0% 100%;
```

- [ ] **Step 17: Add `--success` value (if missing)**

After `--destructive-foreground`, add:
```css
--success: 153 64% 29%;            /* deep emerald */
```

- [ ] **Step 18: Add `--warning` value (if missing)**

After `--success`, add:
```css
--warning: 38 67% 38%;             /* #a07820 */
```

- [ ] **Step 19: Replace `--border` value**

Find:
```css
--border: oklch(0.91 0.006 251.731);
```

Replace with:
```css
--border: 232 15% 89%;             /* #dedfe8 */
```

- [ ] **Step 20: Replace `--input` value**

Find:
```css
--input: oklch(0.91 0.006 251.731);
```

Replace with:
```css
--input: 232 15% 89%;
```

- [ ] **Step 21: Replace `--ring` value**

Find:
```css
--ring: oklch(0.548 0.186 251.731);
```

Replace with:
```css
--ring: 236 72% 58%;
```

- [ ] **Step 22: Replace `--chart-1` value**

Find:
```css
--chart-1: oklch(0.548 0.186 251.731);
```

Replace with:
```css
--chart-1: 236 72% 58%;
```

- [ ] **Step 23: Replace `--chart-2` value**

Find:
```css
--chart-2: oklch(0.628 0.166 234.425);
```

Replace with:
```css
--chart-2: 219 80% 50%;
```

- [ ] **Step 24: Replace `--chart-3` value**

Find:
```css
--chart-3: oklch(0.698 0.146 268.125);
```

Replace with:
```css
--chart-3: 263 65% 60%;
```

- [ ] **Step 25: Replace `--chart-4` value**

Find:
```css
--chart-4: oklch(0.468 0.206 251.731);
```

Replace with:
```css
--chart-4: 153 64% 36%;
```

- [ ] **Step 26: Replace `--chart-5` value**

Find:
```css
--chart-5: oklch(0.728 0.126 251.731);
```

Replace with:
```css
--chart-5: 38 75% 50%;
```

- [ ] **Step 27: Replace `--sidebar-background` value** (if different from `--background`)

Find:
```css
--sidebar: oklch(0.985 0 0);
```

Replace with:
```css
--sidebar-background: 240 17% 97%;
```

Note: Check if variable is named `--sidebar` or `--sidebar-background`.

- [ ] **Step 28: Replace `--sidebar-foreground` value**

Find:
```css
--sidebar-foreground: oklch(0.165 0 0);
```

Replace with:
```css
--sidebar-foreground: 225 27% 7%;
```

- [ ] **Step 29: Replace `--sidebar-primary` value**

Find:
```css
--sidebar-primary: oklch(0.548 0.186 251.731);
```

Replace with:
```css
--sidebar-primary: 236 72% 58%;
```

- [ ] **Step 30: Replace `--sidebar-primary-foreground` value**

Find:
```css
--sidebar-primary-foreground: oklch(0.99 0 0);
```

Replace with:
```css
--sidebar-primary-foreground: 0 0% 100%;
```

- [ ] **Step 31: Replace `--sidebar-accent` value**

Find:
```css
--sidebar-accent: oklch(0.95 0.008 251.731);
```

Replace with:
```css
--sidebar-accent: 240 14% 94%;
```

- [ ] **Step 32: Replace `--sidebar-accent-foreground` value**

Find:
```css
--sidebar-accent-foreground: oklch(0.165 0 0);
```

Replace with:
```css
--sidebar-accent-foreground: 225 27% 7%;
```

- [ ] **Step 33: Replace `--sidebar-border` value**

Find:
```css
--sidebar-border: oklch(0.91 0.006 251.731);
```

Replace with:
```css
--sidebar-border: 232 15% 89%;
```

- [ ] **Step 34: Replace `--sidebar-ring` value**

Find:
```css
--sidebar-ring: oklch(0.548 0.186 251.731);
```

Replace with:
```css
--sidebar-ring: 236 72% 58%;
```

- [ ] **Step 35: Update `--radius` (optional border radius adjustment)**

Find:
```css
--radius: 0.5rem;
```

Replace with:
```css
--radius: 0.625rem;
```

- [ ] **Step 36: Verify all `:root` replacements**

Run:
```bash
grep "oklch(" app/globals.css | grep -v "\.dark" | head -5
```

Expected: No oklch values in the `:root` block (should show 0 lines or only dark theme oklch values).

---

## Task 3: Update Dark Theme Colors (`.dark` block)

**Files:**
- Modify: `app/globals.css` (lines containing `.dark { ... }` through closing `}`)

Use the Iris Dark color mappings from the design spec section 3.

- [ ] **Step 1: Replace `.dark --background` value**

Find:
```css
--background: oklch(0.125 0 0);
```

Replace with:
```css
--background: 225 27% 7%;          /* #0c0e15 */
```

- [ ] **Step 2: Replace `.dark --foreground` value**

Find:
```css
--foreground: oklch(0.97 0 0);
```

Replace with:
```css
--foreground: 228 25% 92%;         /* #e6e8f1 */
```

- [ ] **Step 3: Replace `.dark --card` value**

Find:
```css
--card: oklch(0.145 0 0);
```

Replace with:
```css
--card: 225 23% 12%;               /* #161a26  surface */
```

- [ ] **Step 4: Replace `.dark --card-foreground` value**

Find:
```css
--card-foreground: oklch(0.97 0 0);
```

Replace with:
```css
--card-foreground: 228 25% 92%;
```

- [ ] **Step 5: Replace `.dark --popover` value**

Find:
```css
--popover: oklch(0.145 0 0);
```

Replace with:
```css
--popover: 224 27% 14%;            /* #1a1f2e  surface2 */
```

- [ ] **Step 6: Replace `.dark --popover-foreground` value**

Find:
```css
--popover-foreground: oklch(0.97 0 0);
```

Replace with:
```css
--popover-foreground: 228 25% 92%;
```

- [ ] **Step 7: Replace `.dark --primary` value**

Find:
```css
--primary: oklch(0.648 0.186 251.731);
```

Replace with:
```css
--primary: 237 100% 74%;           /* #7c83ff  accent */
```

- [ ] **Step 8: Replace `.dark --primary-foreground` value**

Find:
```css
--primary-foreground: oklch(0.99 0 0);
```

Replace with:
```css
--primary-foreground: 225 27% 7%;
```

- [ ] **Step 9: Replace `.dark --secondary` value**

Find:
```css
--secondary: oklch(0.225 0.016 251.731);
```

Replace with:
```css
--secondary: 224 27% 14%;
```

- [ ] **Step 10: Replace `.dark --secondary-foreground` value**

Find:
```css
--secondary-foreground: oklch(0.97 0 0);
```

Replace with:
```css
--secondary-foreground: 228 25% 92%;
```

- [ ] **Step 11: Replace `.dark --muted` value**

Find:
```css
--muted: oklch(0.205 0.012 251.731);
```

Replace with:
```css
--muted: 225 23% 12%;
```

- [ ] **Step 12: Replace `.dark --muted-foreground` value**

Find:
```css
--muted-foreground: oklch(0.648 0.048 251.731);
```

Replace with:
```css
--muted-foreground: 225 16% 55%;   /* #7a82a0 */
```

- [ ] **Step 13: Replace `.dark --accent` value**

Find:
```css
--accent: oklch(0.225 0.016 251.731);
```

Replace with:
```css
--accent: 237 100% 74%;
```

- [ ] **Step 14: Replace `.dark --accent-foreground` value**

Find:
```css
--accent-foreground: oklch(0.97 0 0);
```

Replace with:
```css
--accent-foreground: 225 27% 7%;
```

- [ ] **Step 15: Replace `.dark --destructive` value**

Find:
```css
--destructive: oklch(0.477 0.195 27.325);
```

Replace with:
```css
--destructive: 0 100% 74%;         /* #ff7a7a */
```

- [ ] **Step 16: Replace `.dark --destructive-foreground` value**

Find:
```css
--destructive-foreground: oklch(0.99 0 0);
```

Replace with:
```css
--destructive-foreground: 225 27% 7%;
```

- [ ] **Step 17: Add `.dark --success` value (if missing)**

After `--destructive-foreground`, add:
```css
--success: 153 64% 60%;            /* mint */
```

- [ ] **Step 18: Add `.dark --warning` value (if missing)**

After `--success`, add:
```css
--warning: 38 75% 63%;             /* #e8b95a */
```

- [ ] **Step 19: Replace `.dark --border` value**

Find:
```css
--border: oklch(0.225 0.016 251.731);
```

Replace with:
```css
--border: 228 31% 19%;             /* #222840 */
```

- [ ] **Step 20: Replace `.dark --input` value**

Find:
```css
--input: oklch(0.225 0.016 251.731);
```

Replace with:
```css
--input: 228 31% 19%;
```

- [ ] **Step 21: Replace `.dark --ring` value**

Find:
```css
--ring: oklch(0.648 0.186 251.731);
```

Replace with:
```css
--ring: 237 100% 74%;
```

- [ ] **Step 22: Replace `.dark --chart-1` value**

Find:
```css
--chart-1: oklch(0.648 0.186 251.731);
```

Replace with:
```css
--chart-1: 237 100% 74%;
```

- [ ] **Step 23: Replace `.dark --chart-2` value**

Find:
```css
--chart-2: oklch(0.728 0.166 234.425);
```

Replace with:
```css
--chart-2: 200 85% 65%;
```

- [ ] **Step 24: Replace `.dark --chart-3` value**

Find:
```css
--chart-3: oklch(0.798 0.146 268.125);
```

Replace with:
```css
--chart-3: 270 75% 70%;
```

- [ ] **Step 25: Replace `.dark --chart-4` value**

Find:
```css
--chart-4: oklch(0.568 0.206 251.731);
```

Replace with:
```css
--chart-4: 153 64% 60%;
```

- [ ] **Step 26: Replace `.dark --chart-5` value**

Find:
```css
--chart-5: oklch(0.828 0.126 251.731);
```

Replace with:
```css
--chart-5: 38 75% 63%;
```

- [ ] **Step 27: Replace `.dark --sidebar-background` value**

Find:
```css
--sidebar: oklch(0.165 0 0);
```

Replace with:
```css
--sidebar-background: 225 27% 7%;
```

Note: Check if variable is named `--sidebar` or `--sidebar-background`.

- [ ] **Step 28: Replace `.dark --sidebar-foreground` value**

Find:
```css
--sidebar-foreground: oklch(0.97 0 0);
```

Replace with:
```css
--sidebar-foreground: 228 25% 92%;
```

- [ ] **Step 29: Replace `.dark --sidebar-primary` value**

Find:
```css
--sidebar-primary: oklch(0.648 0.186 251.731);
```

Replace with:
```css
--sidebar-primary: 237 100% 74%;
```

- [ ] **Step 30: Replace `.dark --sidebar-primary-foreground` value**

Find:
```css
--sidebar-primary-foreground: oklch(0.99 0 0);
```

Replace with:
```css
--sidebar-primary-foreground: 225 27% 7%;
```

- [ ] **Step 31: Replace `.dark --sidebar-accent` value**

Find:
```css
--sidebar-accent: oklch(0.225 0.016 251.731);
```

Replace with:
```css
--sidebar-accent: 225 23% 12%;
```

- [ ] **Step 32: Replace `.dark --sidebar-accent-foreground` value**

Find:
```css
--sidebar-accent-foreground: oklch(0.97 0 0);
```

Replace with:
```css
--sidebar-accent-foreground: 228 25% 92%;
```

- [ ] **Step 33: Replace `.dark --sidebar-border` value**

Find:
```css
--sidebar-border: oklch(0.225 0.016 251.731);
```

Replace with:
```css
--sidebar-border: 228 31% 19%;
```

- [ ] **Step 34: Replace `.dark --sidebar-ring` value**

Find:
```css
--sidebar-ring: oklch(0.648 0.186 251.731);
```

Replace with:
```css
--sidebar-ring: 237 100% 74%;
```

- [ ] **Step 35: Verify all `.dark` replacements**

Run:
```bash
grep -A 50 "\.dark {" app/globals.css | grep "oklch("
```

Expected: No output (no oklch values in dark theme).

---

## Task 4: Verify Colors in Browser (Light Theme)

**Files:**
- Reference: `app/globals.css` (after updates)

- [ ] **Step 1: Reload the dev server**

The dev server should auto-reload. Refresh http://localhost:4000 in your browser (hard refresh: Cmd+Shift+R on Mac, Ctrl+Shift+R on Linux/Windows).

- [ ] **Step 2: Verify light theme background**

Expected: Light grayish background (#f4f4f8)
Check: Dashboard background, card backgrounds should be white or very light

- [ ] **Step 3: Verify light theme primary accent**

Expected: Blue accent (#4a52e0) on buttons, links, form focus states
Check: "Create Inbox" button, any primary action buttons should be blue

- [ ] **Step 4: Verify light theme text color**

Expected: Dark text (#0c0e15) on light background
Check: Readability, contrast on main content area

- [ ] **Step 5: Verify light theme borders**

Expected: Subtle light gray borders (#dedfe8)
Check: Card borders, input field borders, divider lines

- [ ] **Step 6: Take a screenshot of light theme**

Capture the full page in light mode for comparison against Iris light design.

---

## Task 5: Verify Colors in Browser (Dark Theme)

**Files:**
- Reference: `app/globals.css` (after updates)

- [ ] **Step 1: Toggle to dark mode**

Use your theme toggle (if available in the UI) or browser dev tools:
Open DevTools → Console, run:
```javascript
document.documentElement.classList.add('dark')
```

Or check if there's a theme toggle button in the navbar/sidebar.

- [ ] **Step 2: Verify dark theme background**

Expected: Very dark background (#0c0e15)
Check: Main background should be nearly black

- [ ] **Step 3: Verify dark theme primary accent**

Expected: Light purple accent (#7c83ff) on buttons, links, form focus states
Check: Buttons and interactive elements should stand out in light purple

- [ ] **Step 4: Verify dark theme text color**

Expected: Light text (#e6e8f1) on dark background
Check: Readability, contrast on main content area

- [ ] **Step 5: Verify dark theme card color**

Expected: Dark gray cards (#161a26)
Check: Cards, modals, dropdowns should be darker than background but lighter than it

- [ ] **Step 6: Verify dark theme borders**

Expected: Dark blue-gray borders (#222840)
Check: Card borders, input field borders, divider lines

- [ ] **Step 7: Take a screenshot of dark theme**

Capture the full page in dark mode for comparison against Iris dark design.

---

## Task 6: Run Tests and Commit

**Files:**
- Modify: `app/globals.css` (all color updates complete)

- [ ] **Step 1: Stop the dev server**

Press Ctrl+C in the terminal running `npm run dev`.

- [ ] **Step 2: Run the test suite**

```bash
npm run test
```

Expected: All tests pass (or show same pass/fail as before — color changes shouldn't break tests).

If tests fail, check if failures are related to color/CSS changes. If not, they were pre-existing.

- [ ] **Step 3: View the final `app/globals.css` file**

```bash
head -100 app/globals.css
```

Verify:
- No `oklch(` values in `:root` block
- All HSL values present and formatted correctly
- Comments include hex equivalents for reference

- [ ] **Step 4: Stage the changes**

```bash
git add app/globals.css
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: replace theme colors with iris palette (light & dark)"
```

- [ ] **Step 6: Verify commit**

```bash
git log --oneline -1
```

Expected: Latest commit is "feat: replace theme colors with iris palette (light & dark)"

- [ ] **Step 7: Restart dev server for final verification**

```bash
npm run dev
```

Open http://localhost:4000 and do a final visual spot-check in both light and dark modes.

---

## Summary

**What's done:**
- ✅ Light theme colors updated to Iris palette
- ✅ Dark theme colors updated to Iris palette
- ✅ Border radius updated (0.5rem → 0.625rem)
- ✅ Colors verified in browser (light + dark)
- ✅ Tests pass
- ✅ Changes committed

**Files changed:** 1 (`app/globals.css`)
**Lines changed:** ~70 (color value replacements)
**No other files affected.**

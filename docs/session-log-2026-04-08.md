# Session Log — 2026-04-08

**Project:** Career Katalyst Job Scraper (Next.js 14, App Router)  
**Branch:** `claude/job-scraper-app-fjBCf`  
**Stack:** Next.js 14 · TypeScript · Tailwind CSS · `node-html-parser` · pure `fetch` (no Playwright)

---

## What Was Accomplished

### 1. Salary Range Parsing — Complete Rewrite (`lib/parsers/salary.ts`)

**Problem:** Jobs like `$45,000–$60,000` were displaying as `$45K` instead of `$45K–$60K`.

**Root cause found:** `RANGE_PATTERNS` were built using JavaScript template literals:
```typescript
// BAD — \\$ in a template literal produces a literal backslash before the dollar sign
`\\${numTok('\\)}`  →  \$ in the regex  →  matches backslash+end-of-string, NOT a dollar sign
```
Because no range pattern fired, only the first number was captured.

**Fix:** Replaced every template-literal-built pattern with clean `new RegExp(...)` calls using pre-defined helper strings `N` (number + K suffix) and `S` (separator dash/to). Added 10 patterns covering CA$, $, between/from, CAD, USD, GBP (£), EUR (€), ISO codes, comma-formatted numbers, and salary-keyword context.

**Also added:** Global currency support — `detectCurrency()` returns `CAD/GBP/EUR/USD` and `formatSalaryDisplay` uses the correct symbol (£/€/$).

---

### 2. Repost Detection — Fixed Across All Three Scrapers

#### LinkedIn (`lib/scrapers/linkedin.ts`)

**Problem:** Jobs labeled as reposted were actually fresh, and vice versa.

**Root cause:** LinkedIn puts "Reposted" as a **sibling `<span>` next to `<time>`**, not inside `<time>`. The code was only reading `timeEl.textContent`, so it never saw the "Reposted" label.

**Also fixed:** An earlier bug where `(timeEl?.getAttribute('class') ?? '').includes('--new')` was being used to detect reposts. The `--new` CSS class is LinkedIn's marker for **freshly posted** jobs, not reposted ones — this was inverting the logic.

**Final detection logic:**
```typescript
const isReposted =
  /\breposted\b/i.test(dateText) ||          // inside <time>
  /\breposted\b/i.test(dateParentText) ||    // sibling/parent of <time>
  timeClass.includes('repost') ||            // CSS class on <time>
  li.querySelector('[class*="repost"]') !== null; // any repost element in card
```

#### Glassdoor (`lib/scrapers/glassdoor.ts`)

**Problem:** Almost every job was showing as reposted (mass false positives).

**Root cause:** Detection was scanning `card.textContent` — the **entire card** including the job description body. Many descriptions contain phrases like "this role was reposted due to high application volume", which triggered the regex everywhere.

**Fix:** Scoped detection to only the date/listing-age element and its immediate parent.

#### Indeed (`lib/scrapers/indeed.ts`)

**Problem:** All Indeed jobs silently showed `isReposted: false` — no detection existed.

**Fix:** Added detection against `[class*="repost"]`/`[class*="refreshed"]` elements and the date-posted area on the detail page.

---

### 3. Fresh-First Sort (`app/api/scrape/route.ts`)

Non-reposted (fresh) jobs now sort above reposted ones. Within each group, sorted newest-first.

---

### 4. Keyword Relevance Filter (`lib/clientFilters.ts`)

**Problem:** Platforms return loosely related results where the search keyword only appears once in unrelated boilerplate text.

**Fix:** Client-side filter that:
- Parses keywords into **OR-groups** (comma or ` OR ` separated)
- Strips **stopwords** (`job`, `role`, `the`, `for`, `work`, `team`, etc.)
- Uses **stem-prefix matching** so `analyst→analy` matches analyst/analysis/analytics, `manager→manag` matches manager/management/managing, `developer→devel` matches developer/development
- A job passes if **all tokens in at least one OR-group** appear in title + company + description
- Unknown/empty queries always pass through

---

### 5. Colored Employment Type Badges (`components/ResultsTable.tsx`)

Replaced plain text with colored pill badges:
- **Full-time** → blue
- **Part-time** → purple
- **Contract** → orange

---

### 6. Date Filter UX (`components/SearchPanel.tsx`)

Added `customHours` state. Clicking any preset button (Any, 1h, 6h, 12h, 24h, etc.) now clears the custom hours input field. Previously the input retained its value visually even after a preset overrode it.

---

### 7. Footer

Added sticky footer to `app/page.tsx`:
> Made with ❤️ by **Viraj Shah** — underlined, links to `https://www.linkedin.com/in/viraj-irl/`, opens in new tab.

---

## What Didn't Work / Mistakes Made

### Mistake 1: Tried to Recreate the Logo as SVG Instead of Asking for the File

**What happened:** The user asked for the Career Katalyst (CK) logo to be used in the loading screen. I attempted to recreate it as an inline SVG by eyeballing the image in chat. The result looked noticeably different from the actual logo.

**What I should have done:** Immediately ask the user to place the actual image file at `public/ck-logo.png` and reference it with `<img src="/ck-logo.png" />`. Do not attempt to recreate brand assets as SVG from memory.

**Rule:** If the user provides or shows a logo/brand image, **always ask for the actual file** rather than recreating it.

---

### Mistake 2: Coin-Flip Animation — Multiple Iteration Failures

**What happened:** The user asked for a coin-flip loading animation. I went through this broken sequence:

1. Implemented `rotateY` (left-to-right flip)
2. User said: "flipping happens left to right, it should be top to bottom"
3. Changed to `rotateX` but didn't push (network error prevented push)
4. User said: "the logo looks different" (SVG recreation was wrong — see Mistake 1)
5. User said: "remove the logo flipping"
6. Removed the animation, kept the static SVG
7. User said: "remove the static logo"
8. Removed the SVG entirely, restored the original blue ring spinner

**Wasted commits:** 4 back-and-forth commits for something that was ultimately reverted entirely.

**What I should have done:**
- Before implementing, confirm the exact desired behavior with a quick question
- Ask for the actual logo file before doing any animation work
- Clarify flip direction (rotateX vs rotateY) upfront

**Rule:** For UI/animation tasks involving brand assets or specific visual effects, **clarify all requirements and get asset files before writing a single line of animation code.**

---

### Mistake 3: Glassdoor Repost Detection Was Scanning Entire Card Text

**What happened:** The detection was `card.textContent` — the whole card including description. This caused nearly every job to be marked as reposted because many descriptions say "this position has been reposted."

**Why it slipped through:** The logic looked correct at a glance — scanning the card for the word "reposted." The bug is in the **scope** of what's being scanned, not the regex itself.

**Rule:** When checking for metadata flags (reposted, urgent, etc.), **always scope the selector to the specific metadata element**, not a broad container that includes user-generated content (descriptions, titles, etc.).

---

### Mistake 4: LinkedIn Repost Detection Was Reading the Wrong Element

**What happened:** The code read `timeEl.textContent` expecting to find "Reposted" there. But LinkedIn places the "Reposted" label as a sibling `<span>` adjacent to `<time>`, not inside it. So the check silently returned `false` for all reposted jobs.

**What I should have done:** Check the parent container text (which includes siblings) in addition to the element itself. Always use `parentNode.textContent` as a fallback when scraping labels from social/job sites where HTML structure changes frequently.

**Rule:** For scraping labels from platforms like LinkedIn, **check the element, its parent, and nearby siblings** — never assume a label is inside the specific element you found.

---

### Mistake 5: Template Literal Regex Escaping Bug

**What happened:** `RANGE_PATTERNS` in `salary.ts` were built like:
```typescript
new RegExp(`\\${numTok('\\)}`...)
```
In a JS template literal, `\\` becomes a single backslash `\` in the resulting string. So `\\$` in a template literal produces `\$` in the regex, which means "literal backslash before end-of-string" — not "dollar sign."

**Why it's subtle:** The code *looks* like it should escape a dollar sign. But template literals and `RegExp` strings have different escaping rules. `\\$` in a template literal = `\$` in regex = matches `\` before end-of-string.

**Fix:** Use pre-built string variables with `new RegExp(variable, 'i')` — never construct regex strings inside template literals with double-backslash escaping.

**Rule:** **Never build regex patterns inside template literals.** Define the pattern string separately as a `const`, then pass it to `new RegExp()`. This makes escaping explicit and testable.

---

## General Rules Derived From This Session

| # | Rule |
|---|------|
| 1 | Never recreate brand assets as SVG — always ask for the actual file |
| 2 | Clarify all requirements for UI/animation tasks before coding |
| 3 | Scope metadata detection (reposted, urgent, etc.) to specific elements, not broad containers |
| 4 | When scraping labels from platforms, check element + parent + siblings |
| 5 | Never build regex patterns inside template literals — use `const pattern = '...'` + `new RegExp(pattern)` |
| 6 | When a platform changes HTML structure, the fallback strategy is: try multiple selectors, then check parent, then use class-name wildcard selectors |
| 7 | Client-side filters should use `null-passes` rule: unknown data (no salary, no industry, etc.) always passes the filter — never hides by default |
| 8 | Always run `npx tsc --noEmit` before committing |

---

## Commits This Session

| Hash | Description |
|---|---|
| `eb44f58` | Fix salary ranges, repost detection, badges, date filter UX |
| `3341d6b` | Add keyword relevance filter |
| `34cd43b` | Add footer, CK coin-flip logo animation in loading screen |
| `aa147f1` | Remove coin-flip animation from loading screen |
| `d97e02e` | *(intermediate — push during network error handling)* |
| `d443041` | Fix repost detection across all scrapers; restore original spinner |

# Session Notes — 2026-04-08

Reference doc for future sessions on this codebase. Covers what worked, what broke, and patterns to avoid.

---

## Project Context

- **Stack:** Next.js 14 App Router, TypeScript strict mode, `node-html-parser`, pure `fetch` (no Playwright/Puppeteer — Vercel 50 MB limit)
- **Sources scraped:** LinkedIn guest API only (`seeMoreJobPostings` for cards, `jobPosting/{id}` for detail pages)
- **Branch:** `claude/add-reposted-label-ywasw`
- **Stable baseline commit:** `d443041` (branch `claude/job-scraper-app-fjBCf`) — reverted to this mid-session after accumulated breakage

---

## What Worked

### Salary parsing improvements
- **Monthly JSON-LD fix:** LinkedIn embeds `baseSalary` with `unitText: "MONTH"` and a value like `2000`. Multiplying by 12 in `extractJsonLdData` (`lib/scrapers/utils.ts`) fixed the `$2K` display bug. Same logic for WEEK (×52) and HOUR (×2080).
- **"52,500 CAD" format:** Added a number-before-currency pattern to `SINGLE_VALUE_PATTERNS` in `lib/parsers/salary.ts`.
- **Commission extraction:** Added `extractVariableAmount()` helper to pull dollar figures out of commission/bonus strings. Now shows "$22K commission" instead of generic "Base + Commission".
- **Relabelling OTE → "Base + Commission":** The user didn't know what OTE meant. Simple label change, well-received.

### UI copy fixes
- **Loading disclaimer:** `"Results are scraped using AI. Salary, experience, and repost data may not always be accurate."` — user approved this wording. Avoid: the word "error", em dashes.
- **Removing Indeed/Glassdoor UI references:** Cleaned from `route.ts`, `types/job.ts`, `Badge.tsx`, `LoadingSpinner.tsx`, `EmptyState.tsx`, `page.tsx`. Straightforward once all locations were identified.

### Experience parser fix
- **Removing SENIOR_LEVEL/MID_LEVEL fallbacks:** Jobs titled "Senior Developer" were showing "7+ yrs experience required" with no numeric mention in the description. Removing those two fallback lines fixed it — jobs now show "Not specified" when no years are stated explicitly.

### App Router error components
- **`error.tsx`, `not-found.tsx`, `global-error.tsx`:** Next.js 14 App Router crashes on startup without these three files in `app/`. Created all three when the "missing required error components" crash appeared.

### Eluta link fix
- **No-op anchors (`#!`):** Eluta job links were resolving to `https://www.eluta.ca/#!`. Fix: skip any `rawHref` that starts with `#` or `javascript:`.

---

## What Didn't Work / Unresolved

### LinkedIn repost detection
- **Status: improved but unverified.** Two layers were added in a prior pass (card `li.textContent` scan + detail page first-3000-chars scan). In this session a 4-layer approach was implemented:
  1. Tight timestamp regex `/reposted\s+\d+\s+(?:minute|hour|day|week|month)s?\s+ago/i` against full detail HTML
  2. Broad `/reposted/i` against first 5 000 chars
  3. DOM scan of `[class*="posted-time"]`, `[class*="topcard__flavor"]`, `[class*="listed-time"]`, `<time>`
  4. `[class*="repost"]` class selector
- **Root uncertainty:** LinkedIn's guest API (no auth) may simply not include "Reposted" text in either the card HTML or the detail page for some jobs. Cannot confirm without live testing.
- **User's requirement:** "Don't stop until you find at least one reposted job in 50 potential jobs from LinkedIn." — this was not verified in session.

### Indeed and Glassdoor scrapers
- These were never actually returning jobs. The scrapers existed in code but silently failed (bot detection, HTML structure changes, etc.). User ultimately asked to remove them entirely rather than fix them.

### CareerBeacon
- Added as a scraper during session, but returned 0 jobs or "unavailable" errors. Not pursued further after revert.

---

## Mistakes Made — Avoid These

### 1. Nullish coalescing mixed with logical OR without parens
**Error:** `timeEl?.textContent?.trim() ?? '' || someOtherValue`
**TypeScript error:** `Nullish coalescing operator (??) requires parens when mixing with logical operators`
**Fix:** Always wrap `??` expressions: `(timeEl?.textContent?.trim() ?? '') || someOtherValue`
**Also bad:** `timeEl?.parentNode as typeof timeEl ?? timeEl` — invalid TypeScript cast syntax

### 2. Scope creep / unrequested changes
- Refactoring surrounding code, adding utilities, and expanding features beyond what was asked caused instability and prompted the user to revert the entire repo.
- **Rule:** Only change what was explicitly asked. Do not "clean up" adjacent code.

### 3. Adding scrapers without verifying they actually return data
- Eluta, CareerBeacon, Indeed, Glassdoor were all added/kept without confirming they returned real jobs in the live environment.
- **Rule:** If a scraper returns 0 jobs in testing, flag it immediately rather than shipping it silently.

### 4. Accumulating broken state instead of reverting early
- Multiple small bugs compounded across several iterations until the user had to manually revert to an old commit. An earlier rollback or smaller isolated commits would have prevented this.
- **Rule:** Commit atomically. One logical change per commit. If a change introduces a build error, fix it in the same commit before moving on.

### 5. OTE label — domain knowledge assumption
- Used industry jargon ("OTE" = On-Target Earnings) in the UI without explaining it. User didn't know what it meant.
- **Rule:** Use plain language in user-facing strings. Avoid acronyms unless the user introduces them.

### 6. Em dash in UI copy
- Used `—` in the loading disclaimer. User explicitly objected.
- **Rule:** Use periods or commas in UI copy, not em dashes.

### 7. Not reading all affected files before making changes
- Searched for Indeed/Glassdoor references in code but missed some locations (`EmptyState.tsx`, `app/page.tsx` header pills, `LoadingSpinner.tsx` pills), requiring multiple follow-up edits.
- **Rule:** Before removing a concept from a codebase, `grep` for it across all file types first.

### 8. Scanning too little HTML for repost detection
- First attempt only checked `html.substring(0, 3000)` which missed "Reposted" text that appears later in the page HTML.
- **Rule:** For detection of a specific pattern, use a tight enough regex that it's safe to scan the full document rather than relying on positional assumptions.

---

## Codebase Quick Reference

| File | Purpose |
|------|---------|
| `app/api/scrape/route.ts` | API endpoint — orchestrates scrapers, deduplication, sort |
| `lib/scrapers/linkedin.ts` | LinkedIn guest API scraper (cards + detail pages) |
| `lib/scrapers/utils.ts` | `buildJobFromRaw`, `extractJsonLdData`, `randomUserAgent`, `sleep` |
| `lib/parsers/salary.ts` | Salary string → `SalaryInfo` (ranges, single values, commission) |
| `lib/parsers/experience.ts` | Description text → `{ years, display }` |
| `lib/deduplication.ts` | Dedupe by `title|company|location` key |
| `types/job.ts` | All shared types + `DEFAULT_FILTERS` |
| `components/ui/Badge.tsx` | Source/work-type/default badge chips |
| `components/LoadingSpinner.tsx` | Loading state shown during scrape |
| `components/EmptyState.tsx` | Shown before first search |
| `app/page.tsx` | Main page layout + search panel |
| `app/error.tsx` | Required by Next.js App Router |
| `app/not-found.tsx` | Required by Next.js App Router |
| `app/global-error.tsx` | Required by Next.js App Router |

---

## LinkedIn Guest API Notes

- **Search endpoint:** `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=...&location=...&start=0`
- **Detail endpoint:** `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jobId}`
- Job ID extraction: `href.match(/[/-](\d{8,})\/?$/)?.[1]` — slug URLs end in `-XXXXXXXXXX`
- Rate limiting: sleep 1.2–2 s between detail page requests, back-off 4 s × attempt on 429/503
- No auth required, but responses vary — some fields missing depending on LinkedIn A/B tests
- JSON-LD `<script type="application/ld+json">` embedded in detail pages contains `baseSalary`, `employmentType`, `industry`

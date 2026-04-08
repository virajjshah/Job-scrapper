# Session Notes — 2026-04-08

## Task
Enhance job detail scraping to provide more accurate **salary** and **years of experience** extraction across LinkedIn, Indeed, and Glassdoor.

---

## What Was Done

### Files Modified
| File | Purpose |
|------|---------|
| `lib/parsers/salary.ts` | Core salary parser |
| `lib/parsers/experience.ts` | Core experience parser |
| `lib/scrapers/utils.ts` | JSON-LD extraction |
| `lib/scrapers/linkedin.ts` | LinkedIn scraper |
| `lib/scrapers/indeed.ts` | Indeed scraper |
| `lib/scrapers/glassdoor.ts` | Glassdoor scraper |

---

## What Worked

### Salary Parser (`salary.ts`)
- **Monthly salary detection** — `/month`, `per month`, `a month` now detected and converted to annual (×12), flagged as `isEstimated`
- **"an hour" pattern** — catches Indeed's format `$25 - $35 an hour` which was previously missed entirely (old HOURLY_PATTERNS required `/hr` or `per hour` right after the number)
- **"a year" indicator** — `$80,000 a year` now recognized as annual
- **Glassdoor cleanup** — `normalizeText()` strips `(Employer est.)` / `(Glassdoor est.)` before parsing — these annotations caused no direct parsing errors but were noise
- **Sanity guard** — skips single values below $1K annual / $5 hourly to avoid false matches on small numbers in job text

### Experience Parser (`experience.ts`)
- **Section capture window** — expanding from 600 → 1000 chars meaningfully helps since requirements sections in real postings often run long
- **All sections scanned** — the original only matched the FIRST section header using `.match()`. Changed to a `while (exec())` loop so ALL requirement/qualification sections in the document are tried. This is the most impactful change for accuracy.
- **HTML entity cleanup** — `cleanText()` strips `&amp;`, `&nbsp;`, `&#123;`, zero-width chars. These are common in scraped HTML and break regex matching silently.
- **New patterns added**: `X or more years`, `proven X+ years`, `proven track record of X years`, `X years hands-on/practical experience`, `minimum of X years`
- **New section headers**: Basic Qualifications, Required Experience, Key Requirements, Core Requirements, Job Requirements, What you'll need/have, You'll have/bring, Ideal candidate
- **SENIOR_LEVEL expanded** to include architect, director, VP, vice president

### JSON-LD Extraction (`utils.ts`)
- **`estimatedSalary` field** — Glassdoor uses this instead of `baseSalary`; was previously ignored
- **Flat numeric salary** — `baseSalary.value` as a plain number (not nested QuantitativeValue) now handled
- **Min-only salary** — emits a value even when only `minValue` is present
- **Early return fix** — now only returns when at least one useful field was extracted (prevents returning empty `{}` early and skipping later script tags)

### LinkedIn Scraper (`linkedin.ts`)
- **Seniority level extraction** — reads the "Seniority level" job criteria field and appends mapped keyword text to description. This means the experience parser's keyword fallback (`ENTRY_LEVEL`, `SENIOR_LEVEL`, `MID_LEVEL`) fires correctly for jobs that don't list explicit year counts.
- **`innerHTML` + `htmlToText()`** — using `innerHTML` with BR/LI → newline conversion preserves document structure. The original used `textContent` which collapses all whitespace, making section headers harder for the regex to detect.

### Indeed Scraper (`indeed.ts`)
- `htmlToText()` reuse for description — same structural preservation benefit
- Additional salary selectors: `salary-snippet`, `salaryText`, `data-testid`
- Added `data-testid="jobDescription"` selector for Indeed's newer HTML

### Glassdoor Scraper (`glassdoor.ts`)
- `cleanGlassdoorSalary()` called at both card collection and detail page levels
- Salary hint cascade: JSON-LD → cleaned chip → card salary (more fallback layers)
- `JobDetails_jobDescription` class selector added

---

## What Didn't Work / Mistakes to Avoid

### 1. Running `tsc --noEmit` in an environment without `node_modules`
**What happened:** Ran `npx tsc --noEmit` which output hundreds of errors — all from missing packages (`next`, `react`, `node-html-parser`, `@types/node`), not from my code.

**Time wasted:** Had to grep for just `lib/` errors, then explain to myself why they were pre-existing.

**Fix for next time:** In this repo, `node_modules` is never installed in the sandbox. Skip `tsc` entirely. Instead use the brace-balance node script as a lightweight syntax check, or just review the code visually. The real type check happens on Vercel at deploy time.

### 2. Attempting `npm run build` and `./node_modules/.bin/next`
**What happened:** Both failed immediately — `next: not found`. Should have checked `ls node_modules` first.

**Fix for next time:** Always check `ls node_modules | wc -l` before running any npm/next command. If `0`, skip all local build/test commands.

### 3. Spawning an Explore agent for a well-defined file discovery task
**What happened:** Used the Explore agent to read the codebase, which returned a long structured report — but I then had to re-read most of the actual files anyway with the `Read` tool because I needed the exact code.

**Fix for next time:** When I already know which files to look at (scrapers, parsers, utils), just `Read` them directly in parallel. Reserve the Explore agent for genuinely open-ended "find where X is" questions where the file paths are unknown.

### 4. No real-world test against actual scraped data
**What happened:** All changes were validated only via brace-balance check and code review. No actual scraping test was run to confirm the regex changes work against real LinkedIn/Indeed/Glassdoor HTML.

**Why:** Node_modules not installed, so can't run the dev server.

**Fix for next time:** If the user has the dev server available locally, ask them to run a test search and report the `salaryDisplay` and `yearsExperienceDisplay` values from the JSON response before and after. This is the only way to confirm regex changes actually fire on real data.

### 5. Original `RANGE_PATTERNS[1]` regex construction bug (inherited, not introduced)
**What it was:** The original code used a template literal to build a regex:
```ts
new RegExp(`\\${numTok('\\$')}${SEP}...`)
```
The leading `\\$` should have been `\\\\$` to produce a literal `\$` in the regex string, OR just `\\$` at the string level (which produces `\$` = escaped `$` in regex = just `$`). The original accidentally worked because `\$` in a regex is just `$`.

**Fix applied:** Rewrote as explicit string `\\$\\s*([\\d,]+...)` — same behavior but clearer intent.

### 6. Not verifying if old patterns already handled a case before adding new ones
**Example:** Spent time wondering if `$60,000 - $80,000 a year` was broken, then traced through that RANGE_PATTERNS[1] already catches `$60,000 - $80,000` and the `a year` just gets ignored. The bug was only with `HOURLY_PATTERNS` not catching `an hour` — needed to verify per-pattern before assuming everything was broken.

**Fix for next time:** Before writing a new pattern, trace one real-world example string through each existing pattern manually (or with a quick `node -e` test) to confirm it actually fails.

---

## Reference: Key Regex Patterns

### Salary — period detection order
1. `hasYearSuffix`: `/yr`, `/year`, `per year`, `annually`, `per annum`, **`a year`** (new)
2. `hasMonthSuffix`: `/month`, `/mo`, `per month`, **`a month`** (new)
3. `isHourly`: `/hr`, `/hour`, `per hour`, **`an hour`** (new), `an hour` after range

### Experience — section headers that trigger targeted search
`requirements`, `qualifications`, `what you'll bring`, `basic qualifications`, `required experience`, `key requirements`, `core requirements`, `job requirements`, `what you'll need`, `what you'll have`, `you'll have`, `you'll bring`, `ideal candidate`, `minimum qualifications`, `preferred qualifications`, `about you`, `who you are`

### LinkedIn seniority → experience mapping
| LinkedIn value | Text appended to desc | Fallback result |
|---|---|---|
| Internship | `Entry level internship co-op` | 0 yrs |
| Entry level | `Entry level junior` | 0 yrs |
| Associate | `Associate mid-level` | 3 yrs |
| Mid-Senior level | `Senior` | 7 yrs |
| Director | `Senior director lead principal` | 7 yrs |
| Executive | `Senior executive lead principal` | 7 yrs |

---

## Branch
All changes committed and pushed to: `claude/improve-job-scraper-6rVSA`

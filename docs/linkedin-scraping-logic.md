# LinkedIn Scraping Logic

This document describes the exact approach used to scrape LinkedIn job postings without authentication, cookies, or a browser. All requests are plain HTTP — no Playwright, Puppeteer, or Selenium.

---

## Overview: Two-Phase Scrape

```
Phase 1: Search API  →  collect up to 125 job cards (title, company, location, salary chip, date)
Phase 2: Detail API  →  for each card, fetch the full job posting (description, employment type, apply URL)
```

LinkedIn exposes two unauthenticated JSON/HTML endpoints that make this possible.

---

## The Two Guest API Endpoints

### 1. Search endpoint (Phase 1)

```
GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?{params}
```

Returns an HTML fragment — a list of `<li>` elements, each being a job card. No JSON. Paginate with `start=0`, `start=25`, `start=50`, etc. (25 results per page, max 5 pages = 125 jobs).

**Query parameters:**

| Param    | Value                              | Notes                              |
|----------|------------------------------------|------------------------------------|
| keywords | e.g. `Data Analyst`               | Job title / keyword                |
| location | e.g. `Toronto, Ontario, Canada`   | City, province, country            |
| start    | `0`, `25`, `50`, `75`, `100`      | Pagination offset                  |
| f_TPR    | `r86400` (24h), `r3600` (1h), etc | Time range — `r` + seconds         |
| f_WT     | `1` (on-site), `2` (remote), `3` (hybrid) | Work type filter          |
| f_JT     | `F` (full-time), `P` (part-time), `C` (contract) | Employment type, comma-separated |

**Date range formula:**
```
f_TPR = "r" + (days * 24 * 60 * 60)   // seconds
// e.g. last 24h = r86400, last 7d = r604800
```

**Work type map:**
```
Remote   → f_WT=2
Hybrid   → f_WT=3
On-site  → f_WT=1
(omit param for Any)
```

**Employment type map:**
```
Full-time  → F
Part-time  → P
Contract   → C
// Multiple values: f_JT=F,C
```

---

### 2. Detail endpoint (Phase 2)

```
GET https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jobId}
```

Returns a full HTML page for a single job. Contains:
- Full job description (plain text, no JavaScript required)
- Job criteria section (employment type, seniority, industry)
- JSON-LD `<script type="application/ld+json">` with structured `JobPosting` schema
- Apply button (`<a>` tag for external apply, `<button>` for Easy Apply)

---

## Phase 1: Parsing the Search Cards

Each `<li>` in the search response is a job card. Parse with any HTML parser.

### Extract the job ID

LinkedIn switched from plain numeric URLs to slug URLs:

```
Old format: /jobs/view/4195892764
New format: /jobs/view/senior-data-analyst-at-acme-corp-4195892764

// Extract: last 8+ digit number segment at end of path
jobId = href.match(/[/-](\d{8,})\/?$/)?.[1]
     ?? href.match(/\/jobs\/view\/(\d+)/)?.[1]
     ?? ''
```

### Extract fields from the card

```
title    = li.querySelector('.base-search-card__title')?.textContent
           ?? li.querySelector('h3')?.textContent

company  = li.querySelector('.base-search-card__subtitle')?.textContent
           ?? li.querySelector('h4')?.textContent

location = li.querySelector('.job-search-card__location')?.textContent
```

### Extract salary chip

LinkedIn class names change frequently. Use a cascade:

```
1. li.querySelector('.job-search-card__salary-info')
2. li.querySelector('[class*="salary"]')
3. li.querySelector('[class*="compensation"]')
4. Fallback: scan every <span> and <div> for a salary-like regex pattern
```

Salary regex fallback:
```regex
/(?:CA\$|C\$|\$)[\d,]+(?:\.\d{1,2})?\s*(?:K|k)?(?:\s*[-–—\/]\s*(?:CA\$|C\$|\$)?[\d,]+(?:\.\d{1,2})?\s*(?:K|k)?)?\s*(?:\/hr|\/hour|\/yr|\/year|\bper hour\b|\bper year\b)/i
```

### Extract benefits / employment type pills

```
li.querySelectorAll('.job-search-card__benefits li, [class*="job-search-card__benefits"] li')
// Values like "Full-time", "Remote", "Health insurance", etc.
```

### Extract date posted

```
timeEl = li.querySelector('time')
dateText = timeEl?.textContent    // e.g. "3 hours ago", "1 week ago", "Reposted 2 days ago"
```

### Detect repost (search card level)

**Critical:** Only check date/time elements — never scan the full card. Job descriptions often contain the word "reposted" in prose context.

```
isReposted =
  /\breposted\b/i.test(timeEl.textContent)        // time element text
  || /\breposted\b/i.test(timeEl.parentNode.textContent)  // parent container
  || timeEl.getAttribute('class').includes('repost')       // class name
  || li.querySelector('[class*="repost"]') !== null         // badge element
```

### Data quality check

Skip cards with very short or empty titles:
```
if title.length < 3 → skip (filters out junk like "OK", "IT")
```

---

## Phase 2: Parsing the Detail Page

Fetch `jobPosting/{jobId}` for each card collected in Phase 1.

### Extract JSON-LD structured data

LinkedIn embeds a `<script type="application/ld+json">` block with the `JobPosting` schema. This is the most reliable salary and employment type source.

```javascript
// Find the script tag, parse JSON, look for @type = "JobPosting"
const schema = JSON.parse(scriptContent)
const entry = Array.isArray(schema)
  ? schema.find(s => s['@type'] === 'JobPosting')
  : schema

// Employment type
entry.employmentType  // string or array: "FULL_TIME", "CONTRACTOR", etc.

// Industry
entry.industry             // e.g. "Software Development"
entry.occupationalCategory // fallback

// Salary (baseSalary object)
entry.baseSalary.value.minValue   // e.g. 80000
entry.baseSalary.value.maxValue   // e.g. 120000
entry.baseSalary.value.unitText   // "YEAR", "MONTH", "WEEK", "HOUR"
```

**Important:** LinkedIn sometimes sends `minValue: 0` — guard against it:
```
if (min > 0 && max > 0) → use range
else if (max > 0)       → use max only
else                    → no salary
```

**Unit conversion** (LinkedIn sometimes sends monthly/hourly instead of annual):
```
MONTH  × 12   = annual
WEEK   × 52   = annual
HOUR   × 2080 = annual  (40hr × 52wk)
YEAR   × 1    = already annual
```

### Extract the full job description

```
1. .description__text
2. .show-more-less-html__markup
3. section.description
4. div.description
5. [class*="description"]
6. Fallback: harvest all <p> and <li> text, filter to items > 25 chars
```

### Extract employment type (fallback if not in JSON-LD)

```
// Look for the criteria list
for each .description__job-criteria-item:
  if h3.textContent includes "employment type" or "job type":
    return span.textContent  // e.g. "Full-time"
```

### Extract external apply URL

```
// Easy Apply is a <button> — external apply is an <a>
1. a.apply-button--offsite
2. a[class*="apply-button"]
3. a.apply-button
// Only use it if href does NOT contain "linkedin.com"
```

### Detect repost (detail page level)

Same principle: only check metadata elements, not the description body.

```javascript
// Tight regex: matches "Reposted 3 hours ago" format exactly
// Descriptions never say "reposted 3 hours ago" naturally
REPOST_TS_RE = /reposted\s+\d+\s+(?:minute|hour|day|week|month)s?\s+ago/i

// Metadata elements to check:
selectors = [
  '[class*="posted-time"]',
  '[class*="listed-time"]',
  '[class*="topcard__flavor"]',
  '[class*="posted-date"]',
  '[class*="job-search-card__listdate"]',
  'time'
]

detailIsReposted =
  REPOST_TS_RE.test(fullHtml)   // safe — tight format never appears in descriptions
  || metaElements.some(el => /\breposted\b/i.test(el.textContent))
  || root.querySelector('[class*="repost"]') !== null

// Combine with card-level detection:
isReposted = card.isReposted || detailIsReposted
```

**Known limitation:** The "Reposted" label on LinkedIn is JavaScript-rendered for authenticated users. The guest API almost never includes it in HTML. The `isReposted` flag will almost always be `false` even for genuinely reposted jobs.

---

## Request Headers

These headers are required. Without them LinkedIn returns 999 or redirects.

```http
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language: en-CA,en;q=0.9
Cache-Control: no-cache
Referer: https://www.linkedin.com/jobs/search/
Upgrade-Insecure-Requests: 1
```

Rotate through several real User-Agent strings — don't use the same one every request.

---

## Rate Limiting & Timing

LinkedIn will 429 you if you go too fast.

```
Between search pages:   1000–1500ms + random jitter (0–500ms)
Between detail fetches: 1200–2000ms (1200ms base + random 0–800ms)

On 429 or 503: back off exponentially (4s, 8s...) and retry up to 3 times
Timeout per request: 25 seconds
```

---

## Salary Parsing (Post-Scrape)

Raw salary text from LinkedIn comes in many formats. Parse in this priority order:

1. **JSON-LD baseSalary** (most structured, already normalized to annual above)
2. **Detail page salary chip** (e.g. `CA$80,000/yr – CA$100,000/yr`)
3. **Search card salary chip** (same format, less detail)
4. **Description text** (free-form, regex-extracted)

Range patterns to match (in order of specificity):
```regex
CA$70K/yr – CA$75K/yr
$60K – $80K
$60,000 – $80,000
between $60K and $80K
CAD 60,000 – 80,000
USD 60,000 – 80,000
£45K – £60K
€45K – €60K
45,000 – 60,000  (near year/currency context)
salary: 45000 to 60000
```

Hourly detection (convert to annual via × 2080):
```regex
$25/hr, $25 per hour, CA$25/hr, £15/hour
```

---

## Data Extracted Per Job

| Field            | Source                                      |
|------------------|---------------------------------------------|
| title            | Search card `.base-search-card__title`      |
| company          | Search card `.base-search-card__subtitle`   |
| location         | Search card `.job-search-card__location`    |
| datePosted       | Search card `<time>` text                   |
| isReposted       | Search card + detail page `<time>` elements |
| salary (range)   | JSON-LD > detail chip > card chip > description |
| employmentType   | JSON-LD > detail criteria > card benefit pills |
| workType         | Location/description text keywords          |
| industry         | JSON-LD > keyword rules on title+description |
| yearsExperience  | Regex on description text                   |
| description      | Detail page `.description__text`            |
| sourceUrl        | Search card `<a href>` (cleaned, no query params) |
| applyUrl         | Detail page external apply `<a>` (if not Easy Apply) |

---

## Deduplication

Before returning results, deduplicate on the job URL path (stripped of query params):

```javascript
const seenHrefs = new Set()
const href = rawHref.split('?')[0]
if (seenHrefs.has(href)) skip
seenHrefs.add(href)
```

---

## Full Pseudocode

```python
def scrape_linkedin(keywords, location, date_days, work_type, emp_types):
    cards = []
    seen = set()

    # Phase 1: Collect cards
    for start in [0, 25, 50, 75, 100]:
        url = build_search_url(keywords, location, start, date_days, work_type, emp_types)
        html = get(url, headers=HEADERS)
        sleep(1.0 + random(0, 0.5))

        for li in parse(html).select('li'):
            link = li.select_one('a[href*="/jobs/view/"]')
            if not link: continue

            href = clean_url(link['href'])
            if href in seen: continue
            seen.add(href)

            job_id = extract_job_id(href)
            title = li.select_one('.base-search-card__title')?.text.strip()
            if not title or len(title) < 3: continue

            cards.append({
                'href': href, 'job_id': job_id,
                'title': title,
                'company': li.select_one('.base-search-card__subtitle')?.text.strip(),
                'location': li.select_one('.job-search-card__location')?.text.strip(),
                'salary': extract_salary_chip(li),
                'benefits': extract_benefit_pills(li),
                'date_text': li.select_one('time')?.text.strip(),
                'is_reposted': detect_repost_from_card(li)
            })

        if no cards added this page: break

    # Phase 2: Deep scrape
    jobs = []
    for card in cards:
        sleep(1.2 + random(0, 0.8))
        try:
            detail_html = get(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{card['job_id']}", headers=HEADERS)
            job = parse_detail(card, detail_html)
        except:
            job = build_from_card_only(card)
        jobs.append(job)

    return jobs


def parse_detail(card, html):
    root = parse(html)
    ld = extract_json_ld(html)   # JobPosting schema

    description = extract_description(root)
    emp_type    = ld.get('employmentType') or extract_emp_type_from_criteria(root)
    apply_url   = extract_external_apply_url(root)
    salary_hint = build_salary_hint(ld, root, card['salary'])
    is_reposted = card['is_reposted'] or detect_repost_from_detail(html, root)

    return build_job(card, description, emp_type, apply_url, salary_hint, is_reposted, ld.get('industry'))
```

---

## What Does NOT Work

- **Authenticated endpoints** — anything under `linkedin.com/jobs/search` (not the guest API) requires a session cookie
- **Repost detection** — the "Reposted" badge is rendered by JavaScript for logged-in users; the guest API HTML almost never contains it
- **Real-time data** — there is a ~15–30 minute delay between a job being posted and appearing in the guest API
- **More than 125 results** — the guest API caps pagination at `start=100` (5 pages × 25 results)
- **Images / logos** — company logos require authentication

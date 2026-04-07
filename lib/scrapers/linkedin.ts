import { parse } from 'node-html-parser';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, extractJsonLdData } from './utils';

const WORK_TYPE_MAP: Record<string, string> = {
  Remote: '2', Hybrid: '3', 'On-site': '1', Any: '',
};
const EMP_TYPE_MAP: Record<string, string> = {
  'Full-time': 'F', 'Part-time': 'P', Contract: 'C',
};

function linkedInDateParam(days: number): string {
  return days > 0 ? `r${days * 24 * 60 * 60}` : '';
}

async function liGet(url: string): Promise<string> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(4000 * attempt); // back-off on retry
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': randomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-CA,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Referer': 'https://www.linkedin.com/jobs/search/',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`LinkedIn ${res.status}`);
        continue; // retry after back-off
      }
      if (!res.ok) throw new Error(`LinkedIn ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err as Error;
      if (attempt < 2) continue;
    }
  }
  throw lastErr ?? new Error('LinkedIn: request failed');
}

export async function scrapeLinkedIn(filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];

  const tprValue = linkedInDateParam(filters.datePostedDays);
  const params = new URLSearchParams({
    keywords: filters.keywords,
    location: filters.location || 'Toronto, Ontario, Canada',
    start: '0',
    ...(tprValue ? { f_TPR: tprValue } : {}),
    ...(filters.workType !== 'Any' ? { f_WT: WORK_TYPE_MAP[filters.workType] } : {}),
    ...(filters.employmentTypes.length > 0
      ? { f_JT: filters.employmentTypes.map((t) => EMP_TYPE_MAP[t]).filter(Boolean).join(',') }
      : {}),
  });

  type Card = {
    href: string; jobId: string; title: string; company: string;
    location: string; salary: string; benefits: string[];
    isReposted: boolean; dateText: string;
  };

  const allCards: Card[] = [];
  const seenHrefs = new Set<string>();

  // ── Collect cards across 5 pages (up to 125 jobs) ─────────────────────
  for (const start of [0, 25, 50, 75, 100]) {
    params.set('start', String(start));
    const searchUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`;

    let html = '';
    try {
      html = await liGet(searchUrl);
      await sleep(1000 + Math.random() * 500);
    } catch { break; }

    const root = parse(html);
    const items = root.querySelectorAll('li');
    let added = 0;

    for (const li of items) {
      const linkEl = li.querySelector('a[href*="/jobs/view/"]');
      if (!linkEl) continue;

      const rawHref = linkEl.getAttribute('href') ?? '';
      const href = rawHref.split('?')[0];
      if (!href || seenHrefs.has(href)) continue;
      seenHrefs.add(href);

      // LinkedIn now uses slug URLs: /jobs/view/job-title-at-company-4195892764
      // The numeric job ID is the LAST numeric segment at the end of the slug.
      // Also handle legacy plain format: /jobs/view/4195892764
      const jobId =
        href.match(/[/-](\d{8,})\/?$/)?.[1] ??   // slug format (new): ends in -XXXXXXXXXX
        href.match(/\/jobs\/view\/(\d+)/)?.[1] ??  // plain format (old): /view/XXXXXXXXXX
        '';

      const title = (
        li.querySelector('.base-search-card__title')?.textContent ??
        li.querySelector('h3')?.textContent ?? ''
      ).trim();

      const company = (
        li.querySelector('.base-search-card__subtitle')?.textContent ??
        li.querySelector('h4')?.textContent ?? ''
      ).trim();

      const location = li.querySelector('.job-search-card__location')?.textContent?.trim() ?? '';

      // Salary chip — try known classes first, then scan card text for salary-like patterns
      // LinkedIn changes class names frequently; the regex fallback is the safety net
      let salary = (
        li.querySelector('.job-search-card__salary-info') ??
        li.querySelector('[class*="salary"]') ??
        li.querySelector('[class*="compensation"]')
      )?.textContent?.trim() ?? '';

      if (!salary) {
        const SALARY_RE = /(?:CA\$|C\$|\$)[\d,]+(?:\.\d{1,2})?\s*(?:K|k)?(?:\s*[-–—\/]\s*(?:CA\$|C\$|\$)?[\d,]+(?:\.\d{1,2})?\s*(?:K|k)?)?\s*(?:\/hr|\/hour|\/yr|\/year|\bper hour\b|\bper year\b)/i;
        for (const el of li.querySelectorAll('span, div')) {
          const t = (el.textContent ?? '').trim();
          if (t.length < 80 && SALARY_RE.test(t)) { salary = t; break; }
        }
      }

      // Work-type / employment-type benefit pills
      const benefits = li.querySelectorAll(
        '.job-search-card__benefits li, [class*="job-search-card__benefits"] li'
      ).map((el) => el.textContent?.replace(/[✓✔\u2713\u2714]/g, '').trim() ?? '')
        .filter((t) => t.length > 0 && t.length < 60);

      // Date & repost detection.
      // The screenshot shows LinkedIn renders: "Toronto, ON · Reposted 12 hours ago · Over 100 applicants"
      // "Reposted" is a sibling <span> to <time>, not inside it. Three detection layers:
      // 1. listdate container text — catches "Reposted X ago" when it's in the same parent
      // 2. Full li.textContent — search cards have no description, so scanning all text is safe
      //    and catches bold-green, grey-font, and badge variants
      // 3. Class name — catches explicit [class*="repost"] badge elements
      const timeEl = li.querySelector('time');
      const listdateEl = (
        li.querySelector('[class*="listdate"]') ??
        li.querySelector('[class*="list-date"]') ??
        timeEl?.parentNode as typeof timeEl ?? timeEl
      );
      const dateText = listdateEl?.textContent?.trim() || timeEl?.textContent?.trim() ?? '';

      const isReposted =
        /\breposted\b/i.test(dateText) ||
        /\breposted\b/i.test(li.textContent ?? '') ||
        li.querySelector('[class*="repost"]') !== null;

      if (title) {
        allCards.push({ href, jobId, title, company, location, salary, benefits, isReposted, dateText });
        added++;
      }
    }

    if (added === 0) break; // no more pages
  }

  // ── Deep scrape every card's detail page ─────────────────────────────
  // LinkedIn guest API jobPosting endpoint returns full plain-HTML with:
  // - Complete job description (salary ranges, years of experience mentioned in text)
  // - Job criteria section (Employment type, Seniority, Industries)
  // - Apply button (external URL for offsite applications)
  for (const card of allCards) {
    if (!card.title || !card.company) continue;

    let job: Job | null = null;
    if (card.jobId) {
      try {
        await sleep(1200 + Math.random() * 800); // 1.2–2s: paces requests, avoids 429
        job = await scrapeLinkedInDetail(card);
      } catch { /* fall through to card-only */ }
    }

    if (!job) {
      // Card-data fallback — still pass card.salary as explicit hint so parseSalary sees it
      const chipParts = [...card.benefits].filter(Boolean);
      job = buildJobFromRaw({
        title: card.title,
        company: card.company,
        location: card.location,
        description: chipParts.join(' · '),
        datePostedText: card.dateText,
        sourceUrl: card.href,
        source: 'LinkedIn',
        employmentTypeText: card.benefits.join(' '),
        salaryHint: card.salary || undefined,
        applyUrl: null,
        isReposted: card.isReposted,
      });
    }

    jobs.push(job);
  }

  return jobs;
}

async function scrapeLinkedInDetail(card: {
  href: string; jobId: string; title: string; company: string;
  location: string; salary: string; benefits: string[];
  isReposted: boolean; dateText: string;
}): Promise<Job> {
  const detailUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.jobId}`;
  const html = await liGet(detailUrl);
  const root = parse(html);

  // JSON-LD structured data — LinkedIn embeds JobPosting schema with salary + employment type
  const ldData = extractJsonLdData(html);

  // Salary chip on the detail page (separate from the description body)
  // LinkedIn shows this as a styled chip at the top of the posting
  const detailSalaryEl = (
    root.querySelector('.compensation__salary') ??
    root.querySelector('.salary-main-rail__salary') ??
    root.querySelector('[class*="salary-range"]') ??
    root.querySelector('[class*="compensation"]') ??
    root.querySelector('[class*="salary"]')
  );
  // Only use it if it looks like a real salary (has $ and a number)
  const detailSalaryText = detailSalaryEl?.textContent?.trim() ?? '';
  const detailSalary = /\$[\d,]/.test(detailSalaryText) ? detailSalaryText : '';

  // Full description — try specific selectors, fall back to all paragraphs/list items
  let desc = (
    root.querySelector('.description__text') ??
    root.querySelector('.show-more-less-html__markup') ??
    root.querySelector('section.description') ??
    root.querySelector('div.description') ??
    root.querySelector('[class*="description"]')
  )?.textContent?.trim() ?? '';

  // Aggressive fallback: harvest all <p> and <li> content from the page
  if (desc.length < 100) {
    desc = root
      .querySelectorAll('p, li')
      .map((el) => el.textContent?.trim() ?? '')
      .filter((t) => t.length > 25)
      .join('\n');
  }

  // Employment type from job criteria list (fallback if not in JSON-LD)
  let empType = ldData.employmentType ?? '';
  if (!empType) {
    for (const item of root.querySelectorAll('.description__job-criteria-item, [class*="job-criteria-item"]')) {
      const label = item.querySelector('h3')?.textContent?.toLowerCase() ?? '';
      if (label.includes('employment type') || label.includes('job type')) {
        empType = item.querySelector('span')?.textContent?.trim() ?? '';
        break;
      }
    }
  }

  // External apply URL (not Easy Apply which is a <button>)
  let applyUrl: string | null = null;
  for (const sel of ['a.apply-button--offsite', 'a[class*="apply-button"]', 'a.apply-button']) {
    const el = root.querySelector(sel);
    const href = el?.getAttribute('href') ?? '';
    if (href && !href.includes('linkedin.com')) {
      applyUrl = href;
      break;
    }
  }

  // Merge chip data + JSON-LD salary hint into description for parsing
  const chipParts = [card.salary, ...card.benefits].filter(Boolean);
  const fullDescription = [chipParts.join(' · '), desc].filter(Boolean).join('\n\n');
  const empTypeText = empType || card.benefits.join(' ');

  // Detail-page repost check — catches cases where the search card HTML
  // didn't include the "Reposted" label (guest API sometimes omits it).
  // Only scan the first 3000 chars (page header) to avoid false positives
  // from job descriptions that mention the word "reposted".
  const detailIsReposted =
    /\breposted\b/i.test(html.substring(0, 3000)) ||
    root.querySelector('[class*="repost"]') !== null;

  return buildJobFromRaw({
    title: card.title,
    company: card.company,
    location: card.location,
    description: fullDescription,
    datePostedText: card.dateText,
    sourceUrl: card.href,
    source: 'LinkedIn',
    employmentTypeText: empTypeText,
    applyUrl,
    isReposted: card.isReposted || detailIsReposted,
    // Combine all salary signals: JSON-LD > detail page chip > search card chip
    salaryHint: [ldData.salary, detailSalary, card.salary].filter(Boolean).join(' ') || undefined,
    industryHint: ldData.industry ?? null,
  });
}

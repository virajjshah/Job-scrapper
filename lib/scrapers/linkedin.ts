import type { Browser, Page } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

function linkedInDateParam(days: number): string {
  if (days <= 0) return '';
  return `r${days * 24 * 60 * 60}`;
}

const WORK_TYPE_MAP: Record<string, string> = {
  Remote: '2', Hybrid: '3', 'On-site': '1', Any: '',
};
const EMP_TYPE_MAP: Record<string, string> = {
  'Full-time': 'F', 'Part-time': 'P', Contract: 'C',
};

export async function scrapeLinkedIn(browser: Browser, filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({
      'User-Agent': randomUserAgent(),
      'Accept-Language': 'en-CA,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    // ── LinkedIn Guest API ────────────────────────────────────────────────
    // LinkedIn exposes a stable guest search endpoint used by their public
    // embeds. It returns plain HTML (no JS rendering required) with the exact
    // same chip data visible on the public search results page:
    //   • .job-search-card__salary-info  → CA$70K/yr – CA$75K/yr
    //   • .job-search-card__benefits li  → ✓ On-site, ✓ Full-time
    //   • time[class*="listdate"]        → "Reposted 11 hours ago"
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

    // ── Paginate through 3 pages of results (25 each = up to 75 jobs) ──────
    const allCards: Array<{
      href: string; jobId: string; title: string; company: string;
      location: string; salary: string; benefits: string[];
      isReposted: boolean; dateText: string;
    }> = [];
    const seenHrefs = new Set<string>();

    for (const start of [0, 25, 50]) {
      params.set('start', String(start));
      const searchUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`;

      try {
        await withRetry(async () => {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        });
        await sleep(1200 + Math.random() * 600);
      } catch { break; }

    // ── Parse card data from the guest API response ───────────────────────
    const pageCards = await page.evaluate(() => {
      // Guest API returns a bare <ul> of <li> cards — no wrapper divs needed
      const items = Array.from(document.querySelectorAll('li'));

      const seen = new Set<string>();
      const result: Array<{
        href: string; jobId: string; title: string; company: string;
        location: string; salary: string; benefits: string[];
        isReposted: boolean; dateText: string;
      }> = [];

      for (const li of items) {
        // Job link
        const linkEl = li.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement | null;
        if (!linkEl) continue;
        const href = linkEl.href.split('?')[0];
        if (!href || seen.has(href)) continue;
        seen.add(href);

        // Job ID from data-entity-urn="urn:li:jobPosting:3889123456"
        const urnEl = li.querySelector('[data-entity-urn]');
        const jobId = (urnEl?.getAttribute('data-entity-urn') ?? '').replace('urn:li:jobPosting:', '');

        // Card text fields
        const title = li.querySelector('.base-search-card__title, h3')?.textContent?.trim() ?? '';
        const company = li.querySelector('.base-search-card__subtitle, h4')?.textContent?.trim() ?? '';
        const location = li.querySelector('.job-search-card__location')?.textContent?.trim() ?? '';

        // Salary chip — the exact element shown in the UI
        const salary = li.querySelector('.job-search-card__salary-info')?.textContent?.trim() ?? '';

        // Benefit pills — "✓ On-site", "✓ Full-time", "✓ Hybrid" etc.
        const benefits = Array.from(
          li.querySelectorAll(
            '.job-search-card__benefits li, ' +
            '[class*="job-search-card__benefits"] li, ' +
            '[class*="benefit-item"], ' +
            '[class*="job-insight"]'
          )
        )
          .map((el) => el.textContent?.replace(/[✓✔\u2713\u2714]/g, '').trim() ?? '')
          .filter((t) => t.length > 0 && t.length < 60);

        // Date / Reposted
        // LinkedIn uses <time class="job-search-card__listdate--new"> for reposted jobs
        const timeEl = li.querySelector('time');
        const dateText = timeEl?.textContent?.trim() ?? '';
        const isReposted = /\breposted\b/i.test(dateText) || timeEl?.className?.includes('--new') === true;

        result.push({ href, jobId, title, company, location, salary, benefits, isReposted, dateText });
      }

      return result;
    });

      // Accumulate across pages, dedup by href
      for (const c of pageCards) {
        if (!seenHrefs.has(c.href)) {
          seenHrefs.add(c.href);
          allCards.push(c);
        }
      }
      // If we got fewer than 20 results this page, there are no more pages
      if (pageCards.length < 20) break;
    }

    // ── Fetch each job's full detail via the guest detail API ─────────────
    for (const card of allCards) {
      try {
        await sleep(1000 + Math.random() * 700);
        const job = await scrapeLinkedInJobDetail(page, card);
        if (job) jobs.push(job);
      } catch { /* skip */ }
    }
  } finally {
    await page.close();
  }

  return jobs;
}

async function scrapeLinkedInJobDetail(
  page: Page,
  card: {
    href: string;
    jobId: string;
    title: string;
    company: string;
    location: string;
    salary: string;
    benefits: string[];
    isReposted: boolean;
    dateText: string;
  }
): Promise<Job | null> {
  if (!card.title || !card.company) return null;

  let description = '';
  let employmentType = '';
  let applyUrl: string | null = null;

  // Guest detail API — returns full job description HTML without auth
  if (card.jobId) {
    const detailUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.jobId}`;
    try {
      await withRetry(async () => {
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      });

      await sleep(600);

      const detail = await page.evaluate(() => {
        // Full description
        const desc = document.querySelector(
          '.description__text, .show-more-less-html__markup, [class*="description"]'
        )?.textContent?.trim() ?? '';

        // Employment type from job criteria list
        let empType = '';
        for (const item of Array.from(document.querySelectorAll(
          '.description__job-criteria-item, [class*="job-criteria-item"]'
        ))) {
          const label = item.querySelector('h3')?.textContent?.toLowerCase() ?? '';
          if (label.includes('employment type') || label.includes('job type')) {
            empType = item.querySelector('span')?.textContent?.trim() ?? '';
            break;
          }
        }

        // Apply button: <a> tag = external, <button> = Easy Apply
        let apply: string | null = null;
        for (const sel of [
          'a.apply-button--offsite[href]',
          'a[class*="apply-button"][href]',
          'a.apply-button[href]',
        ]) {
          const el = document.querySelector(sel) as HTMLAnchorElement | null;
          if (el?.href && !el.href.includes('linkedin.com')) {
            apply = el.href;
            break;
          }
        }

        return { desc, empType, apply };
      });

      description = detail.desc;
      employmentType = detail.empType;
      applyUrl = detail.apply;
    } catch { /* fall back to card data only */ }
  }

  // Salary chip + benefit tags prepended so parsers see "CA$70K/yr · On-site · Full-time"
  const chipParts = [card.salary, ...card.benefits].filter(Boolean);
  const fullDescription = chipParts.length > 0
    ? `${chipParts.join(' · ')}\n\n${description}`
    : description;

  // Employment type: detail page > benefit chips from card
  const empTypeText = employmentType || card.benefits.join(' ');

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
    isReposted: card.isReposted,
  });
}

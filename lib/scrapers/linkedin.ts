import type { Browser, Page } from 'playwright-core';
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

    const allCards: Array<{
      href: string; jobId: string; title: string; company: string;
      location: string; salary: string; benefits: string[];
      isReposted: boolean; dateText: string;
    }> = [];
    const seenHrefs = new Set<string>();

    // ── 5 pages × 25 = up to 125 cards ─────────────────────────────────
    for (const start of [0, 25, 50, 75, 100]) {
      params.set('start', String(start));
      const searchUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`;

      try {
        await withRetry(async () => {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        });
        await sleep(800 + Math.random() * 400);
      } catch { break; }

      const pageCards = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('li'));
        const seen = new Set<string>();
        const result: Array<{
          href: string; jobId: string; title: string; company: string;
          location: string; salary: string; benefits: string[];
          isReposted: boolean; dateText: string;
        }> = [];

        for (const li of items) {
          const linkEl = li.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement | null;
          if (!linkEl) continue;
          const href = linkEl.href.split('?')[0];
          if (!href || seen.has(href)) continue;
          seen.add(href);

          // Job ID — primary: parse from the URL (always present)
          // fallback: data-entity-urn attribute (not always set in guest API HTML)
          const jobIdFromUrl = href.match(/\/jobs\/view\/(\d+)/)?.[1] ?? '';
          const urnEl = li.querySelector('[data-entity-urn]');
          const jobIdFromUrn = (urnEl?.getAttribute('data-entity-urn') ?? '').replace('urn:li:jobPosting:', '');
          const jobId = jobIdFromUrl || jobIdFromUrn;

          const title = li.querySelector('.base-search-card__title, h3')?.textContent?.trim() ?? '';
          const company = li.querySelector('.base-search-card__subtitle, h4')?.textContent?.trim() ?? '';
          const location = li.querySelector('.job-search-card__location')?.textContent?.trim() ?? '';

          // Salary chip e.g. "CA$70K/yr – CA$90K/yr"
          const salary = li.querySelector('.job-search-card__salary-info')?.textContent?.trim() ?? '';

          // Benefit pills: "✓ On-site", "✓ Full-time" etc.
          const benefits = Array.from(
            li.querySelectorAll(
              '.job-search-card__benefits li, [class*="job-search-card__benefits"] li, ' +
              '[class*="benefit-item"], [class*="job-insight"]'
            )
          )
            .map((el) => el.textContent?.replace(/[✓✔\u2713\u2714]/g, '').trim() ?? '')
            .filter((t) => t.length > 0 && t.length < 60);

          // Repost: check ONLY the <time> element — not full card text (too broad)
          const timeEl = li.querySelector('time');
          const dateText = timeEl?.textContent?.trim() ?? '';
          const isReposted =
            /\breposted\b/i.test(dateText) ||
            timeEl?.className?.includes('--new') === true;

          result.push({ href, jobId, title, company, location, salary, benefits, isReposted, dateText });
        }

        return result;
      });

      let added = 0;
      for (const c of pageCards) {
        if (!seenHrefs.has(c.href)) {
          seenHrefs.add(c.href);
          allCards.push(c);
          added++;
        }
      }
      if (pageCards.length < 15) break;
    }

    // ── Visit detail page for EVERY card ─────────────────────────────────
    // The guest API detail endpoint returns full job description, employment
    // type from the criteria section, and the external apply URL.
    // Card-data is used as fallback if a detail fetch fails.
    for (let i = 0; i < allCards.length; i++) {
      const card = allCards[i];
      if (!card.title || !card.company) continue;

      try {
        await sleep(500 + Math.random() * 300);

        // Always attempt the detail page — jobId from URL is always present now
        const job = await scrapeLinkedInDetail(page, card);
        if (job) { jobs.push(job); continue; }
      } catch { /* detail failed */ }

      // Fallback: card chip data only
      const chipParts = [card.salary, ...card.benefits].filter(Boolean);
      jobs.push(
        buildJobFromRaw({
          title: card.title,
          company: card.company,
          location: card.location || filters.location || 'Toronto, ON',
          description: chipParts.join(' · '),
          datePostedText: card.dateText,
          sourceUrl: card.href,
          source: 'LinkedIn',
          employmentTypeText: card.benefits.join(' '),
          applyUrl: null,
          isReposted: card.isReposted,
        })
      );
    }
  } finally {
    await page.close();
  }

  return jobs;
}

async function scrapeLinkedInDetail(
  page: Page,
  card: {
    href: string; jobId: string; title: string; company: string;
    location: string; salary: string; benefits: string[];
    isReposted: boolean; dateText: string;
  }
): Promise<Job | null> {
  // jobId must be numeric — extract from URL as final guarantee
  const resolvedJobId = card.jobId || card.href.match(/\/jobs\/view\/(\d+)/)?.[1] || '';
  if (!resolvedJobId) return null;

  const detailUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${resolvedJobId}`;

  await withRetry(async () => {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  await sleep(500);

  const detail = await page.evaluate(() => {
    const desc =
      document.querySelector('.description__text, .show-more-less-html__markup, [class*="description"]')
        ?.textContent?.trim() ?? '';

    let empType = '';
    for (const item of Array.from(
      document.querySelectorAll('.description__job-criteria-item, [class*="job-criteria-item"]')
    )) {
      const label = item.querySelector('h3')?.textContent?.toLowerCase() ?? '';
      if (label.includes('employment type') || label.includes('job type')) {
        empType = item.querySelector('span')?.textContent?.trim() ?? '';
        break;
      }
    }

    // External apply link (<a> = offsite, <button> = Easy Apply — no href)
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

  // Merge: salary chip + benefit chips + full description
  const chipParts = [card.salary, ...card.benefits].filter(Boolean);
  const fullDescription = [chipParts.join(' · '), detail.desc].filter(Boolean).join('\n\n');
  const empTypeText = detail.empType || card.benefits.join(' ');

  return buildJobFromRaw({
    title: card.title,
    company: card.company,
    location: card.location,
    description: fullDescription,
    datePostedText: card.dateText,
    sourceUrl: card.href,
    source: 'LinkedIn',
    employmentTypeText: empTypeText,
    applyUrl: detail.apply,
    isReposted: card.isReposted,
  });
}

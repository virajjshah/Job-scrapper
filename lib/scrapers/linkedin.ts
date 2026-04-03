import type { Browser } from 'playwright';
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
      href: string; title: string; company: string;
      location: string; salary: string; benefits: string[];
      isReposted: boolean; dateText: string;
    }> = [];
    const seenHrefs = new Set<string>();

    // ── Paginate 5 pages × 25 = up to 125 cards ──────────────────────────
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
          href: string; title: string; company: string;
          location: string; salary: string; benefits: string[];
          isReposted: boolean; dateText: string;
        }> = [];

        for (const li of items) {
          const linkEl = li.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement | null;
          if (!linkEl) continue;
          const href = linkEl.href.split('?')[0];
          if (!href || seen.has(href)) continue;
          seen.add(href);

          const title =
            li.querySelector('.base-search-card__title, h3')?.textContent?.trim() ?? '';
          const company =
            li.querySelector('.base-search-card__subtitle, h4')?.textContent?.trim() ?? '';
          const location =
            li.querySelector('.job-search-card__location')?.textContent?.trim() ?? '';

          // Salary chip (e.g. "CA$70K/yr – CA$90K/yr")
          const salary =
            li.querySelector('.job-search-card__salary-info')?.textContent?.trim() ?? '';

          // Benefit/work-type pills (e.g. "✓ On-site", "✓ Full-time")
          const benefits = Array.from(
            li.querySelectorAll(
              '.job-search-card__benefits li, ' +
              '[class*="job-search-card__benefits"] li, ' +
              '[class*="benefit-item"], [class*="job-insight"]'
            )
          )
            .map((el) => el.textContent?.replace(/[✓✔\u2713\u2714]/g, '').trim() ?? '')
            .filter((t) => t.length > 0 && t.length < 60);

          // Date + repost detection: check time element AND full card text
          const timeEl = li.querySelector('time');
          const dateText = timeEl?.textContent?.trim() ?? '';
          const isReposted =
            /\breposted\b/i.test(dateText) ||
            timeEl?.className?.includes('--new') === true ||
            /\breposted\b/i.test(li.textContent ?? '');

          result.push({ href, title, company, location, salary, benefits, isReposted, dateText });
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
      if (pageCards.length < 15) break; // last page reached
    }

    // ── Build jobs directly from card data ────────────────────────────────
    // We intentionally skip per-job detail page visits: the card already has
    // salary chip, benefit pills (work-type, employment-type), date, and repost
    // status. Visiting 75-125 detail pages would add 2-3 minutes and cause
    // rate-limiting timeouts before most cards are processed.
    for (const card of allCards) {
      if (!card.title || !card.company) continue;

      // Combine salary chip + benefit pills into description so parsers see them
      const chipParts = [card.salary, ...card.benefits].filter(Boolean);
      const description = chipParts.join(' · ');

      jobs.push(
        buildJobFromRaw({
          title: card.title,
          company: card.company,
          location: card.location || filters.location || 'Toronto, ON',
          description,
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

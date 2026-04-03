import type { Browser, Page } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

function indeedDateParam(days: number): string {
  if (days <= 0) return '';
  return String(Math.min(days, 14));
}

export async function scrapeIndeed(browser: Browser, filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({
      'User-Agent': randomUserAgent(),
      'Accept-Language': 'en-CA,en;q=0.9',
    });

    const fromage = indeedDateParam(filters.datePostedDays);
    const baseParams = new URLSearchParams({
      q: filters.keywords,
      l: filters.location || 'Toronto, ON',
      ...(fromage ? { fromage } : {}),
    });

    if (filters.workType === 'Remote') {
      baseParams.set('remotejob', '032b3046-06a3-4876-8dfd-474eb5e7ed11');
    }

    // ── Paginate: 2 pages of results (~15 cards each = ~30 jobs) ─────────
    const allCards: Array<{
      title: string; href: string; company: string;
      location: string; datePosted: string; salary: string; isReposted: boolean;
    }> = [];
    const seenHrefs = new Set<string>();

    for (const start of [0, 15, 30]) {
      baseParams.set('start', String(start));
      const searchUrl = `https://ca.indeed.com/jobs?${baseParams}`;

      try {
        await withRetry(async () => {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        });
        await sleep(1800 + Math.random() * 800);
      } catch { break; }

      const pageCards = await page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll('[class*="job_seen_beacon"], .result, [data-jk]')
        );
        return cards.map((card) => {
          const titleEl = card.querySelector('h2 a, .jobTitle a, [class*="JobTitle"] a');
          const title = titleEl?.textContent?.trim() ?? '';
          const href = (titleEl as HTMLAnchorElement)?.href ?? '';
          const company =
            card.querySelector('[class*="companyName"], .companyName')?.textContent?.trim() ?? '';
          const location =
            card.querySelector('[class*="companyLocation"], .companyLocation')?.textContent?.trim() ?? '';
          const datePosted =
            card.querySelector('[class*="date"], .date')?.textContent?.trim() ?? '';
          const salary =
            card.querySelector('[class*="salary"], .salary-snippet')?.textContent?.trim() ?? '';
          const isReposted = /\breposted\b/i.test(card.textContent ?? '');
          return { title, href, company, location, datePosted, salary, isReposted };
        });
      });

      let added = 0;
      for (const c of pageCards) {
        if (c.href && !seenHrefs.has(c.href)) {
          seenHrefs.add(c.href);
          allCards.push(c);
          added++;
        }
      }
      if (added < 5) break; // no more results
    }

    for (const card of allCards) {
      if (!card.title || !card.href) continue;
      try {
        await sleep(1000 + Math.random() * 700);
        const job = await scrapeIndeedJob(page, card.href, {
          title: card.title,
          company: card.company,
          location: card.location,
          datePosted: card.datePosted,
          salaryHint: card.salary,
          isReposted: card.isReposted,
        });
        if (job) jobs.push(job);
      } catch { /* skip */ }
    }
  } finally {
    await page.close();
  }

  return jobs;
}

async function scrapeIndeedJob(
  page: Page,
  url: string,
  fallback: {
    title: string; company: string; location: string;
    datePosted: string; salaryHint: string; isReposted: boolean;
  }
): Promise<Job | null> {
  try {
    await withRetry(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    });

    await sleep(800);

    const data = await page.evaluate(() => {
      const description =
        document.querySelector('#jobDescriptionText, [class*="jobDescriptionText"]')?.textContent?.trim() ?? '';
      const salary =
        document.querySelector('[class*="salary"], [id*="salaryInfoAndJobType"]')?.textContent?.trim() ?? '';

      let employmentType =
        document.querySelector(
          '[class*="jobType"], [id*="jobType"], [data-testid*="jobType"], [class*="EmploymentType"]'
        )?.textContent?.trim() ?? '';
      if (!employmentType) {
        const chips = Array.from(document.querySelectorAll(
          '[data-testid="attribute_snippet_testid"], [class*="metadata"] span'
        ));
        for (const c of chips) {
          const t = c.textContent?.toLowerCase() ?? '';
          if (t.includes('full-time') || t.includes('part-time') || t.includes('contract') || t.includes('permanent')) {
            employmentType = c.textContent?.trim() ?? '';
            break;
          }
        }
      }

      const applyBtn = document.querySelector(
        'a[id*="indeedApplyButton"], a[class*="ApplyButton"], a[data-jk][href*="apply"]'
      ) as HTMLAnchorElement | null;
      const applyUrl = applyBtn?.href ?? null;
      const isReposted = /\breposted\b/i.test(document.body.innerText ?? '');
      return { description, salary, employmentType, applyUrl, isReposted };
    });

    return buildJobFromRaw({
      title: fallback.title,
      company: fallback.company,
      location: fallback.location,
      description: `${data.salary} ${fallback.salaryHint} ${data.description}`.trim(),
      datePostedText: fallback.datePosted,
      sourceUrl: url,
      source: 'Indeed',
      employmentTypeText: data.employmentType,
      applyUrl: data.applyUrl,
      isReposted: fallback.isReposted || data.isReposted,
    });
  } catch {
    return buildJobFromRaw({
      title: fallback.title,
      company: fallback.company,
      location: fallback.location,
      description: fallback.salaryHint,
      datePostedText: fallback.datePosted,
      sourceUrl: url,
      source: 'Indeed',
      isReposted: fallback.isReposted,
    });
  }
}

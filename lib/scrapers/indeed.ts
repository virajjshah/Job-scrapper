import type { Browser, Page } from 'playwright-core';
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

    // ── Paginate: 4 pages × ~15 results = up to ~60 cards ────────────────
    const allCards: Array<{
      title: string; href: string; company: string;
      location: string; datePosted: string; salary: string; isReposted: boolean;
    }> = [];
    const seenHrefs = new Set<string>();

    for (const start of [0, 15, 30, 45]) {
      baseParams.set('start', String(start));
      const searchUrl = `https://ca.indeed.com/jobs?${baseParams}`;

      try {
        await withRetry(async () => {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        });
        await sleep(2000 + Math.random() * 1000);
      } catch { break; }

      const pageCards = await page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll('[class*="job_seen_beacon"], .result, [data-jk], [class*="resultContent"]')
        );
        return cards.map((card) => {
          const titleEl = card.querySelector('h2 a, .jobTitle a, [class*="JobTitle"] a, a[class*="jcs-JobTitle"]');
          const title = titleEl?.textContent?.trim() ?? '';
          const href = (titleEl as HTMLAnchorElement)?.href ?? '';
          const company =
            card.querySelector('[class*="companyName"], .companyName, [data-testid="company-name"]')?.textContent?.trim() ?? '';
          const location =
            card.querySelector('[class*="companyLocation"], .companyLocation, [data-testid="text-location"]')?.textContent?.trim() ?? '';
          const datePosted =
            card.querySelector('[class*="date"], .date, [data-testid="myJobsStateDate"]')?.textContent?.trim() ?? '';
          const salary =
            card.querySelector('[class*="salary"], .salary-snippet, [class*="salaryText"], [data-testid="attribute_snippet_testid"]')?.textContent?.trim() ?? '';
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
      if (added < 3) break; // no more results
    }

    // ── Visit EVERY job detail page ───────────────────────────────────────
    for (const card of allCards) {
      if (!card.title || !card.href) continue;
      try {
        await sleep(800 + Math.random() * 500);
        const job = await scrapeIndeedJob(page, card.href, {
          title: card.title,
          company: card.company,
          location: card.location,
          datePosted: card.datePosted,
          salaryHint: card.salary,
          isReposted: card.isReposted,
        });
        if (job) jobs.push(job);
      } catch {
        // Fallback: build from card data if detail page failed
        jobs.push(
          buildJobFromRaw({
            title: card.title,
            company: card.company,
            location: card.location || filters.location || 'Toronto, ON',
            description: card.salary,
            datePostedText: card.datePosted,
            sourceUrl: card.href,
            source: 'Indeed',
            isReposted: card.isReposted,
          })
        );
      }
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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    });
    await sleep(1000);

    const data = await page.evaluate(() => {
      // Full job description
      const description =
        document.querySelector('#jobDescriptionText, [class*="jobDescriptionText"], [class*="jobsearch-JobComponent-description"]')
          ?.textContent?.trim() ?? '';

      // Salary from detail page
      const salary =
        document.querySelector('[class*="salary"], [id*="salaryInfoAndJobType"], [class*="salaryText"]')
          ?.textContent?.trim() ?? '';

      // Employment type from chips/metadata
      let employmentType =
        document.querySelector(
          '[class*="jobType"], [id*="jobType"], [data-testid*="jobType"], [class*="EmploymentType"]'
        )?.textContent?.trim() ?? '';

      if (!employmentType) {
        const chips = Array.from(document.querySelectorAll(
          '[data-testid="attribute_snippet_testid"], [class*="metadata"] span, [class*="jobMetaData"] span'
        ));
        for (const c of chips) {
          const t = c.textContent?.toLowerCase() ?? '';
          if (t.includes('full-time') || t.includes('part-time') || t.includes('contract') || t.includes('permanent')) {
            employmentType = c.textContent?.trim() ?? '';
            break;
          }
        }
      }

      // Apply URL
      const applyBtn = document.querySelector(
        'a[id*="indeedApplyButton"], a[class*="ApplyButton"], a[data-jk][href*="apply"], a[href*="apply"]'
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

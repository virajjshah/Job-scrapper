import type { Browser, Page } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

/** Indeed "fromage" param = number of days */
function indeedDateParam(days: number): string {
  if (days <= 0) return '';
  // Indeed uses fromage=N where N is number of days; cap at 14 (their max bucket)
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
    const params = new URLSearchParams({
      q: filters.keywords,
      l: filters.location || 'Toronto, ON',
      ...(fromage ? { fromage } : {}),
    });

    if (filters.workType === 'Remote') {
      params.set('remotejob', '032b3046-06a3-4876-8dfd-474eb5e7ed11');
    }

    const searchUrl = `https://ca.indeed.com/jobs?${params.toString()}`;

    await withRetry(async () => {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    });

    await sleep(2000 + Math.random() * 1000);

    const jobCards = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('[class*="job_seen_beacon"], .result, [data-jk]')
      );
      return cards.slice(0, 25).map((card) => {
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
        // Indeed sometimes shows "Reposted" near the date
        const isReposted = /\breposted\b/i.test(card.textContent ?? '');
        return { title, href, company, location, datePosted, salary, isReposted };
      });
    });

    for (const card of jobCards) {
      if (!card.title || !card.href) continue;
      try {
        await sleep(1200 + Math.random() * 800);
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
        // Skip individual job errors
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
    title: string;
    company: string;
    location: string;
    datePosted: string;
    salaryHint: string;
    isReposted: boolean;
  }
): Promise<Job | null> {
  try {
    await withRetry(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    });

    await sleep(1000);

    const data = await page.evaluate(() => {
      const description =
        document.querySelector('#jobDescriptionText, [class*="jobDescriptionText"]')?.textContent?.trim() ?? '';
      const salary =
        document.querySelector('[class*="salary"], [id*="salaryInfoAndJobType"]')?.textContent?.trim() ?? '';
      const employmentType =
        document.querySelector('[class*="jobType"], [id*="jobType"]')?.textContent?.trim() ?? '';
      // External apply link on the Indeed page
      const applyBtn = document.querySelector(
        'a[id*="indeedApplyButton"], a[class*="ApplyButton"], a[data-jk][href*="apply"]'
      ) as HTMLAnchorElement | null;
      const applyUrl = applyBtn?.href ?? null;
      const isReposted = /\breposted\b/i.test(document.body.innerText?.slice(0, 1000) ?? '');
      return { description, salary, employmentType, applyUrl, isReposted };
    });

    const descriptionWithSalary = `${data.salary} ${fallback.salaryHint} ${data.description}`.trim();

    return buildJobFromRaw({
      title: fallback.title,
      company: fallback.company,
      location: fallback.location,
      description: descriptionWithSalary,
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

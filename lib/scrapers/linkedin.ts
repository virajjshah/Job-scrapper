import type { Browser, Page } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

const DATE_FILTER_MAP: Record<SearchFilters['datePosted'], string> = {
  'Past 24h': 'r86400',
  'Past week': 'r604800',
  'Past month': 'r2592000',
  'Any time': '',
};

const WORK_TYPE_MAP: Record<string, string> = {
  Remote: '2',
  Hybrid: '3',
  'On-site': '1',
  Any: '',
};

const EMP_TYPE_MAP: Record<string, string> = {
  'Full-time': 'F',
  'Part-time': 'P',
  Contract: 'C',
};

export async function scrapeLinkedIn(browser: Browser, filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({
      'User-Agent': randomUserAgent(),
      'Accept-Language': 'en-CA,en;q=0.9',
    });

    const params = new URLSearchParams({
      keywords: filters.keywords,
      location: filters.location || 'Toronto, Ontario, Canada',
      ...(DATE_FILTER_MAP[filters.datePosted] ? { f_TPR: DATE_FILTER_MAP[filters.datePosted] } : {}),
      ...(filters.workType !== 'Any' ? { f_WT: WORK_TYPE_MAP[filters.workType] } : {}),
      ...(filters.employmentTypes.length > 0
        ? { f_JT: filters.employmentTypes.map((t) => EMP_TYPE_MAP[t]).filter(Boolean).join('%2C') }
        : {}),
    });

    const searchUrl = `https://www.linkedin.com/jobs/search/?${params.toString()}`;

    await withRetry(async () => {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    });

    await sleep(2000 + Math.random() * 1000);

    // Collect job card links from the search results page
    const jobLinks = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('a[href*="/jobs/view/"]'));
      const seen = new Set<string>();
      const links: string[] = [];
      for (const a of cards) {
        const href = (a as HTMLAnchorElement).href.split('?')[0];
        if (href && !seen.has(href)) {
          seen.add(href);
          links.push(href);
        }
      }
      return links.slice(0, 25);
    });

    for (const link of jobLinks) {
      try {
        await sleep(1200 + Math.random() * 800);
        const job = await scrapeLinkedInJob(page, link);
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

async function scrapeLinkedInJob(page: Page, url: string): Promise<Job | null> {
  await withRetry(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  await sleep(1000);

  const data = await page.evaluate(() => {
    const title = document.querySelector('h1.top-card-layout__title, h1[class*="job-title"]')?.textContent?.trim() ?? '';
    const company = document.querySelector('a.topcard__org-name-link, [class*="company-name"]')?.textContent?.trim() ?? '';
    const location = document.querySelector('.topcard__flavor--bullet, [class*="job-location"]')?.textContent?.trim() ?? '';
    const datePosted = document.querySelector('[class*="posted-time"], time')?.textContent?.trim() ?? '';

    // Expand description if possible
    const showMoreBtn = document.querySelector('button[aria-label*="more"], button.show-more-less-html__button');
    if (showMoreBtn) (showMoreBtn as HTMLButtonElement).click();

    const description = document.querySelector('.description__text, [class*="job-description"]')?.textContent?.trim() ?? '';
    const employmentType = document.querySelector('[class*="employment-type"] span')?.textContent?.trim() ?? '';

    return { title, company, location, datePosted, description, employmentType };
  });

  if (!data.title || !data.company) return null;

  return buildJobFromRaw({
    title: data.title,
    company: data.company,
    location: data.location,
    description: data.description,
    datePostedText: data.datePosted,
    sourceUrl: url,
    source: 'LinkedIn',
    employmentTypeText: data.employmentType,
  });
}

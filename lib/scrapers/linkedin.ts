import type { Browser, Page } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

/** Map datePostedDays → LinkedIn f_TPR value (seconds) */
function linkedInDateParam(days: number): string {
  if (days <= 0) return '';
  const seconds = days * 24 * 60 * 60;
  return `r${seconds}`;
}

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

    const tprValue = linkedInDateParam(filters.datePostedDays);
    const params = new URLSearchParams({
      keywords: filters.keywords,
      location: filters.location || 'Toronto, Ontario, Canada',
      ...(tprValue ? { f_TPR: tprValue } : {}),
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
    const title =
      document.querySelector('h1.top-card-layout__title, h1[class*="job-title"]')?.textContent?.trim() ?? '';
    const company =
      document.querySelector('a.topcard__org-name-link, [class*="company-name"]')?.textContent?.trim() ?? '';
    const location =
      document.querySelector('.topcard__flavor--bullet, [class*="job-location"]')?.textContent?.trim() ?? '';
    const datePostedEl = document.querySelector('[class*="posted-time"], time');
    const datePosted = datePostedEl?.textContent?.trim() ?? '';

    // "Reposted" label appears near the posted-time element or in a badge
    const pageText = document.body.innerText ?? '';
    const isReposted = /\breposted\b/i.test(pageText.slice(0, 2000));

    // Expand description
    const showMoreBtn = document.querySelector(
      'button[aria-label*="more"], button.show-more-less-html__button'
    );
    if (showMoreBtn) (showMoreBtn as HTMLButtonElement).click();

    const description =
      document.querySelector('.description__text, [class*="job-description"]')?.textContent?.trim() ?? '';
    const employmentType =
      document.querySelector('[class*="employment-type"] span')?.textContent?.trim() ?? '';

    // Extract external apply URL — LinkedIn offsite apply button
    const applyBtn = document.querySelector(
      'a[data-tracking-control-name*="apply"], ' +
      'a[href*="apply"]:not([href*="linkedin.com"]), ' +
      '.apply-button--link[href], ' +
      'a.topcard__link[href*="apply"]'
    ) as HTMLAnchorElement | null;
    const applyUrl = applyBtn?.href ?? null;

    return { title, company, location, datePosted, description, employmentType, applyUrl, isReposted };
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
    applyUrl: data.applyUrl,
    isReposted: data.isReposted,
  });
}

import type { Browser, Page } from 'playwright';
import type { Job } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

/**
 * Generic scraper for user-supplied career page URLs.
 * Attempts a best-effort extraction using common patterns.
 */
export async function scrapeCustomUrl(browser: Browser, url: string): Promise<Job[]> {
  const jobs: Job[] = [];
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({
      'User-Agent': randomUserAgent(),
      'Accept-Language': 'en-CA,en;q=0.9',
    });

    await withRetry(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    });

    await sleep(2000);

    // Collect all job-like links on the page
    const jobLinks = await page.evaluate(() => {
      const keywords = ['job', 'career', 'position', 'opening', 'vacancy', 'role', 'apply'];
      const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const seen = new Set<string>();
      const links: string[] = [];

      for (const a of anchors) {
        const href = a.href;
        const text = a.textContent?.toLowerCase() ?? '';
        if (
          href &&
          !seen.has(href) &&
          keywords.some((k) => href.toLowerCase().includes(k) || text.includes(k))
        ) {
          seen.add(href);
          links.push(href);
        }
      }
      return links.slice(0, 20);
    });

    if (jobLinks.length === 0) {
      // Attempt to extract job info directly from this page
      const job = await extractJobFromPage(page, url);
      if (job) jobs.push(job);
    } else {
      for (const link of jobLinks) {
        try {
          await sleep(1500 + Math.random() * 500);
          const job = await extractJobFromPage(page, link);
          if (job) jobs.push(job);
        } catch {
          // Skip
        }
      }
    }
  } finally {
    await page.close();
  }

  return jobs;
}

async function extractJobFromPage(page: Page, url: string): Promise<Job | null> {
  if (page.url() !== url) {
    await withRetry(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    });
    await sleep(1000);
  }

  const data = await page.evaluate(() => {
    // Try multiple common selectors for job titles
    const titleSelectors = [
      'h1[class*="job"]', 'h1[class*="title"]', 'h1[class*="position"]',
      '.job-title', '.position-title', '[data-testid*="title"]',
      'h1', 'h2',
    ];
    let title = '';
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) {
        title = el.textContent.trim();
        break;
      }
    }

    // Company from meta or page title
    const pageHostname = new URL(window.location.href).hostname.replace('www.', '').split('.')[0];
    const company =
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ??
      document.querySelector('[class*="company"], [class*="employer"]')?.textContent?.trim() ??
      pageHostname;

    const location =
      document.querySelector('[class*="location"], [itemprop="jobLocation"]')?.textContent?.trim() ??
      document.querySelector('[class*="city"]')?.textContent?.trim() ??
      '';

    const description = document.querySelector(
      '[class*="description"], [class*="job-desc"], [class*="details"], main, article'
    )?.textContent?.trim() ?? document.body.textContent?.trim() ?? '';

    const datePosted =
      document.querySelector('[class*="date"], [datetime], time')?.getAttribute('datetime') ??
      document.querySelector('[class*="date"], time')?.textContent?.trim() ??
      '';

    return { title, company, location, description: description.slice(0, 3000), datePosted };
  });

  if (!data.title || data.title.length < 2) return null;

  return buildJobFromRaw({
    title: data.title,
    company: data.company || new URL(url).hostname,
    location: data.location,
    description: data.description,
    datePostedText: data.datePosted,
    sourceUrl: url,
    source: 'Custom',
  });
}

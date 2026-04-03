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

  await sleep(1500);

  // Click "Show more" to expand description before extracting
  await page.evaluate(() => {
    const btn = document.querySelector(
      'button[aria-label*="more"], button.show-more-less-html__button, button[aria-label*="Show more"]'
    ) as HTMLButtonElement | null;
    if (btn) btn.click();
  });

  await sleep(600);

  const data = await page.evaluate(() => {
    // ── Title ──────────────────────────────────────────────────────────────
    const title =
      document.querySelector(
        'h1.top-card-layout__title, h1[class*="job-title"], h1[class*="JobTitle"]'
      )?.textContent?.trim() ?? '';

    // ── Company ────────────────────────────────────────────────────────────
    const company =
      document.querySelector(
        'a.topcard__org-name-link, [class*="company-name"], [class*="CompanyName"]'
      )?.textContent?.trim() ?? '';

    // ── Location ───────────────────────────────────────────────────────────
    const location =
      document.querySelector(
        '.topcard__flavor--bullet, [class*="job-location"], [class*="JobLocation"]'
      )?.textContent?.trim() ?? '';

    // ── Date posted ────────────────────────────────────────────────────────
    const datePostedEl = document.querySelector('[class*="posted-time"], time, [class*="PostedDate"]');
    const datePosted = datePostedEl?.textContent?.trim() ?? '';

    // ── Reposted ───────────────────────────────────────────────────────────
    // LinkedIn shows "Reposted" as a text badge – scan the full page body.
    // We check the entire innerText so the badge isn't cut off by a slice.
    const pageText = (document.body.innerText ?? '').toLowerCase();
    const isReposted = pageText.includes('reposted');

    // ── Description ────────────────────────────────────────────────────────
    const description =
      document.querySelector(
        '.description__text, [class*="job-description"], [class*="JobDescription"], #job-details'
      )?.textContent?.trim() ?? '';

    // ── Employment type ────────────────────────────────────────────────────
    // LinkedIn renders job criteria as a list: <h3> label + <span> value.
    // We iterate all criteria items and find the one labelled "Employment type".
    let employmentType = '';
    const criteriaItems = Array.from(
      document.querySelectorAll(
        'li.description__job-criteria-item, [class*="job-criteria-item"], [class*="JobCriteria"] li'
      )
    );
    for (const item of criteriaItems) {
      const header = item.querySelector('h3, [class*="subheader"], [class*="label"]')?.textContent?.toLowerCase() ?? '';
      if (header.includes('employment type') || header.includes('job type')) {
        employmentType = item.querySelector('span, [class*="text"]')?.textContent?.trim() ?? '';
        break;
      }
    }
    // Fallback selectors if structured criteria not found
    if (!employmentType) {
      employmentType =
        document.querySelector(
          '[class*="employment-type"] span, [data-test*="employmentType"], [class*="EmploymentType"]'
        )?.textContent?.trim() ?? '';
    }

    // ── Apply URL ──────────────────────────────────────────────────────────
    // 1. Try JSON-LD JobPosting schema first – sometimes has direct URL
    let applyUrl: string | null = null;
    try {
      const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of ldScripts) {
        const json = JSON.parse(s.textContent ?? '{}');
        // directApply jobs have applicationContact or apply URL
        const candidate =
          json.apply?.url ??
          json.applicationContact?.url ??
          (json.url && !json.url.includes('linkedin.com') ? json.url : null);
        if (candidate) { applyUrl = candidate; break; }
      }
    } catch { /* ignore */ }

    // 2. Look for offsite apply button – href must NOT be a linkedin.com URL
    if (!applyUrl) {
      const applySelectors = [
        'a.apply-button--offsite',
        'a[data-tracking-control-name*="offsite_apply"]',
        'a[data-tracking-control-name*="apply"][href]:not([href*="linkedin.com"])',
        // The "Apply on company website" link
        'a[class*="apply"][href]:not([href*="linkedin.com"])',
        '.apply-button[href]:not([href*="linkedin.com"])',
      ];
      for (const sel of applySelectors) {
        const el = document.querySelector(sel) as HTMLAnchorElement | null;
        if (el?.href && !el.href.includes('linkedin.com')) {
          applyUrl = el.href;
          break;
        }
      }
    }

    // 3. Scan all <a> tags on the page for non-LinkedIn apply links as last resort
    if (!applyUrl) {
      const allLinks = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const candidate = allLinks.find(
        (a) =>
          !a.href.includes('linkedin.com') &&
          /apply|careers?|jobs?|position/i.test(a.href) &&
          a.href.startsWith('http')
      );
      if (candidate) applyUrl = candidate.href;
    }

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

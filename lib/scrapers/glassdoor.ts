import type { Browser, Page } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

// Glassdoor city IDs for Canadian cities
const CITY_IDS: Record<string, string> = {
  default: '2281069',    // Toronto
  toronto: '2281069',
  mississauga: '2281070',
  brampton: '2281066',
  markham: '2281071',
  vaughan: '2281075',
  oakville: '2281072',
  hamilton: '2281068',
};

function getCityId(location: string): string {
  const lower = location.toLowerCase();
  for (const [city, id] of Object.entries(CITY_IDS)) {
    if (city !== 'default' && lower.includes(city)) return id;
  }
  return CITY_IDS.default;
}

/**
 * Build Glassdoor's canonical SSR job search URL.
 * This format is server-side rendered (used for SEO/Google indexing)
 * so it returns actual HTML job cards without needing JavaScript.
 *
 * Format: /Job/{city}-{keyword}-jobs-SRCH_IL.0,{cityLen}_IC{cityId}_KO{kwStart},{kwEnd}.htm
 */
function glassdoorSearchUrl(keyword: string, location: string, pageNum = 1): string {
  const city = (location.split(',')[0] || 'toronto')
    .toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const kw = keyword
    .toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const cityId = getCityId(location);
  const cityLen = city.length;
  const kwStart = cityLen + 1;
  const kwEnd = kwStart + kw.length;
  const pageParam = pageNum > 1 ? `_IP${pageNum}` : '';
  return (
    `https://www.glassdoor.ca/Job/${city}-${kw}-jobs-SRCH_IL.0,${cityLen}` +
    `_IC${cityId}_KO${kwStart},${kwEnd}${pageParam}.htm`
  );
}

export async function scrapeGlassdoor(browser: Browser, filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({
      'User-Agent': randomUserAgent(),
      'Accept-Language': 'en-CA,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    const allCards: Array<{
      title: string; href: string; company: string;
      location: string; salary: string; datePosted: string; isReposted: boolean;
    }> = [];
    const seenHrefs = new Set<string>();

    // ── 2 pages of results ─────────────────────────────────────────────
    for (const pageNum of [1, 2]) {
      const searchUrl = glassdoorSearchUrl(filters.keywords, filters.location || 'Toronto', pageNum);

      try {
        await withRetry(async () => {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        });
        await sleep(2000 + Math.random() * 1000);
      } catch { break; }

      // Dismiss login wall / modal
      await page.evaluate(() => {
        document.querySelectorAll(
          '[class*="modal"], [class*="Modal"], [class*="LoginModal"], ' +
          '[class*="overlay"], [class*="Overlay"]'
        ).forEach((el) => { (el as HTMLElement).style.display = 'none'; });
      });

      const pageCards = await page.evaluate(() => {
        // Glassdoor SSR page renders job cards into these containers
        const cards = Array.from(document.querySelectorAll(
          '[data-test="jobListing"], ' +
          'li[class*="react-job-listing"], ' +
          'article[class*="JobCard"], ' +
          '[class*="JobsList"] li, ' +
          'li[class*="JobCard"]'
        ));

        return cards.map((card) => {
          const titleEl = card.querySelector(
            '[data-test="job-link"], a[class*="jobLink"], a[class*="JobCard"], ' +
            'a[data-test="job-title"], a[class*="jobTitle"]'
          ) as HTMLAnchorElement | null;
          const title = titleEl?.textContent?.trim() ?? '';
          const href = titleEl?.href ?? '';

          const company =
            card.querySelector(
              '[class*="EmployerProfile__name"], [data-test="employer-name"], ' +
              '[class*="employer-name"], [class*="companyName"]'
            )?.textContent?.trim() ?? '';

          const location =
            card.querySelector(
              '[data-test="emp-location"], [class*="location"], [class*="Location"]'
            )?.textContent?.trim() ?? '';

          const salary =
            card.querySelector(
              '[data-test="detailSalary"], [class*="salary"], [class*="Salary"]'
            )?.textContent?.trim() ?? '';

          const datePosted =
            card.querySelector(
              '[data-test="listing-age"], [class*="listing-age"], ' +
              '[class*="jobAge"], time'
            )?.textContent?.trim() ?? '';

          const isReposted = /\breposted\b/i.test(card.textContent ?? '');

          return { title, href, company, location, salary, datePosted, isReposted };
        });
      });

      let added = 0;
      for (const c of pageCards) {
        if (c.title && c.href && !seenHrefs.has(c.href)) {
          seenHrefs.add(c.href);
          allCards.push(c);
          added++;
        }
      }
      if (added < 3) break;
    }

    for (const card of allCards) {
      try {
        await sleep(1200 + Math.random() * 800);
        const fullUrl = card.href.startsWith('http')
          ? card.href
          : `https://www.glassdoor.ca${card.href}`;
        const job = await scrapeGlassdoorJob(page, fullUrl, card);
        if (job) jobs.push(job);
      } catch { /* skip */ }
    }
  } finally {
    await page.close();
  }

  return jobs;
}

async function scrapeGlassdoorJob(
  page: Page,
  url: string,
  fallback: {
    title: string; company: string; location: string;
    datePosted: string; salary: string; isReposted: boolean;
  }
): Promise<Job | null> {
  try {
    await withRetry(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    });
    await sleep(800);

    await page.evaluate(() => {
      document.querySelectorAll('[class*="modal"], [class*="Modal"], [class*="LoginModal"]')
        .forEach((el) => { (el as HTMLElement).style.display = 'none'; });
    });

    const data = await page.evaluate(() => {
      const description =
        document.querySelector(
          '[class*="JobDetails"], [data-test="job-description"], .desc, [class*="jobDescription"]'
        )?.textContent?.trim() ?? '';

      const salary =
        document.querySelector('[data-test="salaryEstimate"], [class*="salary"]')
          ?.textContent?.trim() ?? '';

      let empType =
        document.querySelector(
          '[data-test="job-type"], [class*="jobType"], [class*="EmploymentType"]'
        )?.textContent?.trim() ?? '';
      if (!empType) {
        for (const el of Array.from(document.querySelectorAll('[class*="JobDetails"] span'))) {
          const t = el.textContent?.toLowerCase() ?? '';
          if (t.includes('full-time') || t.includes('part-time') || t.includes('contract')) {
            empType = el.textContent?.trim() ?? '';
            break;
          }
        }
      }

      const applyBtn = document.querySelector(
        'a[data-test="applyButton"], a[class*="applyButton"], ' +
        'a[href*="apply"]:not([href*="glassdoor"])'
      ) as HTMLAnchorElement | null;
      const applyUrl = applyBtn?.href ?? null;

      const isReposted = /\breposted\b/i.test(document.body.innerText ?? '');
      return { description, salary, empType, applyUrl, isReposted };
    });

    return buildJobFromRaw({
      title: fallback.title,
      company: fallback.company,
      location: fallback.location,
      description: `${data.salary} ${fallback.salary} ${data.description}`.trim(),
      datePostedText: fallback.datePosted,
      sourceUrl: url,
      source: 'Glassdoor',
      employmentTypeText: data.empType,
      applyUrl: data.applyUrl,
      isReposted: fallback.isReposted || data.isReposted,
    });
  } catch {
    return buildJobFromRaw({
      title: fallback.title,
      company: fallback.company,
      location: fallback.location,
      description: fallback.salary,
      datePostedText: fallback.datePosted,
      sourceUrl: url,
      source: 'Glassdoor',
      isReposted: fallback.isReposted,
    });
  }
}

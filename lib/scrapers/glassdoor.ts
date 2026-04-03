import type { Browser } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

// Glassdoor IC city IDs (Canadian cities)
const CITY_IDS: Record<string, string> = {
  default: '2281069',
  toronto: '2281069',
  mississauga: '2281070',
  brampton: '2281066',
  markham: '2281071',
  vaughan: '2281075',
  oakville: '2281072',
  hamilton: '2281068',
  scarborough: '2281073',
  etobicoke: '2281067',
};

function getCityId(location: string): string {
  const lower = location.toLowerCase();
  for (const [city, id] of Object.entries(CITY_IDS)) {
    if (city !== 'default' && lower.includes(city)) return id;
  }
  return CITY_IDS.default;
}

/**
 * Build Glassdoor's SSR canonical job search URL.
 * Format: /Job/{city}-{kw}-jobs-SRCH_IL.0,{cityLen}_IC{cityId}_KO{kwStart},{kwEnd}.htm
 * This format is server-side rendered for SEO, so it returns HTML without JS.
 */
function glassdoorSearchUrl(keyword: string, location: string, pageNum = 1): string {
  const city = (location.split(',')[0] || 'toronto')
    .toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const kw = (keyword || 'jobs')
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

  // Use a fresh context with JS disabled so we get raw SSR HTML.
  // This bypasses the React login-wall modal which is only injected client-side.
  const context = await browser.newContext({
    javaScriptEnabled: false,
    userAgent: randomUserAgent(),
    extraHTTPHeaders: {
      'Accept-Language': 'en-CA,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://www.glassdoor.ca/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Upgrade-Insecure-Requests': '1',
    },
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
  });

  const page = await context.newPage();

  try {
    const allCards: Array<{
      title: string; href: string; company: string;
      location: string; salary: string; datePosted: string; isReposted: boolean;
    }> = [];
    const seenHrefs = new Set<string>();

    for (const pageNum of [1, 2, 3]) {
      const searchUrl = glassdoorSearchUrl(filters.keywords, filters.location || 'Toronto', pageNum);

      try {
        await withRetry(async () => {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        });
        await sleep(1000 + Math.random() * 500);
      } catch {
        break;
      }

      const pageCards = await page.evaluate(() => {
        // Try multiple selector strategies for Glassdoor SSR HTML
        let cards = Array.from(document.querySelectorAll('[data-test="jobListing"]'));

        if (cards.length === 0) {
          cards = Array.from(document.querySelectorAll(
            'li[class*="JobsList"], li[class*="react-job-listing"], ' +
            'article[class*="JobCard"], [class*="jobCard"], ' +
            'li[class*="job-listing"]'
          ));
        }

        // Fallback: any <li> that contains a job link
        if (cards.length === 0) {
          cards = Array.from(document.querySelectorAll('li')).filter((li) =>
            li.querySelector('a[href*="/job-listing/"], a[href*="/Job/"], a[data-test="job-link"]')
          );
        }

        return cards.map((card) => {
          // Title link
          const titleEl = (
            card.querySelector('[data-test="job-link"]') ??
            card.querySelector('[data-test="job-title"]') ??
            card.querySelector('a[href*="/job-listing/"]') ??
            card.querySelector('a[href*="/Job/"]') ??
            card.querySelector('a[class*="jobLink"]') ??
            card.querySelector('a[class*="JobCard"]')
          ) as HTMLAnchorElement | null;

          const title = titleEl?.textContent?.trim() ?? '';
          const href = titleEl?.href ?? '';

          const company = (
            card.querySelector('[data-test="employer-name"]') ??
            card.querySelector('[class*="EmployerProfile__name"]') ??
            card.querySelector('[class*="employer-name"]') ??
            card.querySelector('[class*="companyName"]')
          )?.textContent?.trim() ?? '';

          const location = (
            card.querySelector('[data-test="emp-location"]') ??
            card.querySelector('[class*="location"]') ??
            card.querySelector('[class*="Location"]')
          )?.textContent?.trim() ?? '';

          const salary = (
            card.querySelector('[data-test="detailSalary"]') ??
            card.querySelector('[data-test="salary-estimate"]') ??
            card.querySelector('[class*="salary"]') ??
            card.querySelector('[class*="Salary"]')
          )?.textContent?.trim() ?? '';

          const datePosted = (
            card.querySelector('[data-test="listing-age"]') ??
            card.querySelector('[class*="listing-age"]') ??
            card.querySelector('time')
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

    // Build jobs from card data only — no per-job page visits (avoids bot detection)
    for (const card of allCards) {
      const fullUrl = card.href.startsWith('http')
        ? card.href
        : `https://www.glassdoor.ca${card.href}`;

      jobs.push(
        buildJobFromRaw({
          title: card.title,
          company: card.company,
          location: card.location || filters.location || 'Toronto, ON',
          description: card.salary,
          datePostedText: card.datePosted,
          sourceUrl: fullUrl,
          source: 'Glassdoor',
          isReposted: card.isReposted,
        })
      );
    }
  } finally {
    await page.close();
    await context.close();
  }

  return jobs;
}

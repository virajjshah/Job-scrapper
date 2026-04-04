import type { Browser } from 'playwright-core';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

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

/** CSS injected immediately on page load to nuke all login walls / modals. */
const MODAL_KILL_CSS = `
  [class*="modal"],[class*="Modal"],[class*="ModalContainer"],
  [class*="overlay"],[class*="Overlay"],[class*="hardsell"],
  [class*="LoginModal"],[class*="SignInModal"],[class*="authModal"],
  [class*="gdModal"],[class*="ModalBackdrop"],[class*="Backdrop"],
  [data-test*="modal"],[class*="PaidJobsHH"],[class*="ToastMessage"] {
    display: none !important;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
  body, html { overflow: auto !important; }
`;

export async function scrapeGlassdoor(browser: Browser, filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    'User-Agent': randomUserAgent(),
    'Accept-Language': 'en-CA,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://www.google.ca/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Upgrade-Insecure-Requests': '1',
  });

  // Inject modal-killing CSS before any navigation
  await page.addStyleTag({ content: MODAL_KILL_CSS });

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
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        });

        // Inject again after navigation in case React re-added the modal
        await page.addStyleTag({ content: MODAL_KILL_CSS }).catch(() => {});

        // Also remove via JS for elements that resist CSS
        await page.evaluate(() => {
          const kill = [
            '[class*="modal"]', '[class*="Modal"]', '[class*="overlay"]',
            '[class*="LoginModal"]', '[class*="hardsell"]', '[class*="Backdrop"]',
          ];
          document.querySelectorAll(kill.join(',')).forEach((el) => {
            (el as HTMLElement).style.cssText = 'display:none!important';
          });
          document.body.style.overflow = 'auto';
        }).catch(() => {});

        await sleep(1500 + Math.random() * 500);
      } catch {
        break;
      }

      const pageCards = await page.evaluate(() => {
        // Strategy 1: stable data-test selectors
        let cards = Array.from(document.querySelectorAll('[data-test="jobListing"]'));

        // Strategy 2: class-name fragments
        if (cards.length === 0) {
          cards = Array.from(document.querySelectorAll(
            'li[class*="JobsList"], li[class*="react-job-listing"], ' +
            'article[class*="JobCard"], li[class*="jobCard"], ' +
            'li[class*="job-listing"]'
          ));
        }

        // Strategy 3: any li containing a job link
        if (cards.length === 0) {
          cards = Array.from(document.querySelectorAll('li')).filter((li) =>
            li.querySelector(
              'a[href*="/job-listing/"], a[href*="/Job/"], ' +
              'a[data-test="job-link"], a[class*="jobLink"]'
            )
          );
        }

        return cards.map((card) => {
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
            card.querySelector('[class*="jobAge"]') ??
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
  }

  return jobs;
}

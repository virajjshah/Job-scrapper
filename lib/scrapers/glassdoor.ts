import type { Browser, Page } from 'playwright-core';
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

/** CSS injected to nuke login walls / modals so we can see content. */
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

async function killModals(page: Page) {
  await page.addStyleTag({ content: MODAL_KILL_CSS }).catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll(
      '[class*="modal"],[class*="Modal"],[class*="overlay"],[class*="Overlay"],' +
      '[class*="LoginModal"],[class*="hardsell"],[class*="Backdrop"]'
    ).forEach((el) => {
      (el as HTMLElement).style.cssText = 'display:none!important';
    });
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
  }).catch(() => {});
}

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

  try {
    const allCards: Array<{
      title: string; href: string; company: string;
      location: string; salary: string; datePosted: string; isReposted: boolean;
    }> = [];
    const seenHrefs = new Set<string>();

    // ── 3 pages of search results ─────────────────────────────────────────
    for (const pageNum of [1, 2, 3]) {
      const searchUrl = glassdoorSearchUrl(filters.keywords, filters.location || 'Toronto', pageNum);

      try {
        await withRetry(async () => {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        });
        await killModals(page);
        await sleep(2000 + Math.random() * 1000);
        await killModals(page);
      } catch { break; }

      const pageCards = await page.evaluate(() => {
        let cards = Array.from(document.querySelectorAll('[data-test="jobListing"]'));
        if (cards.length === 0) {
          cards = Array.from(document.querySelectorAll(
            'li[class*="JobsList"], li[class*="react-job-listing"], ' +
            'article[class*="JobCard"], li[class*="jobCard"], li[class*="job-listing"]'
          ));
        }
        if (cards.length === 0) {
          cards = Array.from(document.querySelectorAll('li')).filter((li) =>
            li.querySelector('a[href*="/job-listing/"], a[href*="/Job/"], a[data-test="job-link"]')
          );
        }

        return cards.map((card) => {
          const titleEl = (
            card.querySelector('[data-test="job-link"]') ??
            card.querySelector('[data-test="job-title"]') ??
            card.querySelector('a[href*="/job-listing/"]') ??
            card.querySelector('a[href*="/Job/"]') ??
            card.querySelector('a[class*="jobLink"]')
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

    // ── Visit EVERY job detail page ───────────────────────────────────────
    for (const card of allCards) {
      const fullUrl = card.href.startsWith('http')
        ? card.href
        : `https://www.glassdoor.ca${card.href}`;

      try {
        await sleep(1000 + Math.random() * 700);
        const job = await scrapeGlassdoorJob(page, fullUrl, card, filters);
        if (job) { jobs.push(job); continue; }
      } catch { /* detail failed — fall through to card-only */ }

      // Fallback: build from card data
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

async function scrapeGlassdoorJob(
  page: Page,
  url: string,
  fallback: {
    title: string; company: string; location: string;
    datePosted: string; salary: string; isReposted: boolean;
  },
  filters: SearchFilters,
): Promise<Job | null> {
  await withRetry(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  });
  await killModals(page);
  await sleep(1200);
  await killModals(page);

  const data = await page.evaluate(() => {
    // Full job description
    const description = (
      document.querySelector('[class*="JobDetails"], [data-test="job-description"], .desc, [class*="jobDescription"]') ??
      document.querySelector('[class*="Description"], article, main')
    )?.textContent?.trim() ?? '';

    // Salary
    const salary = (
      document.querySelector('[data-test="salaryEstimate"], [class*="salary"], [class*="SalaryEstimate"]')
    )?.textContent?.trim() ?? '';

    // Employment type
    let empType = (
      document.querySelector('[data-test="job-type"], [class*="jobType"], [class*="EmploymentType"]')
    )?.textContent?.trim() ?? '';

    if (!empType) {
      for (const el of Array.from(document.querySelectorAll('[class*="JobDetails"] span, [class*="jobInfo"] span'))) {
        const t = el.textContent?.toLowerCase() ?? '';
        if (t.includes('full-time') || t.includes('part-time') || t.includes('contract')) {
          empType = el.textContent?.trim() ?? '';
          break;
        }
      }
    }

    // Apply URL
    const applyBtn = document.querySelector(
      'a[data-test="applyButton"], a[class*="applyButton"], a[href*="apply"]:not([href*="glassdoor"])'
    ) as HTMLAnchorElement | null;
    const applyUrl = applyBtn?.href ?? null;

    const isReposted = /\breposted\b/i.test(document.body.innerText ?? '');
    return { description, salary, empType, applyUrl, isReposted };
  });

  return buildJobFromRaw({
    title: fallback.title,
    company: fallback.company,
    location: fallback.location || filters.location || 'Toronto, ON',
    description: `${data.salary} ${fallback.salary} ${data.description}`.trim(),
    datePostedText: fallback.datePosted,
    sourceUrl: url,
    source: 'Glassdoor',
    employmentTypeText: data.empType,
    applyUrl: data.applyUrl,
    isReposted: fallback.isReposted || data.isReposted,
  });
}

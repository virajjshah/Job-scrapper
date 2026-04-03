import type { Browser, Page } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

/** Map datePostedDays → LinkedIn f_TPR value (seconds) */
function linkedInDateParam(days: number): string {
  if (days <= 0) return '';
  return `r${days * 24 * 60 * 60}`;
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

    // ── Find job cards via the most stable selector: job view links ────────
    // For each link we walk up the DOM to the card container so we can also
    // grab the chip badges (salary, work type, employment type) and the
    // "Reposted X hours ago" green text that only appears in the card.
    const jobCards = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll('a[href*="/jobs/view/"]')
      ) as HTMLAnchorElement[];

      const seen = new Set<string>();
      const result: Array<{ href: string; chipText: string; isReposted: boolean }> = [];

      for (const a of links) {
        const href = a.href.split('?')[0];
        if (!href || seen.has(href)) continue;
        seen.add(href);

        // Walk up to find the card container (LI, or element with job-card / data-job-id)
        let el: Element | null = a;
        let container: Element | null = null;
        for (let depth = 0; depth < 12 && el; depth++) {
          el = el.parentElement;
          if (!el) break;
          const cls = el.getAttribute('class') ?? '';
          if (
            cls.includes('job-card') ||
            cls.includes('jobCard') ||
            el.tagName === 'LI' ||
            el.hasAttribute('data-job-id') ||
            el.hasAttribute('data-entity-urn')
          ) {
            container = el;
            break;
          }
        }

        const cardEl = container ?? a.parentElement;
        // Extract chip texts — salary/type badges are short spans
        const chips = cardEl
          ? Array.from(
              cardEl.querySelectorAll(
                '[class*="metadata-item"], [class*="job-card-container__metadata"], ' +
                '[class*="job-card__metadata"], li[class*="job-insight"]'
              )
            )
              .map((el) => el.textContent?.trim() ?? '')
              .filter((t) => t.length > 0 && t.length < 60)
          : [];

        // "Reposted" appears in the subtitle / date area in green
        const isReposted = /\breposted\b/i.test(cardEl?.textContent ?? '');

        result.push({ href, chipText: chips.join(' · '), isReposted });
        if (result.length >= 25) break;
      }

      return result;
    });

    for (const card of jobCards) {
      try {
        await sleep(1200 + Math.random() * 800);
        const job = await scrapeLinkedInJob(page, card.href, card);
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

async function scrapeLinkedInJob(
  page: Page,
  url: string,
  hints: { chipText: string; isReposted: boolean }
): Promise<Job | null> {
  await withRetry(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  await sleep(1500);

  // Expand "Show more" to get the full description
  await page.evaluate(() => {
    const btn = document.querySelector(
      'button.show-more-less-html__button, button[aria-label*="more"], button[aria-label*="Show more"]'
    ) as HTMLButtonElement | null;
    if (btn) btn.click();
  });

  await sleep(600);

  const data = await page.evaluate(() => {
    const title =
      document.querySelector(
        'h1.top-card-layout__title, h1[class*="job-title"], h1[class*="JobTitle"]'
      )?.textContent?.trim() ?? '';

    const company =
      document.querySelector(
        'a.topcard__org-name-link, [class*="company-name"], [class*="CompanyName"]'
      )?.textContent?.trim() ?? '';

    const location =
      document.querySelector(
        '.topcard__flavor--bullet, [class*="job-location"], [class*="JobLocation"]'
      )?.textContent?.trim() ?? '';

    const datePosted =
      document.querySelector(
        '[class*="posted-time"], time, [class*="PostedDate"], [class*="posted-date"]'
      )?.textContent?.trim() ?? '';

    // Full body scan for "Reposted"
    const isRepostedDetail = /\breposted\b/i.test(document.body.innerText ?? '');

    const description =
      document.querySelector(
        '.description__text, [class*="job-description"], [class*="JobDescription"], #job-details'
      )?.textContent?.trim() ?? '';

    // Employment type via job-criteria list (<h3> label + <span> value)
    let employmentType = '';
    const criteriaItems = Array.from(
      document.querySelectorAll(
        'li.description__job-criteria-item, [class*="job-criteria-item"]'
      )
    );
    for (const item of criteriaItems) {
      const header =
        item.querySelector('h3, [class*="subheader"]')?.textContent?.toLowerCase() ?? '';
      if (header.includes('employment type') || header.includes('job type')) {
        employmentType =
          item.querySelector('span, [class*="text"]')?.textContent?.trim() ?? '';
        break;
      }
    }

    // Apply URL: <a> = external apply; <button> = Easy Apply (stays on LinkedIn)
    let applyUrl: string | null = null;
    const applySelectors = [
      'a.jobs-apply-button',
      'a[class*="jobs-apply-button"]',
      'a[data-tracking-control-name*="offsite_apply"]',
      'a[data-tracking-control-name*="apply"][href]',
      'a[class*="apply-button"][href]',
      '.top-card-layout__cta a[href]',
    ];
    for (const sel of applySelectors) {
      const el = document.querySelector(sel) as HTMLAnchorElement | null;
      if (el?.href && !el.href.includes('linkedin.com')) {
        applyUrl = el.href;
        break;
      }
    }

    // JSON-LD fallback
    if (!applyUrl) {
      try {
        for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
          const json = JSON.parse(s.textContent ?? '{}');
          const candidate =
            json?.apply?.url ??
            json?.applicationContact?.url ??
            (json?.url && !json.url.includes('linkedin.com') ? json.url : null);
          if (candidate) { applyUrl = candidate; break; }
        }
      } catch { /* ignore */ }
    }

    return { title, company, location, datePosted, description, employmentType, applyUrl, isRepostedDetail };
  });

  if (!data.title || !data.company) return null;

  // Prepend card chip text so parsers (salary, employment type) see CA$70K/yr badges
  const fullDescription = hints.chipText
    ? `${hints.chipText}\n\n${data.description}`
    : data.description;

  return buildJobFromRaw({
    title: data.title,
    company: data.company,
    location: data.location,
    description: fullDescription,
    datePostedText: data.datePosted,
    sourceUrl: url,
    source: 'LinkedIn',
    employmentTypeText: data.employmentType || hints.chipText,
    applyUrl: data.applyUrl,
    isReposted: hints.isReposted || data.isRepostedDetail,
  });
}

import type { Browser, Page } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

function linkedInDateParam(days: number): string {
  if (days <= 0) return '';
  return `r${days * 24 * 60 * 60}`;
}

const WORK_TYPE_MAP: Record<string, string> = {
  Remote: '2', Hybrid: '3', 'On-site': '1', Any: '',
};
const EMP_TYPE_MAP: Record<string, string> = {
  'Full-time': 'F', 'Part-time': 'P', Contract: 'C',
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

    await withRetry(async () => {
      await page.goto(
        `https://www.linkedin.com/jobs/search/?${params.toString()}`,
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );
    });

    await sleep(2000 + Math.random() * 1000);

    // ── Extract card-level data from the search results listing page ─────────
    // LinkedIn renders each result as an <li>. From each <li> we pull:
    //   • salary chip  → .job-search-card__salary-info
    //   • benefit tags → .job-search-card__benefits li  (✓ On-site, ✓ Full-time …)
    //   • reposted     → the <time> element text contains "Reposted"
    // We walk UP from every job-view link to its nearest <li> ancestor so we
    // never miss a card even if LinkedIn changes outer wrapper class names.
    const jobCards = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll('a[href*="/jobs/view/"]')
      ) as HTMLAnchorElement[];

      const seen = new Set<string>();
      const result: Array<{
        href: string;
        salary: string;
        benefits: string[];
        isReposted: boolean;
        dateText: string;
      }> = [];

      for (const a of links) {
        const href = a.href.split('?')[0];
        if (!href || seen.has(href)) continue;
        seen.add(href);

        // Walk up to the nearest <li> – every LinkedIn search result lives in one
        let li: Element | null = a;
        while (li && li.tagName !== 'LI') {
          li = li.parentElement;
        }
        const card = li ?? a.parentElement;
        if (!card) continue;

        // ── Salary chip ─────────────────────────────────────────────────────
        // Public search page class: job-search-card__salary-info
        const salary = (
          card.querySelector(
            '.job-search-card__salary-info, ' +
            '[class*="salary-info"], ' +
            '[class*="salaryInfo"]'
          )?.textContent ?? ''
        ).trim();

        // ── Benefit / insight tags (On-site, Full-time, Hybrid, etc.) ───────
        // These live in <ul class="job-search-card__benefits"> or similar
        const benefitEls = card.querySelectorAll(
          '.job-search-card__benefits li, ' +
          '[class*="job-search-card__benefits"] li, ' +
          '[class*="job-insight"] li, ' +
          '[class*="job-insight-text"], ' +
          '[class*="benefits-item"]'
        );
        const benefits = Array.from(benefitEls)
          .map((el) => el.textContent?.replace(/[✓✔]/g, '').trim() ?? '')
          .filter((t) => t.length > 0 && t.length < 60);

        // ── Date / Reposted ─────────────────────────────────────────────────
        // <time class="job-search-card__listdate--new"> contains "Reposted X hours ago"
        // <time class="job-search-card__listdate"> contains "X days ago"
        const timeEl = card.querySelector(
          'time[class*="listdate"], time[class*="listed-time"], time, [class*="listed-time"]'
        );
        const dateText = timeEl?.textContent?.trim() ?? '';
        const isReposted = /\breposted\b/i.test(dateText) || /\breposted\b/i.test(card.textContent ?? '');

        result.push({ href, salary, benefits, isReposted, dateText });
        if (result.length >= 25) break;
      }

      return result;
    });

    for (const card of jobCards) {
      try {
        await sleep(1200 + Math.random() * 800);
        const job = await scrapeLinkedInJob(page, card.href, card);
        if (job) jobs.push(job);
      } catch { /* skip */ }
    }
  } finally {
    await page.close();
  }

  return jobs;
}

async function scrapeLinkedInJob(
  page: Page,
  url: string,
  hints: { salary: string; benefits: string[]; isReposted: boolean; dateText: string }
): Promise<Job | null> {
  await withRetry(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  });

  await sleep(1500);

  // Expand "Show more" so full description is in the DOM
  await page.evaluate(() => {
    (document.querySelector(
      'button.show-more-less-html__button, button[aria-label*="more"]'
    ) as HTMLButtonElement | null)?.click();
  });

  await sleep(600);

  const data = await page.evaluate(() => {
    const title =
      document.querySelector('h1.top-card-layout__title, h1[class*="job-title"]')
        ?.textContent?.trim() ?? '';

    const company =
      document.querySelector('a.topcard__org-name-link, [class*="company-name"]')
        ?.textContent?.trim() ?? '';

    const location =
      document.querySelector('.topcard__flavor--bullet, [class*="job-location"]')
        ?.textContent?.trim() ?? '';

    const datePosted =
      document.querySelector('[class*="posted-time"], time, [class*="PostedDate"]')
        ?.textContent?.trim() ?? '';

    const isRepostedDetail = /\breposted\b/i.test(document.body.innerText ?? '');

    const description =
      document.querySelector(
        '.description__text, [class*="job-description"], #job-details'
      )?.textContent?.trim() ?? '';

    // Employment type from the job criteria list
    // Structure: <li><h3>Employment type</h3><span>Full-time</span></li>
    let employmentType = '';
    for (const item of Array.from(document.querySelectorAll(
      'li.description__job-criteria-item, [class*="job-criteria-item"]'
    ))) {
      const header = item.querySelector('h3, [class*="subheader"]')?.textContent?.toLowerCase() ?? '';
      if (header.includes('employment type') || header.includes('job type')) {
        employmentType = item.querySelector('span')?.textContent?.trim() ?? '';
        break;
      }
    }

    // Apply URL: <a> = external; <button> = Easy Apply (no href worth using)
    let applyUrl: string | null = null;
    for (const sel of [
      'a.jobs-apply-button',
      'a[class*="jobs-apply-button"]',
      'a[data-tracking-control-name*="offsite_apply"]',
      'a[data-tracking-control-name*="apply"][href]',
      'a[class*="apply-button"][href]',
      '.top-card-layout__cta a[href]',
    ]) {
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
          const c = json?.apply?.url ?? json?.applicationContact?.url ??
            (json?.url && !json.url.includes('linkedin.com') ? json.url : null);
          if (c) { applyUrl = c; break; }
        }
      } catch { /* ignore */ }
    }

    return { title, company, location, datePosted, description, employmentType, applyUrl, isRepostedDetail };
  });

  if (!data.title || !data.company) return null;

  // Build the hints string: salary chip first, then benefit tags
  // This is prepended to the description so parsers see "CA$70K/yr – CA$75K/yr · On-site · Full-time"
  const chipParts = [hints.salary, ...hints.benefits].filter(Boolean);
  const fullDescription = chipParts.length > 0
    ? `${chipParts.join(' · ')}\n\n${data.description}`
    : data.description;

  // Employment type: prefer the detail-page value, fall back to benefits chips from card
  const empTypeText = data.employmentType || hints.benefits.join(' ');

  return buildJobFromRaw({
    title: data.title,
    company: data.company,
    location: data.location,
    description: fullDescription,
    datePostedText: hints.dateText || data.datePosted,
    sourceUrl: url,
    source: 'LinkedIn',
    employmentTypeText: empTypeText,
    applyUrl: data.applyUrl,
    isReposted: hints.isReposted || data.isRepostedDetail,
  });
}

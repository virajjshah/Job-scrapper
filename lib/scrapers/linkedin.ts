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

    // ── Step 1: extract card-level metadata from the listing page ──────────
    // Cards contain salary/work-type/employment-type chips AND the reposted
    // indicator (shown as green "Reposted X hours ago" text in the date line).
    const jobCards = await page.evaluate(() => {
      // LinkedIn uses several different card container selectors over time
      const cardEls = Array.from(
        document.querySelectorAll(
          '.job-card-container, [data-job-id], ' +
          'li[class*="jobs-search-results__list-item"], ' +
          '[class*="job-card-list__entity"]'
        )
      );

      return cardEls.slice(0, 25).map((card) => {
        const linkEl = card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement | null;
        const href = linkEl?.href?.split('?')[0] ?? '';

        // Metadata chips: "CA$70K/yr – CA$75K/yr", "On-site", "Full-time", etc.
        const chips = Array.from(
          card.querySelectorAll(
            '[class*="metadata-item"], ' +
            '[class*="job-card-container__metadata-item"], ' +
            '[class*="job-card__metadata"]'
          )
        )
          .map((el) => el.textContent?.trim() ?? '')
          .filter(Boolean);

        // The date subtitle: "Mississauga, ON · Reposted 11 hours ago · 95 people clicked apply"
        // "Reposted" only shows up here (green badge), not always on the detail page.
        const fullCardText = card.textContent ?? '';
        const isReposted = /\breposted\b/i.test(fullCardText);

        return { href, chips, isReposted };
      }).filter((c) => !!c.href);
    });

    // ── Step 2: visit each job detail page ─────────────────────────────────
    for (const card of jobCards) {
      try {
        await sleep(1200 + Math.random() * 800);
        const job = await scrapeLinkedInJob(page, card.href, {
          chipText: card.chips.join(' · '),
          isReposted: card.isReposted,
        });
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

  // Expand "Show more" in description before reading
  await page.evaluate(() => {
    const btn = document.querySelector(
      'button.show-more-less-html__button, button[aria-label*="more"], button[aria-label*="Show more"]'
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
    const datePosted =
      document.querySelector(
        '[class*="posted-time"], time, [class*="PostedDate"], [class*="posted-date"]'
      )?.textContent?.trim() ?? '';

    // ── Reposted ───────────────────────────────────────────────────────────
    // Check full body text AND specifically the date/subtitle area.
    // LinkedIn shows "Reposted X hours ago" in green in the card but may also
    // render it on the detail page.
    const isRepostedDetail = /\breposted\b/i.test(document.body.innerText ?? '');

    // ── Description ────────────────────────────────────────────────────────
    const description =
      document.querySelector(
        '.description__text, [class*="job-description"], [class*="JobDescription"], #job-details'
      )?.textContent?.trim() ?? '';

    // ── Employment type via job-criteria list ──────────────────────────────
    // LinkedIn renders criteria as: <li><h3>Employment type</h3><span>Full-time</span></li>
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

    // ── Apply URL ──────────────────────────────────────────────────────────
    // LinkedIn distinguish "Easy Apply" (a <button>) from external apply (an <a>).
    // We only want the external <a> href.
    let applyUrl: string | null = null;

    // 1. Dedicated apply <a> tags — must NOT be linkedin.com
    const applySelectors = [
      'a.jobs-apply-button',               // top-level external apply
      'a[class*="jobs-apply-button"]',
      'a[data-tracking-control-name*="offsite_apply"]',
      'a[data-tracking-control-name*="apply"][href]',
      'a[class*="apply-button"][href]',
      '.top-card-layout__cta a[href]',     // CTA area link
    ];
    for (const sel of applySelectors) {
      const el = document.querySelector(sel) as HTMLAnchorElement | null;
      if (el?.href && !el.href.includes('linkedin.com')) {
        applyUrl = el.href;
        break;
      }
    }

    // 2. JSON-LD JobPosting schema may contain the direct company URL
    if (!applyUrl) {
      try {
        const ldScripts = Array.from(
          document.querySelectorAll('script[type="application/ld+json"]')
        );
        for (const s of ldScripts) {
          const json = JSON.parse(s.textContent ?? '{}');
          const candidate =
            json?.apply?.url ??
            json?.applicationContact?.url ??
            (json?.url && !json.url.includes('linkedin.com') ? json.url : null);
          if (candidate) { applyUrl = candidate; break; }
        }
      } catch { /* ignore */ }
    }

    // 3. Last resort: any non-LinkedIn <a> on the page whose URL looks like an apply link
    if (!applyUrl) {
      const allLinks = Array.from(
        document.querySelectorAll('a[href]')
      ) as HTMLAnchorElement[];
      const found = allLinks.find(
        (a) =>
          a.href.startsWith('http') &&
          !a.href.includes('linkedin.com') &&
          /(?:apply|careers?|jobs?)/.test(a.href)
      );
      if (found) applyUrl = found.href;
    }

    return {
      title, company, location, datePosted,
      description, employmentType, applyUrl,
      isRepostedDetail,
    };
  });

  if (!data.title || !data.company) return null;

  // Prepend the card chip text (salary/type info) to description so parsers pick it up
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
    // Prefer card-level reposted flag (green badge in listing), fall back to detail page
    isReposted: hints.isReposted || data.isRepostedDetail,
  });
}

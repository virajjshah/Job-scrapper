import { parse } from 'node-html-parser';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep } from './utils';

const WORK_TYPE_MAP: Record<string, string> = {
  Remote: '2', Hybrid: '3', 'On-site': '1', Any: '',
};
const EMP_TYPE_MAP: Record<string, string> = {
  'Full-time': 'F', 'Part-time': 'P', Contract: 'C',
};

function linkedInDateParam(days: number): string {
  return days > 0 ? `r${days * 24 * 60 * 60}` : '';
}

async function liGet(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-CA,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`LinkedIn ${res.status}`);
  return res.text();
}

export async function scrapeLinkedIn(filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];

  const tprValue = linkedInDateParam(filters.datePostedDays);
  const params = new URLSearchParams({
    keywords: filters.keywords,
    location: filters.location || 'Toronto, Ontario, Canada',
    start: '0',
    ...(tprValue ? { f_TPR: tprValue } : {}),
    ...(filters.workType !== 'Any' ? { f_WT: WORK_TYPE_MAP[filters.workType] } : {}),
    ...(filters.employmentTypes.length > 0
      ? { f_JT: filters.employmentTypes.map((t) => EMP_TYPE_MAP[t]).filter(Boolean).join(',') }
      : {}),
  });

  type Card = {
    href: string; jobId: string; title: string; company: string;
    location: string; salary: string; benefits: string[];
    isReposted: boolean; dateText: string;
  };

  const allCards: Card[] = [];
  const seenHrefs = new Set<string>();

  // ── Collect cards across 5 pages (up to 125 jobs) ─────────────────────
  for (const start of [0, 25, 50, 75, 100]) {
    params.set('start', String(start));
    const searchUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`;

    let html = '';
    try {
      html = await liGet(searchUrl);
      await sleep(600 + Math.random() * 400);
    } catch { break; }

    const root = parse(html);
    const items = root.querySelectorAll('li');
    let added = 0;

    for (const li of items) {
      const linkEl = li.querySelector('a[href*="/jobs/view/"]');
      if (!linkEl) continue;

      const rawHref = linkEl.getAttribute('href') ?? '';
      const href = rawHref.split('?')[0];
      if (!href || seenHrefs.has(href)) continue;
      seenHrefs.add(href);

      // Extract job ID from URL (most reliable) — e.g. /jobs/view/3912345678
      const jobId = href.match(/\/jobs\/view\/(\d+)/)?.[1] ?? '';

      const title = (
        li.querySelector('.base-search-card__title')?.textContent ??
        li.querySelector('h3')?.textContent ?? ''
      ).trim();

      const company = (
        li.querySelector('.base-search-card__subtitle')?.textContent ??
        li.querySelector('h4')?.textContent ?? ''
      ).trim();

      const location = li.querySelector('.job-search-card__location')?.textContent?.trim() ?? '';

      // Salary chip e.g. "CA$70K/yr – CA$90K/yr"
      const salary = li.querySelector('.job-search-card__salary-info')?.textContent?.trim() ?? '';

      // Work-type / employment-type benefit pills
      const benefits = li.querySelectorAll(
        '.job-search-card__benefits li, [class*="job-search-card__benefits"] li'
      ).map((el) => el.textContent?.replace(/[✓✔\u2713\u2714]/g, '').trim() ?? '')
        .filter((t) => t.length > 0 && t.length < 60);

      // Date & repost
      const timeEl = li.querySelector('time');
      const dateText = timeEl?.textContent?.trim() ?? '';
      const isReposted =
        /\breposted\b/i.test(dateText) ||
        (timeEl?.getAttribute('class') ?? '').includes('--new');

      if (title) {
        allCards.push({ href, jobId, title, company, location, salary, benefits, isReposted, dateText });
        added++;
      }
    }

    if (added === 0) break; // no more pages
  }

  // ── Deep scrape every card's detail page ─────────────────────────────
  // LinkedIn guest API jobPosting endpoint returns full plain-HTML with:
  // - Complete job description (salary ranges, years of experience mentioned in text)
  // - Job criteria section (Employment type, Seniority, Industries)
  // - Apply button (external URL for offsite applications)
  for (const card of allCards) {
    if (!card.title || !card.company) continue;

    let job: Job | null = null;
    if (card.jobId) {
      try {
        await sleep(400 + Math.random() * 300);
        job = await scrapeLinkedInDetail(card);
      } catch { /* fall through to card-only */ }
    }

    if (!job) {
      // Card-data fallback
      const chipParts = [card.salary, ...card.benefits].filter(Boolean);
      job = buildJobFromRaw({
        title: card.title,
        company: card.company,
        location: card.location,
        description: chipParts.join(' · '),
        datePostedText: card.dateText,
        sourceUrl: card.href,
        source: 'LinkedIn',
        employmentTypeText: card.benefits.join(' '),
        applyUrl: null,
        isReposted: card.isReposted,
      });
    }

    jobs.push(job);
  }

  return jobs;
}

async function scrapeLinkedInDetail(card: {
  href: string; jobId: string; title: string; company: string;
  location: string; salary: string; benefits: string[];
  isReposted: boolean; dateText: string;
}): Promise<Job> {
  const detailUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.jobId}`;
  const html = await liGet(detailUrl);
  const root = parse(html);

  // Full description
  const desc = (
    root.querySelector('.description__text') ??
    root.querySelector('.show-more-less-html__markup') ??
    root.querySelector('[class*="description"]')
  )?.textContent?.trim() ?? '';

  // Employment type from job criteria list
  let empType = '';
  for (const item of root.querySelectorAll('.description__job-criteria-item, [class*="job-criteria-item"]')) {
    const label = item.querySelector('h3')?.textContent?.toLowerCase() ?? '';
    if (label.includes('employment type') || label.includes('job type')) {
      empType = item.querySelector('span')?.textContent?.trim() ?? '';
      break;
    }
  }

  // External apply URL (not Easy Apply which is a <button>)
  let applyUrl: string | null = null;
  for (const sel of ['a.apply-button--offsite', 'a[class*="apply-button"]', 'a.apply-button']) {
    const el = root.querySelector(sel);
    const href = el?.getAttribute('href') ?? '';
    if (href && !href.includes('linkedin.com')) {
      applyUrl = href;
      break;
    }
  }

  // Merge chip data into description so parsers see salary ranges + work type from chips
  const chipParts = [card.salary, ...card.benefits].filter(Boolean);
  const fullDescription = [chipParts.join(' · '), desc].filter(Boolean).join('\n\n');
  const empTypeText = empType || card.benefits.join(' ');

  return buildJobFromRaw({
    title: card.title,
    company: card.company,
    location: card.location,
    description: fullDescription,
    datePostedText: card.dateText,
    sourceUrl: card.href,
    source: 'LinkedIn',
    employmentTypeText: empTypeText,
    applyUrl,
    isReposted: card.isReposted,
  });
}

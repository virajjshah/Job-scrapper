import { parse } from 'node-html-parser';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, extractJsonLdData } from './utils';

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

async function gdGet(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-CA,en;q=0.9',
      'Referer': 'https://www.google.ca/',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Glassdoor ${res.status}`);
  return res.text();
}

/** Strip Glassdoor estimation annotations like "(Employer est.)" "(Glassdoor est.)" */
function cleanGlassdoorSalary(text: string): string {
  return text
    .replace(/\((?:Employer|Glassdoor|Company|Indeed)\s+est\.?\)/gi, '')
    .replace(/\bEst(?:imated)?\.?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Extract clean text from HTML, preserving line breaks */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function scrapeGlassdoor(filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];

  type Card = {
    title: string; href: string; company: string;
    location: string; salary: string; datePosted: string; isReposted: boolean;
  };

  const allCards: Card[] = [];
  const seenHrefs = new Set<string>();

  // ── Collect cards from 3 pages ────────────────────────────────────────
  for (const pageNum of [1, 2, 3]) {
    const searchUrl = glassdoorSearchUrl(filters.keywords, filters.location || 'Toronto', pageNum);

    let html = '';
    try {
      html = await gdGet(searchUrl);
      await sleep(1000 + Math.random() * 500);
    } catch { break; }

    const root = parse(html);

    // Try multiple selector strategies for Glassdoor's SSR HTML
    let cards = root.querySelectorAll('[data-test="jobListing"]');
    if (cards.length === 0) {
      cards = root.querySelectorAll('li[class*="JobsList"], li[class*="react-job-listing"], li[class*="JobCard"]');
    }
    // Fallback: any li with a job link
    if (cards.length === 0) {
      cards = root.querySelectorAll('li').filter((li) =>
        li.querySelector('a[href*="/job-listing/"]') !== null ||
        li.querySelector('a[href*="/Job/"]') !== null
      );
    }

    let added = 0;
    for (const card of cards) {
      const titleEl = (
        card.querySelector('[data-test="job-link"]') ??
        card.querySelector('a[href*="/job-listing/"]') ??
        card.querySelector('a[href*="/Job/"]') ??
        card.querySelector('a[class*="jobLink"]')
      );
      const title = titleEl?.textContent?.trim() ?? '';
      const rawHref = titleEl?.getAttribute('href') ?? '';
      if (!title || !rawHref) continue;

      const href = rawHref.startsWith('http') ? rawHref : `https://www.glassdoor.ca${rawHref}`;
      if (seenHrefs.has(href)) continue;
      seenHrefs.add(href);

      const company = (
        card.querySelector('[data-test="employer-name"]') ??
        card.querySelector('[class*="employer-name"]') ??
        card.querySelector('[class*="companyName"]')
      )?.textContent?.trim() ?? '';

      const location = (
        card.querySelector('[data-test="emp-location"]') ??
        card.querySelector('[class*="location"]')
      )?.textContent?.trim() ?? '';

      const rawSalary = (
        card.querySelector('[data-test="detailSalary"]') ??
        card.querySelector('[data-test="salary-estimate"]') ??
        card.querySelector('[class*="salary"]')
      )?.textContent?.trim() ?? '';
      const salary = cleanGlassdoorSalary(rawSalary);

      const datePosted = (
        card.querySelector('[data-test="listing-age"]') ??
        card.querySelector('[class*="listing-age"]') ??
        card.querySelector('time')
      )?.textContent?.trim() ?? '';

      const isReposted = /\breposted\b/i.test(card.textContent ?? '');

      allCards.push({ title, href, company, location, salary, datePosted, isReposted });
      added++;
    }

    if (added === 0) break;
  }

  // ── Deep scrape each job detail page ─────────────────────────────────
  for (const card of allCards) {
    try {
      await sleep(700 + Math.random() * 500);
      const html = await gdGet(card.href);
      const root = parse(html);

      // JSON-LD structured data
      const ldData = extractJsonLdData(html);

      // Description — try multiple selectors with HTML-to-text conversion
      const descEl = (
        root.querySelector('[class*="JobDetails_jobDescription"]') ??
        root.querySelector('[class*="JobDetails"]') ??
        root.querySelector('[data-test="job-description"]') ??
        root.querySelector('.desc') ??
        root.querySelector('[class*="jobDescription"]') ??
        root.querySelector('[class*="description"]')
      );

      let description = descEl ? htmlToText(descEl.innerHTML) : '';

      if (description.length < 100) {
        description = root
          .querySelectorAll('p, li')
          .map((el) => el.textContent?.trim() ?? '')
          .filter((t) => t.length > 25)
          .join('\n');
      }

      // Salary from detail page (clean estimation annotations)
      const rawSalaryChip = (
        root.querySelector('[data-test="salaryEstimate"]') ??
        root.querySelector('[class*="SalaryEstimate"]') ??
        root.querySelector('[class*="salary"]')
      )?.textContent?.trim() ?? '';
      const salaryChip = rawSalaryChip ? cleanGlassdoorSalary(rawSalaryChip) : '';

      let empType = ldData.employmentType ?? '';
      if (!empType) {
        for (const el of root.querySelectorAll(
          '[class*="JobDetails"] span, [class*="jobInfo"] span, [data-test*="job-type"]'
        )) {
          const t = el.textContent?.toLowerCase() ?? '';
          if (t.includes('full-time') || t.includes('part-time') || t.includes('contract')) {
            empType = el.textContent?.trim() ?? '';
            break;
          }
        }
      }

      const applyEl = root.querySelector('a[data-test="applyButton"], a[class*="applyButton"]');
      const applyHref = applyEl?.getAttribute('href') ?? '';
      const applyUrl = applyHref && !applyHref.includes('glassdoor') ? applyHref : null;

      // Build salary hint: prefer JSON-LD, then cleaned chip, then card salary
      const salaryHint = ldData.salary ?? (salaryChip || undefined) ?? (card.salary || undefined);

      jobs.push(buildJobFromRaw({
        title: card.title,
        company: card.company,
        location: card.location || filters.location || 'Toronto, ON',
        description: `${card.salary ? card.salary + '\n' : ''}${description}`.trim(),
        datePostedText: card.datePosted,
        sourceUrl: card.href,
        source: 'Glassdoor',
        employmentTypeText: empType,
        applyUrl,
        isReposted: card.isReposted,
        salaryHint,
        industryHint: ldData.industry ?? null,
      }));
    } catch {
      // Fallback to card-only data
      jobs.push(buildJobFromRaw({
        title: card.title,
        company: card.company,
        location: card.location || filters.location || 'Toronto, ON',
        description: card.salary,
        datePostedText: card.datePosted,
        sourceUrl: card.href,
        source: 'Glassdoor',
        isReposted: card.isReposted,
      }));
    }
  }

  return jobs;
}

import { parse } from 'node-html-parser';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, extractJsonLdData } from './utils';

async function indeedGet(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-CA,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Referer': 'https://ca.indeed.com/',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Indeed ${res.status}`);
  return res.text();
}

/**
 * Scrape Indeed via RSS (reliable, no bot detection) for job listings,
 * then fetch each job page for full description, salary and employment type.
 */
export async function scrapeIndeed(filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];

  // ── Step 1: Get listings from RSS feed ───────────────────────────────
  const params = new URLSearchParams({
    q: filters.keywords,
    l: filters.location || 'Toronto, ON',
    radius: '35',
    limit: '50',
    sort: 'date',
  });
  if (filters.datePostedDays > 0) {
    params.set('fromage', String(Math.min(filters.datePostedDays, 14)));
  }

  const rssUrl = `https://ca.indeed.com/rss?${params}`;
  let xml = '';
  try {
    const res = await fetch(rssUrl, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-CA,en;q=0.9',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) xml = await res.text();
  } catch { /* fall through with empty xml */ }

  type RssCard = {
    title: string; link: string; company: string;
    location: string; pubDate: string; descSnippet: string;
  };

  const rssCards: RssCard[] = [];
  if (xml) {
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemRe.exec(xml)) !== null) {
      const item = itemMatch[1];
      const title = (() => {
        const cd = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(item);
        if (cd) return cd[1].trim();
        return /<title>([^<]+)<\/title>/.exec(item)?.[1]?.trim() ?? '';
      })();
      const link = /<link>([^<]+)<\/link>/.exec(item)?.[1]?.trim() ?? '';
      const company = (() => {
        const cd = /<source[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/source>/.exec(item);
        if (cd) return cd[1].trim();
        return /<source[^>]*>([^<]+)<\/source>/.exec(item)?.[1]?.trim() ?? '';
      })();
      const pubDate = /<pubDate>([^<]+)<\/pubDate>/.exec(item)?.[1]?.trim() ?? '';
      const city = /<indeed:city>([^<]*)<\/indeed:city>/.exec(item)?.[1]?.trim() ?? '';
      const state = /<indeed:state>([^<]*)<\/indeed:state>/.exec(item)?.[1]?.trim() ?? '';
      const location = [city, state].filter(Boolean).join(', ') || filters.location || 'Toronto, ON';
      const rawDesc = (() => {
        const cd = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(item);
        if (cd) return cd[1];
        return /<description>([\s\S]*?)<\/description>/.exec(item)?.[1] ?? '';
      })();
      const descSnippet = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      if (title && link) {
        rssCards.push({ title, link, company, location, pubDate, descSnippet });
      }
    }
  }

  // ── Step 2: Deep scrape each job page ────────────────────────────────
  for (const card of rssCards) {
    try {
      await sleep(500 + Math.random() * 400);

      const html = await indeedGet(card.link);
      const root = parse(html);

      // JSON-LD — Indeed embeds JobPosting schema with salary + employment type
      const ldData = extractJsonLdData(html);

      // Full description
      let description = (
        root.querySelector('#jobDescriptionText') ??
        root.querySelector('[class*="jobDescriptionText"]') ??
        root.querySelector('[class*="jobsearch-JobComponent-description"]')
      )?.textContent?.trim() ?? '';

      if (description.length < 100) {
        description = root
          .querySelectorAll('p, li')
          .map((el) => el.textContent?.trim() ?? '')
          .filter((t) => t.length > 25)
          .join('\n') || card.descSnippet;
      }

      // Salary from page (fallback if not in JSON-LD)
      const salaryChip = (
        root.querySelector('[class*="salaryInfoAndJobType"]') ??
        root.querySelector('[id*="salaryInfo"]') ??
        root.querySelector('[class*="salary"]')
      )?.textContent?.trim() ?? '';

      // Employment type from metadata chips (fallback)
      let employmentType = ldData.employmentType ?? '';
      if (!employmentType) {
        for (const el of root.querySelectorAll('[data-testid="attribute_snippet_testid"], [class*="metadata"] span')) {
          const t = el.textContent?.toLowerCase() ?? '';
          if (t.includes('full-time') || t.includes('part-time') || t.includes('contract') || t.includes('permanent')) {
            employmentType = el.textContent?.trim() ?? '';
            break;
          }
        }
      }

      // Repost detection — check dedicated repost elements and the date area only
      // (avoid scanning description which may use the word "reposted" in context)
      const repostEl = root.querySelector(
        '[data-testid*="repost"], [class*="repost"], [class*="refreshed"]'
      );
      const dateAreaEl = root.querySelector(
        '[data-testid="jobsearch-JobInfoHeader-datePosted"], [class*="date-posted"], [class*="datePosted"]'
      );
      const isReposted =
        repostEl !== null ||
        /\breposted\b/i.test(dateAreaEl?.textContent ?? '');

      jobs.push(buildJobFromRaw({
        title: card.title,
        company: card.company,
        location: card.location,
        description,
        datePostedText: card.pubDate,
        sourceUrl: card.link,
        source: 'Indeed',
        employmentTypeText: employmentType,
        salaryHint: ldData.salary ?? salaryChip ?? undefined,
        industryHint: ldData.industry ?? null,
        isReposted,
      }));
    } catch {
      // Fallback: use RSS snippet data
      jobs.push(buildJobFromRaw({
        title: card.title,
        company: card.company,
        location: card.location,
        description: card.descSnippet,
        datePostedText: card.pubDate,
        sourceUrl: card.link,
        source: 'Indeed',
      }));
    }
  }

  return jobs;
}

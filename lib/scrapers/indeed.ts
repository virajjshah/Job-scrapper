import type { Browser } from 'playwright-core';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent } from './utils';

/**
 * Scrape Indeed via their public RSS feed.
 * This avoids Playwright entirely for the listing page — no bot detection,
 * no CAPTCHA, no JS rendering required. The RSS feed is stable and returns
 * up to 50 jobs per request with full metadata.
 */
export async function scrapeIndeed(_browser: Browser, filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];

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
  if (filters.workType === 'Remote') {
    params.set('remotejob', '032b3046-06a3-4876-8dfd-474eb5e7ed11');
  }

  try {
    const resp = await fetch(`https://ca.indeed.com/rss?${params}`, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-CA,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) return [];
    const xml = await resp.text();

    // Pull each <item> block
    const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    for (const match of itemMatches) {
      const item = match[1];

      // Helper: extract a field, handling CDATA or plain text
      const field = (tag: string): string => {
        const cd = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`).exec(item);
        if (cd) return cd[1].trim();
        const plain = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`).exec(item);
        return plain?.[1]?.trim() ?? '';
      };

      const title = field('title');
      // <link> in RSS is a plain text node not wrapped in CDATA
      const link = /<link>([^<]+)<\/link>/.exec(item)?.[1]?.trim() ?? '';
      const company = field('source');
      const pubDate = field('pubDate');

      // Strip HTML tags from description
      const rawDesc = field('description');
      const description = rawDesc.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

      // indeed:city / indeed:state namespace tags
      const city = /<indeed:city>([^<]*)<\/indeed:city>/.exec(item)?.[1]?.trim() ?? '';
      const state = /<indeed:state>([^<]*)<\/indeed:state>/.exec(item)?.[1]?.trim() ?? '';
      const location = [city, state].filter(Boolean).join(', ') || filters.location || 'Toronto, ON';

      if (!title || !link) continue;

      jobs.push(
        buildJobFromRaw({
          title,
          company,
          location,
          description,
          datePostedText: pubDate,
          sourceUrl: link,
          source: 'Indeed',
        })
      );
    }
  } catch {
    // Network error or timeout — return whatever we got
  }

  return jobs;
}

import { parse } from 'node-html-parser';
import type { Job } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep } from './utils';

export async function scrapeCustomUrl(url: string): Promise<Job[]> {
  const jobs: Job[] = [];

  let html = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-CA,en;q=0.9',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch { return []; }

  const root = parse(html);

  // Collect job-like links
  const jobKeywords = ['job', 'career', 'position', 'opening', 'vacancy', 'role', 'apply'];
  const links: string[] = [];
  const seen = new Set<string>();

  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    const text = a.textContent?.toLowerCase() ?? '';
    const absHref = href.startsWith('http') ? href : new URL(href, url).href;

    if (!seen.has(absHref) && jobKeywords.some((k) => absHref.toLowerCase().includes(k) || text.includes(k))) {
      seen.add(absHref);
      links.push(absHref);
    }
    if (links.length >= 20) break;
  }

  const targets = links.length > 0 ? links : [url];

  for (const link of targets) {
    try {
      await sleep(1000 + Math.random() * 500);
      const job = await extractJobFromPage(link, url);
      if (job) jobs.push(job);
    } catch { /* skip */ }
  }

  return jobs;
}

async function extractJobFromPage(url: string, baseUrl: string): Promise<Job | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': randomUserAgent() },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const root = parse(html);

  const titleSelectors = [
    'h1[class*="job"]', 'h1[class*="title"]', 'h1[class*="position"]',
    '.job-title', '.position-title', 'h1', 'h2',
  ];
  let title = '';
  for (const sel of titleSelectors) {
    const el = root.querySelector(sel);
    if (el?.textContent?.trim()) { title = el.textContent.trim(); break; }
  }
  if (!title || title.length < 2) return null;

  const hostname = new URL(baseUrl).hostname.replace('www.', '').split('.')[0];
  const company =
    root.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ??
    root.querySelector('[class*="company"], [class*="employer"]')?.textContent?.trim() ??
    hostname;

  const location =
    root.querySelector('[class*="location"], [itemprop="jobLocation"]')?.textContent?.trim() ?? '';

  const description = (
    root.querySelector('[class*="description"], [class*="job-desc"], main, article')?.textContent ??
    root.querySelector('body')?.textContent ?? ''
  ).trim().slice(0, 4000);

  const datePosted =
    root.querySelector('[datetime]')?.getAttribute('datetime') ??
    root.querySelector('time')?.textContent?.trim() ?? '';

  return buildJobFromRaw({
    title,
    company: company || hostname,
    location,
    description,
    datePostedText: datePosted,
    sourceUrl: url,
    source: 'Custom',
  });
}

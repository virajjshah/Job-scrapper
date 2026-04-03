import { NextRequest, NextResponse } from 'next/server';
import { chromium } from 'playwright';
import type { SearchFilters, ScrapeResult, JobSource } from '@/types/job';
import { scrapeLinkedIn } from '@/lib/scrapers/linkedin';
import { scrapeIndeed } from '@/lib/scrapers/indeed';
import { scrapeGlassdoor } from '@/lib/scrapers/glassdoor';
import { scrapeCustomUrl } from '@/lib/scrapers/custom';
import { deduplicateJobs } from '@/lib/deduplication';

export const maxDuration = 300; // 5-minute timeout for scraping

export async function POST(req: NextRequest) {
  const filters: SearchFilters = await req.json();
  const startTime = Date.now();

  const errors: Record<string, string | null> = {
    LinkedIn: null,
    Indeed: null,
    Glassdoor: null,
  };

  const totalBySource: Record<string, number> = {
    LinkedIn: 0,
    Indeed: 0,
    Glassdoor: 0,
  };

  let browser: import('playwright').Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1366,768',
      ],
    });

    const allJobs: import('@/types/job').Job[] = [];

    // Scrape all sources in parallel with individual error handling
    const [linkedInJobs, indeedJobs, glassdoorJobs] = await Promise.allSettled([
      scrapeLinkedIn(browser, filters),
      scrapeIndeed(browser, filters),
      scrapeGlassdoor(browser, filters),
    ]);

    if (linkedInJobs.status === 'fulfilled') {
      totalBySource.LinkedIn = linkedInJobs.value.length;
      allJobs.push(...linkedInJobs.value);
    } else {
      errors.LinkedIn = linkedInJobs.reason?.message ?? 'LinkedIn scraping failed';
    }

    if (indeedJobs.status === 'fulfilled') {
      totalBySource.Indeed = indeedJobs.value.length;
      allJobs.push(...indeedJobs.value);
    } else {
      errors.Indeed = indeedJobs.reason?.message ?? 'Indeed scraping failed';
    }

    if (glassdoorJobs.status === 'fulfilled') {
      totalBySource.Glassdoor = glassdoorJobs.value.length;
      allJobs.push(...glassdoorJobs.value);
    } else {
      errors.Glassdoor = glassdoorJobs.reason?.message ?? 'Glassdoor scraping failed';
    }

    // Scrape custom URLs sequentially
    for (const url of filters.customUrls.filter(Boolean)) {
      try {
        const customJobs = await scrapeCustomUrl(browser, url);
        const key = new URL(url).hostname;
        totalBySource[key] = customJobs.length;
        allJobs.push(...customJobs);
      } catch (err: unknown) {
        const key = url.slice(0, 30);
        errors[key] = (err as Error)?.message ?? 'Custom URL scraping failed';
      }
    }

    // Deduplicate — return all jobs; filtering happens client-side for blur-below UX
    const deduped = deduplicateJobs(allJobs);

    // Sort by date (newest first) as default
    deduped.sort((a, b) => {
      const ta = a.datePostedRaw instanceof Date ? a.datePostedRaw.getTime() : 0;
      const tb = b.datePostedRaw instanceof Date ? b.datePostedRaw.getTime() : 0;
      return tb - ta;
    });

    const result: ScrapeResult = {
      jobs: deduped,
      errors,
      totalBySource,
      totalDeduped: deduped.length,
      durationMs: Date.now() - startTime,
    };

    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: 'Scraping failed', message: (err as Error)?.message },
      { status: 500 }
    );
  } finally {
    if (browser) await browser.close();
  }
}

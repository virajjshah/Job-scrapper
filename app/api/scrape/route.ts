import { NextRequest, NextResponse } from 'next/server';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import type { SearchFilters, ScrapeResult } from '@/types/job';
import { scrapeLinkedIn } from '@/lib/scrapers/linkedin';
import { scrapeIndeed } from '@/lib/scrapers/indeed';
import { scrapeGlassdoor } from '@/lib/scrapers/glassdoor';
import { scrapeCustomUrl } from '@/lib/scrapers/custom';
import { deduplicateJobs } from '@/lib/deduplication';

export const maxDuration = 900; // 15 minutes — deep scraping takes time

/**
 * Launch Chromium in a way that works both locally (playwright installed)
 * and on Vercel/Lambda serverless (no system browsers available).
 * On Vercel: @sparticuz/chromium provides a minimal pre-built Chromium binary.
 * Locally: playwright-core falls back to the Playwright browser cache.
 */
async function launchBrowser(): Promise<Browser> {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-infobars',
    '--single-process',
    '--no-zygote',
    '--window-size=1366,768',
  ];

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    // Serverless: use @sparticuz/chromium which ships its own binary
    const chromiumBin = (await import('@sparticuz/chromium')).default;
    chromiumBin.setGraphicsMode = false;
    return chromium.launch({
      args: [...chromiumBin.args, ...args],
      executablePath: await chromiumBin.executablePath(),
      headless: true,
    });
  }

  // Local dev: use the Playwright-installed Chromium
  return chromium.launch({ headless: true, args });
}

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

  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();

    const allJobs: import('@/types/job').Job[] = [];

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

    const deduped = deduplicateJobs(allJobs);

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

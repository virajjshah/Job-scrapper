import { NextRequest, NextResponse } from 'next/server';
import type { SearchFilters, ScrapeResult } from '@/types/job';
import { scrapeLinkedIn } from '@/lib/scrapers/linkedin';
import { scrapeIndeed } from '@/lib/scrapers/indeed';
import { scrapeGlassdoor } from '@/lib/scrapers/glassdoor';
import { scrapeCustomUrl } from '@/lib/scrapers/custom';
import { deduplicateJobs } from '@/lib/deduplication';

export const maxDuration = 300;

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

  // All scrapers use fetch — no browser binary needed, works on any platform
  const [linkedInJobs, indeedJobs, glassdoorJobs] = await Promise.allSettled([
    scrapeLinkedIn(filters),
    scrapeIndeed(filters),
    scrapeGlassdoor(filters),
  ]);

  const allJobs: import('@/types/job').Job[] = [];

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

  const deduped = deduplicateJobs(allJobs);

  deduped.sort((a, b) => {
    // Fresh jobs above reposted
    if (a.isReposted !== b.isReposted) return a.isReposted ? 1 : -1;
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
}

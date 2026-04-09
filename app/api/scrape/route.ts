import { NextRequest, NextResponse } from 'next/server';
import type { SearchFilters, ScrapeResult } from '@/types/job';
import { scrapeLinkedIn } from '@/lib/scrapers/linkedin';
import { scrapeCustomUrl } from '@/lib/scrapers/custom';
import { deduplicateJobs } from '@/lib/deduplication';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const filters: SearchFilters = await req.json();
  const startTime = Date.now();

  const errors: Record<string, string | null> = {
    LinkedIn: null,
  };

  const totalBySource: Record<string, number> = {
    LinkedIn: 0,
  };

  const [linkedInResult] = await Promise.allSettled([
    scrapeLinkedIn(filters),
  ]);

  const allJobs: import('@/types/job').Job[] = [];

  if (linkedInResult.status === 'fulfilled') {
    totalBySource.LinkedIn = linkedInResult.value.length;
    allJobs.push(...linkedInResult.value);
  } else {
    errors.LinkedIn = linkedInResult.reason?.message ?? 'LinkedIn scraping failed';
  }

  // Custom URLs (if provided)
  if (filters.customUrls?.length > 0) {
    const customResults = await Promise.allSettled(
      filters.customUrls.map((url) => scrapeCustomUrl(url))
    );
    for (const r of customResults) {
      if (r.status === 'fulfilled') allJobs.push(...r.value);
    }
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

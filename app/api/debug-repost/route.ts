import { NextResponse } from 'next/server';

// Debug endpoint: fetches raw LinkedIn guest API HTML and returns
// card snippets + any "repost" related content found.
// Usage: GET /api/debug-repost
// DELETE THIS ROUTE BEFORE PRODUCTION — debug only
export async function GET() {
  const url =
    'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=Data+Analyst&location=Toronto%2C+Ontario%2C+Canada&start=0';

  let html = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-CA,en;q=0.9',
        Referer: 'https://www.linkedin.com/jobs/search/',
      },
      signal: AbortSignal.timeout(20000),
    });
    html = await res.text();
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }

  // Find all occurrences of "repost" (case-insensitive) with 120 chars of context
  const repostMatches: string[] = [];
  const re = /repost/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const start = Math.max(0, m.index - 60);
    const end = Math.min(html.length, m.index + 80);
    repostMatches.push(html.substring(start, end));
  }

  // Extract class names that contain posted/listed/date/repost/time
  const classMatches = new Set<string>();
  const classRe = /class="([^"]*)"/g;
  while ((m = classRe.exec(html)) !== null) {
    const classes = m[1].split(/\s+/);
    for (const c of classes) {
      if (/posted|listed|date|repost|time/i.test(c)) classMatches.add(c);
    }
  }

  // Extract all <time> elements with their full content
  const timeEls: string[] = [];
  const timeRe = /<time[^>]*>[\s\S]*?<\/time>/gi;
  while ((m = timeRe.exec(html)) !== null) {
    timeEls.push(m[0]);
  }

  // First 3 full <li> blocks
  const liBlocks: string[] = [];
  const liRe = /<li[^>]*>[\s\S]*?<\/li>/gi;
  let liCount = 0;
  while ((m = liRe.exec(html)) !== null && liCount < 3) {
    liBlocks.push(m[0].substring(0, 2000)); // cap at 2000 chars each
    liCount++;
  }

  return NextResponse.json({
    totalBytes: html.length,
    repostMatchCount: repostMatches.length,
    repostContexts: repostMatches,
    relevantClassNames: Array.from(classMatches),
    timeElements: timeEls,
    firstThreeLiBlocks: liBlocks,
  });
}

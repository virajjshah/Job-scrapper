import type { Browser, Page } from 'playwright';
import type { Job, SearchFilters } from '@/types/job';
import { buildJobFromRaw, randomUserAgent, sleep, withRetry } from './utils';

export async function scrapeGlassdoor(browser: Browser, filters: SearchFilters): Promise<Job[]> {
  const jobs: Job[] = [];
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({
      'User-Agent': randomUserAgent(),
      'Accept-Language': 'en-CA,en;q=0.9',
    });

    const location = encodeURIComponent(filters.location || 'Toronto, Ontario');
    const keywords = encodeURIComponent(filters.keywords);
    // fromAge: days since posted (0 = any)
    const fromAge = filters.datePostedDays > 0 ? filters.datePostedDays : -1;
    const searchUrl =
      `https://www.glassdoor.ca/Job/jobs.htm?sc.keyword=${keywords}` +
      `&locT=C&locId=&locKeyword=${location}` +
      `&jobType=all&fromAge=${fromAge}` +
      `&minSalary=0&includeNoSalaryJobs=true&radius=25` +
      `&cityId=-1&minRating=0.0&industryId=-1&sgocId=-1` +
      `&seniorityType=all&companyId=-1&employerSizes=0` +
      `&applicationType=0&remoteWorkType=0`;

    await withRetry(async () => {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    });

    await sleep(2500 + Math.random() * 1000);

    // Dismiss login modal
    await page.evaluate(() => {
      document.querySelectorAll('[class*="modal"], [class*="Modal"]').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
      document.querySelectorAll('[class*="overlay"], [class*="Overlay"]').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
    });

    const jobCards = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('[data-test="jobListing"], li[class*="JobsList"], [class*="react-job-listing"]')
      );
      return cards.slice(0, 25).map((card) => {
        const titleEl = card.querySelector(
          '[data-test="job-link"], a[class*="JobCard"], a[data-test="job-title"]'
        );
        const title = titleEl?.textContent?.trim() ?? '';
        const href = (titleEl as HTMLAnchorElement)?.href ?? '';
        const company =
          card.querySelector('[class*="EmployerProfile"], [data-test="employer-name"], [class*="employer"]')
            ?.textContent?.trim() ?? '';
        const location =
          card.querySelector('[data-test="emp-location"], [class*="location"]')?.textContent?.trim() ?? '';
        const salary =
          card.querySelector('[data-test="detailSalary"], [class*="salary"]')?.textContent?.trim() ?? '';
        const datePosted =
          card.querySelector('[data-test="listing-age"], [class*="age"]')?.textContent?.trim() ?? '';
        const isReposted = /\breposted\b/i.test(card.textContent ?? '');
        return { title, href, company, location, salary, datePosted, isReposted };
      });
    });

    for (const card of jobCards) {
      if (!card.title || !card.company) continue;
      try {
        await sleep(1500 + Math.random() * 1000);
        const fullUrl = card.href.startsWith('http')
          ? card.href
          : `https://www.glassdoor.ca${card.href}`;
        const job = await scrapeGlassdoorJob(page, fullUrl, {
          title: card.title,
          company: card.company,
          location: card.location,
          datePosted: card.datePosted,
          salaryHint: card.salary,
          isReposted: card.isReposted,
        });
        if (job) jobs.push(job);
      } catch {
        // Skip individual job errors
      }
    }
  } finally {
    await page.close();
  }

  return jobs;
}

async function scrapeGlassdoorJob(
  page: Page,
  url: string,
  fallback: {
    title: string;
    company: string;
    location: string;
    datePosted: string;
    salaryHint: string;
    isReposted: boolean;
  }
): Promise<Job | null> {
  try {
    await withRetry(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    });

    await sleep(1000);

    await page.evaluate(() => {
      document.querySelectorAll('[class*="modal"], [class*="Modal"], [class*="LoginModal"]').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
    });

    const data = await page.evaluate(() => {
      const description =
        document.querySelector('[class*="JobDetails"], [data-test="job-description"], .desc')
          ?.textContent?.trim() ?? '';
      const salary =
        document.querySelector('[data-test="salaryEstimate"], [class*="salary"]')?.textContent?.trim() ?? '';
      const empType =
        document.querySelector('[class*="JobDetails"] [class*="JobTypeList"]')?.textContent?.trim() ?? '';
      // Glassdoor external apply button
      const applyBtn = document.querySelector(
        'a[data-test="applyButton"], a[class*="applyButton"], a[href*="apply"]:not([href*="glassdoor"])'
      ) as HTMLAnchorElement | null;
      const applyUrl = applyBtn?.href ?? null;
      const isReposted = /\breposted\b/i.test(document.body.innerText?.slice(0, 1000) ?? '');
      return { description, salary, empType, applyUrl, isReposted };
    });

    const descriptionWithSalary = `${data.salary} ${fallback.salaryHint} ${data.description}`.trim();

    return buildJobFromRaw({
      title: fallback.title,
      company: fallback.company,
      location: fallback.location,
      description: descriptionWithSalary,
      datePostedText: fallback.datePosted,
      sourceUrl: url,
      source: 'Glassdoor',
      employmentTypeText: data.empType,
      applyUrl: data.applyUrl,
      isReposted: fallback.isReposted || data.isReposted,
    });
  } catch {
    return buildJobFromRaw({
      title: fallback.title,
      company: fallback.company,
      location: fallback.location,
      description: fallback.salaryHint,
      datePostedText: fallback.datePosted,
      sourceUrl: url,
      source: 'Glassdoor',
      isReposted: fallback.isReposted,
    });
  }
}

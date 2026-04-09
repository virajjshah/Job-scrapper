'use client';

import { useState, useCallback, useEffect } from 'react';
import { SearchPanel } from '@/components/SearchPanel';
import { ResultsTable } from '@/components/ResultsTable';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import type { ScrapeResult, SearchFilters } from '@/types/job';
import { DEFAULT_FILTERS } from '@/types/job';
import { Briefcase, AlertCircle, X, CheckCircle, Search, Moon, Sun } from 'lucide-react';

type ToastState = { type: 'success' | 'error'; message: string } | null;

export default function HomePage() {
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [lastKeywords, setLastKeywords] = useState('');
  const [lastFilters, setLastFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  };

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileFiltersOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileFiltersOpen]);

  const handleSearch = useCallback(async (filters: SearchFilters) => {
    setIsLoading(true);
    setResult(null);
    setLastKeywords(filters.keywords);
    setLastFilters(filters);
    setMobileFiltersOpen(false);

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(err.message ?? 'Scraping failed');
      }

      const data: ScrapeResult = await res.json();
      setResult(data);

      const totalFound = data.jobs.length;
      const sources = Object.entries(data.totalBySource)
        .filter(([, n]) => n > 0)
        .map(([s]) => s)
        .join(', ');

      setToast({
        type: 'success',
        message: `Found ${totalFound} jobs across ${sources || 'all sources'}`,
      });
    } catch (err: unknown) {
      setToast({ type: 'error', message: (err as Error)?.message ?? 'Scraping failed. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleExport = useCallback(() => {
    if (!result?.jobs.length) return;

    const headers = [
      'Job Title', 'Company', 'Location', 'Work Type', 'Salary',
      'Salary Min (CAD)', 'Salary Max (CAD)', 'Yrs Experience',
      'Employment Type', 'Industry', 'Date Posted', 'Source',
      'Reposted', 'Apply / View Link',
    ];

    const rows = result.jobs.map((job) => [
      job.title,
      job.company,
      job.location,
      job.workType,
      job.salaryDisplay,
      job.salary?.min ?? '',
      job.salary?.max ?? '',
      job.yearsExperienceDisplay,
      job.employmentType ?? '',
      job.industry ?? '',
      job.datePosted,
      job.source,
      job.isReposted ? 'Yes' : 'No',
      job.applyUrl ?? job.sourceUrl,
    ]);

    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jobs-${(lastKeywords || 'search').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setToast({ type: 'success', message: `Exported ${result.jobs.length} jobs to CSV` });
  }, [result, lastKeywords]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm z-20 sticky top-0">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Briefcase size={18} className="text-white" />
            </div>
            <h1 className="text-base font-bold text-gray-900 dark:text-gray-100 leading-none">Job Scraper</h1>
          </div>

          <span
            className="text-xs px-2 py-0.5 rounded-full text-white font-medium flex-shrink-0"
            style={{ backgroundColor: '#0077B5' }}
          >
            LinkedIn
          </span>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400">
              No login required · Public data only
            </span>
            {/* Theme toggle — always visible in header */}
            <button
              onClick={toggleTheme}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 flex items-center justify-center transition-all hover:scale-110 active:scale-95"
            >
              {dark
                ? <Sun size={16} className="text-yellow-400" />
                : <Moon size={16} className="text-gray-500" />}
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile filter bottom-sheet drawer ─────────────────────────── */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileFiltersOpen(false)}
          />
          {/* Drawer */}
          <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl max-h-[92dvh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Search &amp; Filters</h2>
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center active:bg-gray-200 dark:active:bg-gray-700"
                aria-label="Close filters"
              >
                <X size={16} className="text-gray-600 dark:text-gray-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <SearchPanel onSearch={handleSearch} isLoading={isLoading} />
            </div>
          </div>
        </div>
      )}

      {/* ── Main layout ───────────────────────────────────────────────── */}
      <div className="flex flex-1 max-w-screen-2xl mx-auto w-full">
        {/* Sidebar — desktop only */}
        <aside className="hidden md:flex w-80 min-w-[280px] max-w-xs flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex-col">
          <div className="flex-1 p-4 overflow-y-auto">
            <SearchPanel onSearch={handleSearch} isLoading={isLoading} />
          </div>
        </aside>

        {/* Main content */}
        {/* pb-24 on mobile reserves space above the fixed bottom search bar */}
        <main className="flex-1 flex flex-col md:overflow-hidden p-3 md:p-4 gap-3 md:gap-4 min-w-0 bg-gray-50 dark:bg-gray-950 pb-24 md:pb-4">
          {isLoading && <LoadingSpinner />}
          {!isLoading && !result && <EmptyState />}
          {!isLoading && result && (
            <ResultsTable
              jobs={result.jobs}
              totalBySource={result.totalBySource}
              totalDeduped={result.totalDeduped}
              errors={result.errors}
              durationMs={result.durationMs}
              filters={lastFilters}
              onExport={handleExport}
            />
          )}
        </main>
      </div>

      {/* Footer — desktop only (bottom bar takes that space on mobile) */}
      <footer className="hidden md:block text-center py-3 text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
        Made with ❤️ by{' '}
        <a
          href="https://www.linkedin.com/in/viraj-irl/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          Viraj Shah
        </a>
      </footer>

      {/* ── Mobile: fixed bottom search bar ───────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-3 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.3)]">
        <button
          onClick={() => setMobileFiltersOpen(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 bg-gray-100 dark:bg-gray-800 rounded-2xl text-left border border-gray-200 dark:border-gray-700 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
          aria-label="Open search and filters"
        >
          <Search size={18} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <div className="flex-1 min-w-0 overflow-hidden">
            <span className={`block truncate text-sm ${lastKeywords ? 'text-gray-800 dark:text-gray-200 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
              {lastKeywords || 'Job title, keywords…'}
            </span>
            {lastKeywords && lastFilters.location && (
              <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                {lastFilters.location}
              </span>
            )}
          </div>
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 flex-shrink-0">
            {lastKeywords ? 'Edit' : 'Search'}
          </span>
        </button>
      </div>

      {/* ── Toast notification ────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-24 md:bottom-5 left-4 right-4 md:left-auto md:right-5 md:max-w-sm z-50 flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm ${
            toast.type === 'success'
              ? 'bg-white dark:bg-gray-800 border-green-200 dark:border-green-800 text-gray-800 dark:text-gray-100'
              : 'bg-white dark:bg-gray-800 border-red-200 dark:border-red-800 text-gray-800 dark:text-gray-100'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle size={18} className="text-green-500 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p>{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0 p-1">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

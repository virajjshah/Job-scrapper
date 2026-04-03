'use client';

import { useState, useCallback, useEffect } from 'react';
import { SearchPanel } from '@/components/SearchPanel';
import { ResultsTable } from '@/components/ResultsTable';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import type { ScrapeResult, SearchFilters } from '@/types/job';
import { Briefcase, AlertCircle, X, CheckCircle, ExternalLink } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

type ToastState = { type: 'success' | 'error'; message: string; url?: string } | null;

export default function HomePage() {
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [lastKeywords, setLastKeywords] = useState('');

  // Handle Google OAuth callback tokens in URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const at = params.get('access_token');
    const rt = params.get('refresh_token');
    if (at) {
      sessionStorage.setItem('google_access_token', at);
      if (rt) sessionStorage.setItem('google_refresh_token', rt);
      // Clean URL
      window.history.replaceState({}, '', '/');
      setToast({ type: 'success', message: 'Google account connected! You can now export to Sheets.' });
    }
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSearch = useCallback(async (filters: SearchFilters) => {
    setIsLoading(true);
    setResult(null);
    setLastKeywords(filters.keywords);

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

  const handleExport = useCallback(async () => {
    if (!result?.jobs.length) return;

    const accessToken = sessionStorage.getItem('google_access_token');
    if (!accessToken) {
      // Initiate OAuth flow
      window.location.href = '/api/auth/google';
      return;
    }

    setIsExporting(true);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobs: result.jobs,
          keywords: lastKeywords,
          accessToken,
          refreshToken: sessionStorage.getItem('google_refresh_token'),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Export failed' }));
        throw new Error(err.message);
      }

      const { spreadsheetUrl, sheetName } = await res.json();
      setToast({
        type: 'success',
        message: `Exported to "${sheetName}"`,
        url: spreadsheetUrl,
      });
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? 'Export failed';
      if (msg.includes('invalid_grant') || msg.includes('401')) {
        sessionStorage.removeItem('google_access_token');
        sessionStorage.removeItem('google_refresh_token');
        setToast({ type: 'error', message: 'Google session expired. Click Export again to reconnect.' });
      } else {
        setToast({ type: 'error', message: msg });
      }
    } finally {
      setIsExporting(false);
    }
  }, [result, lastKeywords]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm z-20 sticky top-0">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Briefcase size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 dark:text-gray-100 leading-none">Job Scraper</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-none mt-0.5">Toronto / GTA</p>
            </div>
          </div>
          <div className="flex gap-2 ml-4">
            {['LinkedIn', 'Indeed', 'Glassdoor'].map((src) => (
              <span
                key={src}
                className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                style={{
                  backgroundColor:
                    src === 'LinkedIn' ? '#0077B5' : src === 'Indeed' ? '#2164F3' : '#0CAA41',
                }}
              >
                {src}
              </span>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="hidden sm:inline">No login required · Public data only</span>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 max-w-screen-2xl mx-auto w-full">
        {/* Sidebar */}
        <aside className="w-80 min-w-[280px] max-w-xs flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="flex-1 p-4 overflow-y-auto">
            <SearchPanel onSearch={handleSearch} isLoading={isLoading} />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden p-4 gap-4 min-w-0 bg-gray-50 dark:bg-gray-950">
          {isLoading && <LoadingSpinner />}

          {!isLoading && !result && <EmptyState />}

          {!isLoading && result && (
            <ResultsTable
              jobs={result.jobs}
              totalBySource={result.totalBySource}
              totalDeduped={result.totalDeduped}
              errors={result.errors}
              durationMs={result.durationMs}
              onExport={handleExport}
              isExporting={isExporting}
            />
          )}
        </main>
      </div>

      <ThemeToggle />

      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border max-w-sm text-sm animate-in slide-in-from-bottom-2 ${
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
            {toast.url && (
              <a
                href={toast.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-green-700 hover:underline font-medium mt-1"
              >
                Open Spreadsheet <ExternalLink size={12} />
              </a>
            )}
          </div>
          <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

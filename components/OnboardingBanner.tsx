'use client';

import { useState, useEffect } from 'react';
import { X, Search, SlidersHorizontal, Zap, CheckCircle2 } from 'lucide-react';

const STORAGE_KEY = 'ck_onboarding_dismissed';

export function OnboardingBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch { /* ignore */ }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
  };

  if (!visible) return null;

  return (
    <div className="relative bg-white dark:bg-gray-900 border border-blue-100 dark:border-blue-900/50 rounded-xl p-5 shadow-sm">
      <button
        onClick={dismiss}
        aria-label="Dismiss onboarding"
        className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <X size={16} />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-md flex items-center justify-center flex-shrink-0">
          <Zap size={14} className="text-white fill-white" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-none">
            Welcome to Career Katalyst
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Smarter job hunting, powered by live data
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* How it works */}
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            How it works
          </p>
          <ol className="space-y-2">
            {[
              { icon: Search, label: 'Enter keywords', detail: 'e.g. "Data Analyst", "Product Manager"' },
              { icon: SlidersHorizontal, label: 'Set your filters', detail: 'salary range, work type, experience' },
              { icon: Zap, label: 'Hit Search Jobs', detail: 'live LinkedIn results in under a minute' },
            ].map(({ icon: Icon, label, detail }, i) => (
              <li key={label} className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{label}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">: {detail}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Why it's better */}
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Why it&apos;s better
          </p>
          <ul className="space-y-1.5">
            {[
              'Completely free, no sign-up needed',
              'Deduplicates listings automatically',
              'Parses salary & experience from descriptions',
              'Export results to CSV',
            ].map((text) => (
              <li key={text} className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                <span className="text-xs text-gray-600 dark:text-gray-300">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <button
        onClick={dismiss}
        className="mt-4 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
      >
        Got it, don&apos;t show again
      </button>
    </div>
  );
}

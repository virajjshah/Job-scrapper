'use client';

export function LoadingSpinner({ message = 'Scraping jobs…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-gray-200 dark:border-gray-700" />
        <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-gray-700 dark:text-gray-200 font-semibold text-base">{message}</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
          Searching LinkedIn, Indeed &amp; Glassdoor — this may take 1–2 minutes
        </p>
      </div>
      <div className="flex gap-3 mt-2">
        {['LinkedIn', 'Indeed', 'Glassdoor'].map((src, i) => (
          <span
            key={src}
            className="px-3 py-1 rounded-full text-xs font-medium text-white animate-pulse"
            style={{
              backgroundColor: src === 'LinkedIn' ? '#0077B5' : src === 'Indeed' ? '#2164F3' : '#0CAA41',
              animationDelay: `${i * 0.3}s`,
            }}
          >
            {src}
          </span>
        ))}
      </div>
    </div>
  );
}

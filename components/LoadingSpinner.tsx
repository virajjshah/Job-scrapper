'use client';

export function LoadingSpinner({ message = 'Scraping jobs\u2026' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      {/* 3D coin-flip animation — front: logo, back: brand gradient */}
      <div className="coin-scene">
        <div className="coin">
          {/* Front face — logo */}
          <div className="coin-face">
            <img
              src="/logo.svg"
              alt="Career Katalyst"
              className="w-full h-full object-cover rounded-full"
              draggable={false}
            />
          </div>
          {/* Back face — brand gradient with spark icon */}
          <div className="coin-face coin-face--back">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        </div>
      </div>

      <div className="text-center">
        <p className="text-gray-700 dark:text-gray-200 font-semibold text-base">{message}</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
          Searching LinkedIn. This may take up to a minute.
        </p>
        <p className="text-gray-300 dark:text-gray-600 text-xs mt-3 italic">
          Results are scraped live. Salary, experience, and repost data may not always be accurate.
        </p>
      </div>

      <div className="flex gap-3 mt-2">
        <span
          className="px-3 py-1 rounded-full text-xs font-medium text-white animate-pulse"
          style={{ backgroundColor: '#0077B5' }}
        >
          LinkedIn
        </span>
      </div>
    </div>
  );
}

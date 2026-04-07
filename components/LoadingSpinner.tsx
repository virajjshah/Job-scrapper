'use client';

/**
 * CK logo recreated as inline SVG — Career Katalyst brand mark.
 * A bold green "C" arc on the left + a teal "K" with a northeast
 * corner-arrow on the right, both sharing a dark-green → teal gradient.
 */
function CKLogo({ size = 88 }: { size?: number }) {
  // viewBox is 330 × 270; keep aspect ratio
  const height = Math.round((size * 270) / 330);
  return (
    <svg
      viewBox="0 0 330 270"
      width={size}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      aria-label="Career Katalyst logo"
    >
      <defs>
        <linearGradient id="ckGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#1b7c3d" />
          <stop offset="55%"  stopColor="#0ea86a" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
      </defs>

      {/* ── C: bold arc, gap on the right ── */}
      {/*  Center (105, 133), radius 82, gap ±45° from horizontal-right */}
      {/*  Top of gap:    (163, 75)  = 105+82·cos(-45°), 133+82·sin(-45°) */}
      {/*  Bottom of gap: (163, 191) = 105+82·cos(+45°), 133+82·sin(+45°) */}
      <path
        d="M 163,75 A 85,85 0 1 0 163,191"
        stroke="url(#ckGrad)"
        strokeWidth="46"
        strokeLinecap="round"
      />

      {/* ── K lower leg: down-left from junction ── */}
      <line
        x1="196" y1="147"
        x2="163" y2="252"
        stroke="url(#ckGrad)"
        strokeWidth="42"
        strokeLinecap="round"
      />

      {/* ── K upper arm: up-right toward arrow corner ── */}
      <line
        x1="196" y1="147"
        x2="267" y2="63"
        stroke="url(#ckGrad)"
        strokeWidth="42"
        strokeLinecap="butt"
      />

      {/* ── Arrow: horizontal arm (going right) ── */}
      <line
        x1="258" y1="58"
        x2="314" y2="58"
        stroke="url(#ckGrad)"
        strokeWidth="42"
        strokeLinecap="round"
      />

      {/* ── Arrow: vertical arm (going up) ── */}
      <line
        x1="314" y1="63"
        x2="314" y2="10"
        stroke="url(#ckGrad)"
        strokeWidth="42"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoadingSpinner({ message = 'Scraping jobs…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      {/* Coin-flip logo — perspective set on wrapper so rotateY creates depth */}
      <div style={{ perspective: '600px' }}>
        <div className="animate-coin-flip">
          <CKLogo size={90} />
        </div>
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

'use client';

import { useCallback } from 'react';

interface DualSliderProps {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  formatLabel?: (v: number) => string;
  label: string;
}

export function DualSlider({ min, max, step = 1, value, onChange, formatLabel, label }: DualSliderProps) {
  const [lo, hi] = value;

  const handleLo = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      onChange([Math.min(v, hi), hi]);
    },
    [hi, onChange]
  );

  const handleHi = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      onChange([lo, Math.max(v, lo)]);
    },
    [lo, onChange]
  );

  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  // When lo is in the upper half of the range, bring it to front so it can
  // be dragged left without the hi thumb intercepting. This is the standard
  // fix for overlapping range inputs.
  const loZ = lo > (min + max) / 2 ? 4 : 2;
  const hiZ = lo > (min + max) / 2 ? 2 : 4;

  const thumbCls =
    'absolute w-full h-1.5 appearance-none bg-transparent cursor-pointer ' +
    // Disable pointer-events on the whole element; re-enable only on the thumb.
    // This allows the *other* thumb to receive events when they overlap.
    '[pointer-events:none] ' +
    '[&::-webkit-slider-thumb]:[pointer-events:all] ' +
    '[&::-moz-range-thumb]:[pointer-events:all] ' +
    '[&::-webkit-slider-thumb]:appearance-none ' +
    '[&::-webkit-slider-thumb]:h-4 ' +
    '[&::-webkit-slider-thumb]:w-4 ' +
    '[&::-webkit-slider-thumb]:rounded-full ' +
    '[&::-webkit-slider-thumb]:bg-blue-600 ' +
    '[&::-webkit-slider-thumb]:border-2 ' +
    '[&::-webkit-slider-thumb]:border-white ' +
    '[&::-webkit-slider-thumb]:shadow ' +
    '[&::-moz-range-thumb]:h-4 ' +
    '[&::-moz-range-thumb]:w-4 ' +
    '[&::-moz-range-thumb]:rounded-full ' +
    '[&::-moz-range-thumb]:bg-blue-600 ' +
    '[&::-moz-range-thumb]:border-2 ' +
    '[&::-moz-range-thumb]:border-white ' +
    '[&::-moz-range-thumb]:border-solid';

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>{formatLabel ? formatLabel(lo) : lo}</span>
        <span className={hi >= max ? 'text-base font-semibold' : ''}>
          {formatLabel ? formatLabel(hi) : hi}
        </span>
      </div>
      <div className="relative h-5 flex items-center">
        {/* Track */}
        <div className="absolute w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full" />
        {/* Filled range */}
        <div
          className="absolute h-1.5 bg-blue-500 rounded-full pointer-events-none"
          style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
        />
        {/* Low thumb — z-index swaps based on position */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={handleLo}
          aria-label={`${label} minimum`}
          style={{ zIndex: loZ }}
          className={thumbCls}
        />
        {/* High thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          onChange={handleHi}
          aria-label={`${label} maximum`}
          style={{ zIndex: hiZ }}
          className={thumbCls}
        />
      </div>
    </div>
  );
}

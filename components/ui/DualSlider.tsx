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

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{formatLabel ? formatLabel(lo) : lo}</span>
        <span>{formatLabel ? formatLabel(hi) : hi}{hi >= max ? '+' : ''}</span>
      </div>
      <div className="relative h-5 flex items-center">
        {/* Track */}
        <div className="absolute w-full h-1.5 bg-gray-200 rounded-full" />
        {/* Filled range */}
        <div
          className="absolute h-1.5 bg-blue-500 rounded-full"
          style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
        />
        {/* Low thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={handleLo}
          aria-label={`${label} minimum`}
          className="absolute w-full h-1.5 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
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
          className="absolute w-full h-1.5 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
        />
      </div>
    </div>
  );
}

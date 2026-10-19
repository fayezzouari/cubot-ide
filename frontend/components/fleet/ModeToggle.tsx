'use client';

import type { BrokerMode } from '@/lib/fleet/types';

export function ModeToggle({ mode, onChange, disabled }: { mode: BrokerMode; onChange: (mode: BrokerMode) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-md border border-white/[0.08] p-0.5">
      {(['simulated', 'live'] as const).map((m) => (
        <button
          key={m}
          onClick={() => m !== mode && onChange(m)}
          disabled={disabled}
          title={m === 'live' ? 'Real vehicles publish their own telemetry' : 'The browser simulates the fleet'}
          className={`rounded px-2 py-1 text-[11px] capitalize transition-colors disabled:opacity-40 ${
            mode === m
              ? m === 'live'
                ? 'bg-orange-400/15 text-orange-300'
                : 'bg-white/[0.08] text-white'
              : 'text-white/45 hover:text-white/75'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

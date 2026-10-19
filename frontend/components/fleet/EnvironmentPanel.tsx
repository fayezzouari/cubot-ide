'use client';

import { Box, Check, Image as ImageIcon, Square } from 'lucide-react';
import type { Environment } from '@/lib/fleet/types';
import type { EnvironmentUpdate } from '@/lib/api/fleet';
import { BACKGROUND_PRESETS } from '@/lib/fleet/constants';
import { PanelShell } from './PanelShell';
import { labelCls } from './theme';

interface Props {
  environment: Environment;
  onSave: (body: EnvironmentUpdate) => Promise<void>;
}

export function EnvironmentPanel({ environment, onSave }: Props) {
  const active = environment.background;

  return (
    <PanelShell title="Environment" icon={<ImageIcon size={12} />}>
      <div className="space-y-4 p-3">
        <div>
          <div className={`${labelCls} mb-2`}>Grid</div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-white/60">
            <span className="inline-flex items-center gap-1">
              {environment.dimension === '3d' ? <Box size={12} /> : <Square size={12} />}
              {environment.dimension.toUpperCase()}
            </span>
            <span>
              {environment.width} × {environment.height}
              {environment.dimension === '3d' ? ` × ${environment.depth}` : ''} cells
            </span>
          </div>
        </div>
        <div>
          <div className={`${labelCls} mb-2`}>Floor preset</div>
          <ul className="grid grid-cols-2 gap-2 @max-[220px]:grid-cols-1">
            {BACKGROUND_PRESETS.map((preset) => {
              const selected = preset.id === active;
              return (
                <li key={preset.id}>
                  <button
                    onClick={() => void onSave({ background: preset.id })}
                    className={`flex w-full flex-col items-start gap-1.5 rounded-md border px-2 py-2 text-left transition-colors ${
                      selected ? 'border-white/40 bg-white/[0.04]' : 'border-white/[0.08] hover:border-white/20'
                    }`}
                    title={preset.label}
                  >
                    <span
                      className="relative flex h-10 w-full items-center justify-center rounded border border-white/[0.06]"
                      style={{ background: `linear-gradient(135deg, ${preset.surface} 0%, ${preset.swatch} 100%)` }}
                    >
                      {selected && <Check size={14} className="text-white/80" />}
                    </span>
                    <span className="text-[11px] text-white/70">{preset.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </PanelShell>
  );
}

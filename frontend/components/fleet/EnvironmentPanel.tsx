'use client';

import { useEffect, useState } from 'react';
import { Box, Check, Image as ImageIcon, Square } from 'lucide-react';
import type { Environment } from '@/lib/fleet/types';
import type { EnvironmentUpdate } from '@/lib/api/fleet';
import { BACKGROUND_PRESETS } from '@/lib/fleet/constants';
import { PanelShell } from './PanelShell';
import { labelCls } from './theme';

const MAX_CELLS = 200;

function clampCells(value: string): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_CELLS, Math.max(1, n)) : 1;
}

interface Props {
  environment: Environment;
  onSave: (body: EnvironmentUpdate) => Promise<void>;
}

export function EnvironmentPanel({ environment, onSave }: Props) {
  const active = environment.background;
  const is3d = environment.dimension === '3d';
  const [size, setSize] = useState({ width: environment.width, height: environment.height, depth: environment.depth });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSize({ width: environment.width, height: environment.height, depth: environment.depth });
  }, [environment.width, environment.height, environment.depth]);

  const dirty =
    size.width !== environment.width || size.height !== environment.height || (is3d && size.depth !== environment.depth);

  const applySize = async () => {
    setSaving(true);
    try {
      await onSave(is3d ? size : { width: size.width, height: size.height });
    } finally {
      setSaving(false);
    }
  };

  const fields: { key: keyof typeof size; label: string }[] = [
    { key: 'width', label: 'W' },
    { key: 'height', label: 'H' },
    ...(is3d ? [{ key: 'depth' as const, label: 'D' }] : []),
  ];

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
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {fields.map(({ key, label }) => (
              <label key={key} className="inline-flex items-center gap-1 font-mono text-[10px] text-white/40">
                {label}
                <input
                  type="number"
                  min={1}
                  max={MAX_CELLS}
                  value={size[key]}
                  onChange={(e) => setSize((prev) => ({ ...prev, [key]: clampCells(e.target.value) }))}
                  onKeyDown={(e) => e.key === 'Enter' && dirty && !saving && void applySize()}
                  className="h-7 w-14 rounded border border-white/[0.1] bg-transparent px-1.5 text-[11px] text-white/80 focus:border-white/30 focus:outline-none"
                />
              </label>
            ))}
            <button
              onClick={() => void applySize()}
              disabled={!dirty || saving}
              className="inline-flex h-7 items-center rounded-md bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              title="Resize the grid. Obstacles are kept; new cells are free."
            >
              {saving ? 'Resizing…' : 'Resize'}
            </button>
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

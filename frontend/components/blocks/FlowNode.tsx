'use client';

// Canvas node for every block type. Layout follows NODE_METRICS in the
// registry so auto-layout knows each node's height:
//
//   header   icon · label · status
//   fields   the most relevant fields, editable in place
//   outputs  labelled branch handles (if, loops)
//
// Start and End render as compact pills.

import { createContext, memo, useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, X } from 'lucide-react';
import { BLOCK_BY_TYPE, CATEGORY_BY_ID, inlineFields, NODE_METRICS } from '@/lib/blocks/registry';
import type { Problem } from '@/lib/blocks/compiler';
import type { FieldDef, Pose } from '@/lib/blocks/types';
import { blockIcon } from './blockIcons';

export interface BlocksCanvasState {
  activeNodeId: string | null;
  problemsByNode: Map<string, Problem[]>;
  onDelete: (id: string) => void;
  onFieldChange: (id: string, key: string, value: string | number) => void;
  poses: Pose[];
  running: boolean;
}

export const BlocksCanvasContext = createContext<BlocksCanvasState>({
  activeNodeId: null,
  problemsByNode: new Map(),
  onDelete: () => {},
  onFieldChange: () => {},
  poses: [],
  running: false,
});

const OUTPUT_COLORS: Record<string, string> = { true: '#4ade80', false: '#f87171', body: '#a78bfa' };

// `nodrag nopan nowheel` keep React Flow from treating input gestures as
// canvas drags, pans or zooms.
const inputCls =
  'nodrag nopan nowheel h-[20px] min-w-0 flex-1 rounded border border-white/[0.08] bg-black/40 px-1.5 font-mono text-[11px] text-white/85 outline-none transition-colors placeholder:text-white/20 hover:border-white/20 focus:border-[var(--accent)] disabled:cursor-default disabled:opacity-60';

function InlineField({
  field,
  value,
  poses,
  disabled,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  poses: Pose[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const v = String(value ?? field.default);
  let control;
  if (field.kind === 'select' || field.kind === 'pose') {
    const options = field.kind === 'pose' ? poses.map((p) => ({ value: p.name, label: p.name })) : (field.options ?? []);
    const known = options.some((o) => o.value === v);
    control = (
      <select value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${inputCls} cursor-pointer pr-0`}>
        {!known && <option value={v}>{v} (missing)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#111]">
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        value={v}
        disabled={disabled}
        spellCheck={false}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} ${field.kind === 'text' ? 'font-sans' : ''}`}
        title={v}
      />
    );
  }
  return (
    <div className="flex items-center gap-2 px-3" style={{ height: NODE_METRICS.row }}>
      <span className="w-[74px] shrink-0 truncate text-[10.5px] text-white/45" title={field.help ?? field.label}>
        {field.label}
      </span>
      {control}
      {field.unit && <span className="w-5 shrink-0 text-[9.5px] text-white/30">{field.unit}</span>}
    </div>
  );
}

function FlowNodeImpl({ id, type, data, selected }: NodeProps) {
  const { activeNodeId, problemsByNode, onDelete, onFieldChange, poses, running } = useContext(BlocksCanvasContext);
  const def = BLOCK_BY_TYPE[type];
  if (!def) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-[#140a0a] px-3 py-2 text-xs text-red-300">
        Unknown block “{type}”
        <Handle type="target" position={Position.Top} />
      </div>
    );
  }
  const accent = CATEGORY_BY_ID[def.category].accent;
  const Icon = blockIcon(def.type);
  const active = activeNodeId === id;
  const problems = problemsByNode.get(id) ?? [];
  const hasError = problems.some((p) => p.severity === 'error');
  const values = data as Record<string, unknown>;
  const tooltip = problems.map((p) => p.message).join('\n') || def.description;
  const border = hasError ? '#ef4444aa' : problems.length ? '#fbbf24aa' : selected ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.09)';
  const glow = active ? `0 0 0 2px ${accent}, 0 0 28px ${accent}77` : selected ? '0 0 0 1px rgba(255,255,255,0.25)' : undefined;

  const deleteButton = !running && def.type !== 'start' && (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onDelete(id);
      }}
      className="absolute -right-2 -top-2 z-10 hidden h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-[#0a0a0a] text-white/40 hover:border-red-500/50 hover:text-red-400 group-hover:flex"
      title="Delete block"
    >
      <X size={11} />
    </button>
  );
  const handleCls = '!h-2.5 !w-2.5 !border-2 !border-[#0b0b0d] transition-transform hover:!scale-150';

  // Compact pill for blocks without settings or branches (Start, End, Home…).
  if (def.fields.length === 0 && def.outputs.length <= 1) {
    return (
      <div
        className="group relative flex items-center gap-2.5 rounded-full border bg-[#111114] px-3 text-white/85 shadow-lg shadow-black/40"
        style={{ width: NODE_METRICS.width, height: NODE_METRICS.pill, borderColor: border, boxShadow: glow }}
        title={tooltip}
      >
        {deleteButton}
        {def.hasInput && <Handle type="target" position={Position.Top} className={handleCls} style={{ background: accent }} />}
        <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: `${accent}22`, color: accent }}>
          <Icon size={13} strokeWidth={2.2} fill={def.type === 'start' || def.type === 'end' ? 'currentColor' : 'none'} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight">{def.label}</span>
        {active && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: accent }} />}
        {problems.length > 0 && <AlertTriangle size={12} className={`ml-auto ${hasError ? 'text-red-400' : 'text-amber-300'}`} />}
        {def.outputs.map((o) => (
          <Handle key={o.id} id={o.id} type="source" position={Position.Bottom} className={handleCls} style={{ background: accent }} />
        ))}
      </div>
    );
  }

  const { shown, hidden } = inlineFields(def, values);
  return (
    <div
      className="group relative rounded-xl border bg-[#111114] text-white/85 shadow-lg shadow-black/40"
      style={{ width: NODE_METRICS.width, borderColor: border, boxShadow: glow, ['--accent' as string]: accent }}
      title={tooltip}
    >
      {deleteButton}
      {def.hasInput && <Handle type="target" position={Position.Top} className={handleCls} style={{ background: accent }} />}

      <div
        className="flex items-center gap-2.5 rounded-t-xl border-b border-white/[0.05] px-3"
        style={{ height: NODE_METRICS.header, background: `linear-gradient(90deg, ${accent}1f, transparent 70%)` }}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `${accent}26`, color: accent }}>
          <Icon size={14} strokeWidth={2.2} />
        </span>
        <span className="truncate text-[13px] font-semibold tracking-tight">{def.label}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {active && (
            <span className="flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider" style={{ background: `${accent}30`, color: accent }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: accent }} />
              running
            </span>
          )}
          {problems.length > 0 && <AlertTriangle size={13} className={hasError ? 'text-red-400' : 'text-amber-300'} />}
        </span>
      </div>

      <div className="py-1">
        {shown.map((f) => (
          <InlineField
            key={f.key}
            field={f}
            value={values[f.key]}
            poses={poses}
            disabled={running}
            onChange={(v) => onFieldChange(id, f.key, v)}
          />
        ))}
        {hidden > 0 && (
          <div className="px-3 text-[10px] text-white/30" style={{ height: NODE_METRICS.more, lineHeight: `${NODE_METRICS.more}px` }}>
            +{hidden} more in Properties
          </div>
        )}
      </div>

      {def.outputs.length > 1 && (
        <div
          className="flex justify-around rounded-b-xl border-t border-white/[0.05] text-[9px] font-semibold uppercase tracking-wider"
          style={{ height: NODE_METRICS.outputs, lineHeight: `${NODE_METRICS.outputs}px` }}
        >
          {def.outputs.map((o) => (
            <span key={o.id} style={{ color: `${OUTPUT_COLORS[o.id] ?? '#ffffff'}bb` }}>
              {o.label}
            </span>
          ))}
        </div>
      )}
      {def.outputs.map((o, i) => (
        <Handle
          key={o.id}
          id={o.id}
          type="source"
          position={Position.Bottom}
          className={handleCls}
          style={{ background: OUTPUT_COLORS[o.id] ?? accent, left: `${((i + 1) / (def.outputs.length + 1)) * 100}%` }}
        />
      ))}
    </div>
  );
}

export const FlowNode = memo(FlowNodeImpl);

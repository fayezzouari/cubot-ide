'use client';

import { createContext, memo, useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, X } from 'lucide-react';
import { BLOCK_BY_TYPE, CATEGORY_BY_ID } from '@/lib/blocks/registry';
import type { Problem } from '@/lib/blocks/compiler';

export interface BlocksCanvasState {
  activeNodeId: string | null;
  problemsByNode: Map<string, Problem[]>;
  onDelete: (id: string) => void;
  running: boolean;
}

export const BlocksCanvasContext = createContext<BlocksCanvasState>({
  activeNodeId: null,
  problemsByNode: new Map(),
  onDelete: () => {},
  running: false,
});

function FlowNodeImpl({ id, type, data, selected }: NodeProps) {
  const { activeNodeId, problemsByNode, onDelete, running } = useContext(BlocksCanvasContext);
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
  const active = activeNodeId === id;
  const problems = problemsByNode.get(id) ?? [];
  const hasError = problems.some((p) => p.severity === 'error');
  const summary = def.summary?.(data as Record<string, unknown>);

  return (
    <div
      className={`group relative w-[230px] rounded-lg border bg-[#0f0f10] text-white/80 shadow-lg transition-shadow ${hasError ? 'border-red-500/60' : problems.length ? 'border-amber-400/50' : selected ? 'border-white/40' : 'border-white/[0.10]'}`}
      style={{
        borderLeft: `3px solid ${accent}`,
        boxShadow: active ? `0 0 0 2px ${accent}, 0 0 24px ${accent}66` : undefined,
      }}
      title={problems.map((p) => p.message).join('\n') || def.description}
    >
      {!running && def.type !== 'start' && (
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
      )}
      {def.hasInput && (
        <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border !border-white/30" style={{ background: accent }} />
      )}

      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
        {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: accent }} />}
        <span className="text-[13px] font-semibold tracking-tight">{def.label}</span>
        {problems.length > 0 && (
          <AlertTriangle size={12} className={`ml-auto ${hasError ? 'text-red-400' : 'text-amber-300'}`} />
        )}
      </div>
      {summary && (
        <div className="truncate px-3 pb-2 font-mono text-[11px] text-white/45" title={summary}>
          {summary}
        </div>
      )}

      {def.outputs.length > 1 && (
        <div className="flex justify-around border-t border-white/[0.05] px-2 pb-1 pt-0.5 text-[9px] uppercase tracking-wider text-white/35">
          {def.outputs.map((o) => (
            <span key={o.id}>{o.label}</span>
          ))}
        </div>
      )}
      {def.outputs.map((o, i) => (
        <Handle
          key={o.id}
          id={o.id}
          type="source"
          position={Position.Bottom}
          className="!h-2.5 !w-2.5 !border !border-white/30"
          style={{
            background: o.id === 'false' ? '#f87171' : o.id === 'true' ? '#4ade80' : accent,
            left: `${((i + 1) / (def.outputs.length + 1)) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

export const FlowNode = memo(FlowNodeImpl);

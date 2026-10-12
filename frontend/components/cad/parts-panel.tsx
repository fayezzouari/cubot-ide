'use client';

import { Box, Copy, Eye, EyeOff, FileUp, Plus, Trash2, Triangle } from 'lucide-react';
import type { CadInstance, CadPart } from '@/lib/api/cad';

interface Props {
  parts: CadPart[];
  instances: CadInstance[];
  selectedId: string | null;
  onSelect: (instanceId: string) => void;
  onAddInstance: (part: CadPart) => void;
  onDuplicatePart: (part: CadPart) => void;
  onDeletePart: (part: CadPart) => void;
  onToggleVisible: (instance: CadInstance) => void;
  onRemoveInstance: (instance: CadInstance) => void;
  onImport: () => void;
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));

export default function PartsPanel({
  parts,
  instances,
  selectedId,
  onSelect,
  onAddInstance,
  onDuplicatePart,
  onDeletePart,
  onToggleVisible,
  onRemoveInstance,
  onImport,
}: Props) {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const selectedPartId = instances.find((i) => i.id === selectedId)?.part_id;

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <section className="p-3">
        <h3 className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Assembly</h3>
        {instances.length === 0 && <p className="text-[11px] text-white/30">Nothing placed yet.</p>}
        <div className="space-y-px">
          {instances.map((inst) => {
            const part = partById.get(inst.part_id);
            const selected = inst.id === selectedId;
            return (
              <div
                key={inst.id}
                onClick={() => onSelect(inst.id)}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
                  selected ? 'bg-blue-500/15 text-white' : 'hover:bg-white/[0.04] text-white/65'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/40"
                  style={{ background: inst.color || part?.color }}
                />
                <span className={`text-[11.5px] truncate flex-1 ${inst.visible ? '' : 'opacity-40'}`}>{inst.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisible(inst);
                  }}
                  title={inst.visible ? 'Hide' : 'Show'}
                  className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-white"
                >
                  {inst.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveInstance(inst);
                  }}
                  title="Remove from assembly"
                  className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-300"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="p-3 border-t border-white/[0.06]">
        <div className="flex items-center mb-2">
          <h3 className="text-[10px] uppercase tracking-wider text-white/40">Part library</h3>
          <button
            onClick={onImport}
            className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-white/50 hover:text-white"
            title="Import STEP, IGES, STL, OBJ, 3MF or DXF"
          >
            <FileUp size={11} /> Import
          </button>
        </div>
        {parts.length === 0 && <p className="text-[11px] text-white/30">Generate or import a part.</p>}
        <div className="space-y-1">
          {parts.map((part) => {
            const size = part.version?.bbox?.size;
            const uses = instances.filter((i) => i.part_id === part.id).length;
            return (
              <div
                key={part.id}
                className={`group rounded border px-2 py-1.5 ${
                  part.id === selectedPartId ? 'border-blue-500/30 bg-blue-500/[0.05]' : 'border-white/[0.06]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {part.kind === 'mesh' ? (
                    <Triangle size={11} className="text-white/35 shrink-0" />
                  ) : (
                    <Box size={11} className="text-white/35 shrink-0" />
                  )}
                  <span className="text-[11.5px] text-white/75 truncate flex-1">{part.name}</span>
                  <div className="flex gap-1.5 opacity-0 group-hover:opacity-100">
                    <button onClick={() => onAddInstance(part)} title="Place another copy" className="text-white/40 hover:text-white">
                      <Plus size={12} />
                    </button>
                    <button onClick={() => onDuplicatePart(part)} title="Duplicate as a new part" className="text-white/40 hover:text-white">
                      <Copy size={12} />
                    </button>
                    <button onClick={() => onDeletePart(part)} title="Delete part" className="text-white/40 hover:text-red-300">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 mt-0.5 text-[10px] font-mono text-white/30">
                  <span>{part.source === 'imported' ? 'imported' : 'generated'}</span>
                  {size && <span>{size.map(fmt).join(' × ')} mm</span>}
                  <span className="ml-auto">v{part.version?.number ?? '–'}{uses ? ` · ${uses}×` : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

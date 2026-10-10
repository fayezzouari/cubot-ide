'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BLOCKS, CATEGORIES } from '@/lib/blocks/registry';

export function BlockPalette({ onAdd }: { onAdd: (type: string) => void }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const q = query.trim().toLowerCase();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.08] bg-[#0a0a0a]">
      <div className="space-y-2 border-b border-white/[0.08] p-3">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/50">Blocks</span>
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blocks…"
            className="w-full rounded border border-white/[0.08] bg-white/[0.03] py-1.5 pl-7 pr-2 text-xs text-white placeholder:text-white/25 focus:border-white/20 focus:outline-none"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {CATEGORIES.map((cat) => {
            const blocks = BLOCKS.filter(
              (b) =>
                b.category === cat.id &&
                b.type !== 'start' &&
                (!q || b.label.toLowerCase().includes(q) || b.description.toLowerCase().includes(q)),
            );
            if (!blocks.length) return null;
            const open = q || !collapsed.includes(cat.id);
            return (
              <div key={cat.id} className="border-b border-white/[0.04]">
                <button
                  onClick={() =>
                    setCollapsed((c) => (c.includes(cat.id) ? c.filter((x) => x !== cat.id) : [...c, cat.id]))
                  }
                  className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-semibold text-white/55 hover:bg-white/[0.03]"
                >
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="h-2 w-2 rounded-sm" style={{ background: cat.accent }} />
                  {cat.name}
                </button>
                {open && (
                  <div className="space-y-1 px-2 pb-2">
                    {blocks.map((b) => (
                      <div
                        key={b.type}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/reactflow/type', b.type);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDoubleClick={() => onAdd(b.type)}
                        title={`${b.description}\n\nDrag onto the canvas or double-click to add.`}
                        className="cursor-grab rounded border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5 text-xs text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.05] active:cursor-grabbing"
                        style={{ borderLeft: `3px solid ${cat.accent}` }}
                      >
                        {b.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="border-t border-white/[0.08] p-3 text-[10px] leading-relaxed text-white/30">
        Drag blocks onto the canvas and connect outputs (bottom) to inputs (top). Double-click to add at the end.
      </div>
    </aside>
  );
}

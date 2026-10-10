'use client';

import type { Node } from '@xyflow/react';
import { Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BLOCK_BY_TYPE, BUILTIN_VARIABLES, CATEGORY_BY_ID } from '@/lib/blocks/registry';
import type { Problem } from '@/lib/blocks/compiler';
import type { FieldDef, Pose } from '@/lib/blocks/types';

const inputCls =
  'w-full rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-xs text-white focus:border-white/25 focus:outline-none disabled:opacity-50';

function FieldEditor({
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
  onChange: (v: string | number) => void;
}) {
  const v = value ?? field.default;
  if (field.kind === 'select' || field.kind === 'pose') {
    const options =
      field.kind === 'pose' ? poses.map((p) => ({ value: p.name, label: p.name })) : (field.options ?? []);
    const known = options.some((o) => o.value === String(v));
    return (
      <select value={String(v)} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {!known && <option value={String(v)}>{String(v)} (missing)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#111]">
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const mono = field.kind !== 'text';
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={String(v)}
        disabled={disabled}
        placeholder={field.placeholder}
        spellCheck={false}
        // Stored as typed; the compiler parses numbers and expressions alike.
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} ${mono ? 'font-mono' : ''}`}
      />
      {field.unit && <span className="w-8 shrink-0 text-[10px] text-white/35">{field.unit}</span>}
    </div>
  );
}

export function Inspector({
  node,
  poses,
  problems,
  variables,
  disabled,
  onChange,
  onDelete,
  onDuplicate,
}: {
  node: Node | null;
  poses: Pose[];
  problems: Problem[];
  variables: string[];
  disabled: boolean;
  onChange: (id: string, key: string, value: string | number) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  if (!node) {
    return (
      <div className="space-y-4 p-4 text-xs text-white/45">
        <p>Select a block to edit its properties.</p>
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">Expressions</div>
          <p className="leading-relaxed">
            Number and condition fields accept expressions such as{' '}
            <code className="rounded bg-white/5 px-1 font-mono text-white/70">count * 70</code> or{' '}
            <code className="rounded bg-white/5 px-1 font-mono text-white/70">part_color == &quot;red&quot; and not part_defect</code>.
            Functions: abs, min, max, round, floor, ceil, sqrt, sin, cos, clamp, random.
          </p>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">Available variables</div>
          <div className="flex flex-wrap gap-1">
            {[...variables, ...BUILTIN_VARIABLES.map((b) => b.name)].map((v) => (
              <code key={v} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/60">
                {v}
              </code>
            ))}
          </div>
        </div>
      </div>
    );
  }
  const def = BLOCK_BY_TYPE[node.type ?? ''];
  if (!def) return <div className="p-4 text-xs text-red-300">Unknown block type “{node.type}”.</div>;
  const cat = CATEGORY_BY_ID[def.category];
  const data = node.data as Record<string, unknown>;

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: cat.accent }}>
          {cat.name}
        </div>
        <div className="text-sm font-semibold text-white">{def.label}</div>
        <p className="mt-1 text-xs leading-relaxed text-white/50">{def.description}</p>
      </div>

      {problems.length > 0 && (
        <div className="space-y-1">
          {problems.map((p, i) => (
            <div
              key={i}
              className={`rounded border px-2 py-1.5 text-[11px] ${p.severity === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'}`}
            >
              {p.message}
            </div>
          ))}
        </div>
      )}

      {def.fields.length > 0 && (
        <div className="space-y-3">
          {def.fields.map((f) => (
            <label key={f.key} className="block space-y-1">
              <span className="text-[11px] text-white/55">{f.label}</span>
              <FieldEditor
                field={f}
                value={data[f.key]}
                poses={poses}
                disabled={disabled}
                onChange={(v) => onChange(node.id, f.key, v)}
              />
              {f.help && <span className="block text-[10px] leading-snug text-white/30">{f.help}</span>}
            </label>
          ))}
        </div>
      )}

      {def.type !== 'start' && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={disabled} onClick={() => onDuplicate(node.id)}>
            <Copy size={12} /> Duplicate
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-red-300 hover:text-red-200"
            disabled={disabled}
            onClick={() => onDelete(node.id)}
          >
            <Trash2 size={12} /> Delete
          </Button>
        </div>
      )}
    </div>
  );
}

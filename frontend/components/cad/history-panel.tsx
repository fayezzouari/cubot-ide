'use client';

import { useState } from 'react';
import { Bookmark, Clock, Loader2, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import type { CadSnapshot, TrashedPart } from '@/lib/api/cad';

interface Props {
  snapshots: CadSnapshot[] | null;
  trash: TrashedPart[] | null;
  busy: boolean;
  onSave: (label: string) => Promise<void>;
  onRestore: (snapshot: CadSnapshot) => void;
  onDelete: (snapshot: CadSnapshot) => void;
  onRestorePart: (part: TrashedPart) => void;
}

function when(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function HistoryPanel({ snapshots, trash, busy, onSave, onRestore, onDelete, onRestorePart }: Props) {
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <section className="p-3">
        <h3 className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Snapshots</h3>
        <form
          className="flex gap-1.5 mb-2.5"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              await onSave(label.trim() || 'Snapshot');
              setLabel('');
            } finally {
              setSaving(false);
            }
          }}
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name this version…"
            className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 text-[11.5px] text-white/85 placeholder:text-white/25 focus:outline-none focus:border-white/25"
          />
          <button
            type="submit"
            disabled={saving || busy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white text-black text-[11px] font-medium disabled:opacity-40"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Bookmark size={11} />} Save
          </button>
        </form>
        {!snapshots && <Loader2 size={12} className="animate-spin text-white/30" />}
        {snapshots?.length === 0 && (
          <p className="text-[11px] text-white/30">
            None yet. A snapshot is also saved automatically before every generation, review fix and restore.
          </p>
        )}
        <div className="space-y-px">
          {snapshots?.map((s) => (
            <div key={s.id} className="group flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/[0.04]">
              {s.auto ? (
                <Clock size={11} className="mt-0.5 text-white/30 shrink-0" />
              ) : (
                <Bookmark size={11} className="mt-0.5 text-blue-300/70 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className={`text-[11.5px] truncate ${s.auto ? 'text-white/55' : 'text-white/85'}`} title={s.label}>
                  {s.label}
                </p>
                <p className="text-[10px] font-mono text-white/30">
                  {when(s.created_at)} · {s.copies} copies · {s.parts} parts
                </p>
              </div>
              <button
                onClick={() => onRestore(s)}
                disabled={busy}
                title="Restore the assembly and part versions (the current state is saved first)"
                className="opacity-0 group-hover:opacity-100 text-white/45 hover:text-white disabled:opacity-20"
              >
                <RotateCcw size={12} />
              </button>
              <button
                onClick={() => onDelete(s)}
                title="Delete snapshot"
                className="opacity-0 group-hover:opacity-100 text-white/35 hover:text-red-300"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="p-3 border-t border-white/[0.06]">
        <h3 className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Deleted parts</h3>
        {trash?.length === 0 && <p className="text-[11px] text-white/30">Deleted parts stay here for 30 days.</p>}
        <div className="space-y-px">
          {trash?.map((p) => (
            <div key={p.id} className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.04]">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/40" style={{ background: p.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] text-white/65 truncate">{p.name}</p>
                <p className="text-[10px] font-mono text-white/30">
                  deleted {when(p.deleted_at)}
                  {p.copies ? ` · ${p.copies} ${p.copies === 1 ? 'copy' : 'copies'}` : ''}
                </p>
              </div>
              <button
                onClick={() => onRestorePart(p)}
                disabled={busy}
                title="Restore, with its copies where they were"
                className="inline-flex items-center gap-1 text-[10.5px] text-white/45 hover:text-white disabled:opacity-20"
              >
                <Undo2 size={11} /> Restore
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

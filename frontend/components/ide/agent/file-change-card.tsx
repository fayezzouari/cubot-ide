'use client';

import { FilePlus2, FilePen, FileCode2, Undo2, ExternalLink } from 'lucide-react';
import type { FileChange } from '@/lib/mock-data';

const OP_META: Record<string, { Icon: React.ComponentType<{ size?: number; className?: string }>; label: string; tone: string }> = {
  create_file: { Icon: FilePlus2, label: 'Created', tone: 'text-emerald-300' },
  edit_file: { Icon: FilePen, label: 'Edited', tone: 'text-amber-300' },
  update_file: { Icon: FileCode2, label: 'Rewrote', tone: 'text-amber-300' },
};

interface FileChangeCardProps {
  changes: FileChange[];
  onOpen?: (change: FileChange) => void;
  onRevert?: (index: number) => void;
  revertingIndex?: number | null;
}

/** Files the agent changed in one turn: open each in the editor or put it back. */
export default function FileChangeCard({ changes, onOpen, onRevert, revertingIndex = null }: FileChangeCardProps) {
  if (changes.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#0f0f0f]">
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/35">
        {changes.length} file{changes.length === 1 ? '' : 's'} changed
      </div>
      <ul className="divide-y divide-white/[0.04]">
        {changes.map((change, index) => {
          const meta = OP_META[change.operation] ?? OP_META.edit_file;
          const canRevert = !!onRevert && !!change.file_id && !change.reverted;
          const busy = revertingIndex === index;
          return (
            <li key={`${change.path}-${index}`} className={`px-2.5 py-2 ${change.reverted ? 'opacity-45' : ''}`}>
              <div className="flex items-center gap-2">
                <meta.Icon size={12} className={`flex-shrink-0 ${change.reverted ? 'text-white/30' : meta.tone}`} />
                <button
                  type="button"
                  onClick={() => onOpen?.(change)}
                  disabled={!onOpen || !change.file_id || change.reverted}
                  title={onOpen ? 'Open in editor' : undefined}
                  className="group flex min-w-0 items-center gap-1 text-left font-mono text-[11.5px] text-white/75 hover:text-white disabled:cursor-default disabled:hover:text-white/75 cursor-pointer"
                >
                  <span className={`truncate ${change.reverted ? 'line-through' : ''}`}>{change.path}</span>
                  {onOpen && change.file_id && !change.reverted && (
                    <ExternalLink size={10} className="flex-shrink-0 text-white/0 transition-colors group-hover:text-white/40" />
                  )}
                </button>
                <span className="ml-auto flex flex-shrink-0 items-center gap-1.5 font-mono text-[10.5px]">
                  {!!change.added && <span className="text-emerald-400/80">+{change.added}</span>}
                  {!!change.removed && <span className="text-red-400/80">−{change.removed}</span>}
                </span>
                {change.reverted ? (
                  <span className="text-[10px] uppercase tracking-wider text-white/30">reverted</span>
                ) : canRevert ? (
                  <button
                    type="button"
                    onClick={() => onRevert(index)}
                    disabled={busy}
                    title={change.operation === 'create_file' ? 'Delete this file' : 'Restore the previous content'}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white/80 disabled:opacity-40 cursor-pointer"
                  >
                    <Undo2 size={10} />
                    {busy ? 'Reverting' : 'Revert'}
                  </button>
                ) : null}
              </div>
              {change.summary && (
                <p className="mt-0.5 pl-5 text-[11px] leading-snug text-white/40">{change.summary}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

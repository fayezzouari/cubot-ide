'use client';

import { FilePlus2, FilePen, FileCode2, Undo2 } from 'lucide-react';
import type { FileChange } from '@/lib/mock-data';

const OP_META: Record<string, { Icon: React.ComponentType<{ size?: number; className?: string }>; tone: string }> = {
  create_file: { Icon: FilePlus2, tone: 'text-green-400' },
  edit_file: { Icon: FilePen, tone: 'text-white/60' },
  update_file: { Icon: FileCode2, tone: 'text-white/60' },
};

interface FileChangeCardProps {
  changes: FileChange[];
  onOpen?: (change: FileChange) => void;
  onRevert?: (index: number) => void;
  revertingIndex?: number | null;
}

export default function FileChangeCard({ changes, onOpen, onRevert, revertingIndex = null }: FileChangeCardProps) {
  if (changes.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border border-white/[0.08] bg-[#121212]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-2 py-1 text-[10.5px] uppercase tracking-wide text-white/35">
        <span>{changes.length} file{changes.length === 1 ? '' : 's'} changed</span>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {changes.map((change, index) => {
          const meta = OP_META[change.operation] ?? OP_META.edit_file;
          const canRevert = !!onRevert && !!change.file_id && !change.reverted;
          const busy = revertingIndex === index;
          return (
            <li key={`${change.path}-${index}`} className={`px-2 py-1.5 ${change.reverted ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2">
                <meta.Icon size={11} className={`flex-shrink-0 ${change.reverted ? 'text-white/30' : meta.tone}`} />
                <button
                  type="button"
                  onClick={() => onOpen?.(change)}
                  disabled={!onOpen || !change.file_id || change.reverted}
                  title={onOpen ? 'Open in editor' : undefined}
                  className={`min-w-0 truncate text-left font-mono text-[11px] text-white/80 hover:text-white hover:underline underline-offset-2 disabled:cursor-default disabled:hover:text-white/80 disabled:hover:no-underline cursor-pointer ${change.reverted ? 'line-through' : ''}`}
                >
                  {change.path}
                </button>
                <span className="ml-auto flex flex-shrink-0 items-center gap-1 font-mono text-[10.5px]">
                  {!!change.added && <span className="text-green-400">+{change.added}</span>}
                  {!!change.removed && <span className="text-red-400">−{change.removed}</span>}
                </span>
                {change.reverted ? (
                  <span className="text-[10px] text-white/30">reverted</span>
                ) : canRevert ? (
                  <button
                    type="button"
                    onClick={() => onRevert(index)}
                    disabled={busy}
                    title={change.operation === 'create_file' ? 'Delete this file' : 'Restore the previous content'}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-white/40 hover:bg-white/[0.07] hover:text-white/90 disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    <Undo2 size={10} />
                    {busy ? 'Reverting' : 'Revert'}
                  </button>
                ) : null}
              </div>
              {change.summary && <p className="mt-0.5 pl-[19px] text-[11px] leading-snug text-white/40">{change.summary}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

'use client';

import { FilePlus2, FilePen, FileCode2, Undo2 } from 'lucide-react';
import type { FileChange } from '@/lib/mock-data';

const OP_META: Record<string, { Icon: React.ComponentType<{ size?: number; className?: string }>; tone: string }> = {
  create_file: { Icon: FilePlus2, tone: 'text-green-400' },
  edit_file: { Icon: FilePen, tone: 'text-blue-400' },
  update_file: { Icon: FileCode2, tone: 'text-blue-400' },
};

interface FileChangeCardProps {
  changes: FileChange[];
  onOpen?: (change: FileChange) => void;
  onRevert?: (index: number) => void;
  revertingIndex?: number | null;
}

/** Files the assistant changed in one turn: open each in the editor or put it back. */
export default function FileChangeCard({ changes, onOpen, onRevert, revertingIndex = null }: FileChangeCardProps) {
  if (changes.length === 0) return null;
  return (
    <div className="mt-2 rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <div className="px-3 py-1.5 border-b border-white/[0.05] text-[10px] font-semibold text-white/30">
        {changes.length} file{changes.length === 1 ? '' : 's'} changed
      </div>
      <ul className="divide-y divide-white/[0.04]">
        {changes.map((change, index) => {
          const meta = OP_META[change.operation] ?? OP_META.edit_file;
          const canRevert = !!onRevert && !!change.file_id && !change.reverted;
          const busy = revertingIndex === index;
          return (
            <li key={`${change.path}-${index}`} className={`px-3 py-1.5 ${change.reverted ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2">
                <meta.Icon size={11} className={`flex-shrink-0 ${change.reverted ? 'text-white/30' : meta.tone}`} />
                <button
                  type="button"
                  onClick={() => onOpen?.(change)}
                  disabled={!onOpen || !change.file_id || change.reverted}
                  title={onOpen ? 'Open in editor' : undefined}
                  className={`min-w-0 truncate text-left font-mono text-[10px] text-white/60 hover:text-white disabled:cursor-default disabled:hover:text-white/60 cursor-pointer ${change.reverted ? 'line-through' : ''}`}
                >
                  {change.path}
                </button>
                <span className="ml-auto flex flex-shrink-0 items-center gap-1 font-mono text-[9px]">
                  {!!change.added && <span className="text-green-400/70">+{change.added}</span>}
                  {!!change.removed && <span className="text-red-400/70">−{change.removed}</span>}
                </span>
                {change.reverted ? (
                  <span className="text-[9px] text-white/25">reverted</span>
                ) : canRevert ? (
                  <button
                    type="button"
                    onClick={() => onRevert(index)}
                    disabled={busy}
                    title={change.operation === 'create_file' ? 'Delete this file' : 'Restore the previous content'}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] text-white/30 hover:text-white/60 hover:bg-white/[0.06] disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    <Undo2 size={9} />
                    {busy ? 'Reverting…' : 'Revert'}
                  </button>
                ) : null}
              </div>
              {change.summary && <p className="mt-0.5 pl-[19px] text-[10px] text-white/30 leading-snug">{change.summary}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

'use client';

import type { FileChange } from '@/lib/mock-data';

const OP_META: Record<string, { glyph: string; label: string; tone: string }> = {
  create_file: { glyph: '+', label: 'NEW', tone: 'text-forge-green' },
  edit_file: { glyph: '✎', label: 'EDIT', tone: 'text-forge-amber' },
  update_file: { glyph: '↻', label: 'REWRITE', tone: 'text-forge-amber' },
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
    <div className="pixel-border bg-forge-raised">
      <div className="border-b-2 border-forge-line px-2 py-1.5 font-pixel text-[9px] uppercase tracking-wide text-forge-dim">
        {changes.length} file{changes.length === 1 ? '' : 's'} changed
      </div>
      <ul className="divide-y-2 divide-forge-line/60">
        {changes.map((change, index) => {
          const meta = OP_META[change.operation] ?? OP_META.edit_file;
          const canRevert = !!onRevert && !!change.file_id && !change.reverted;
          const busy = revertingIndex === index;
          return (
            <li key={`${change.path}-${index}`} className={`px-2 py-1.5 ${change.reverted ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2">
                <span className={`w-12 flex-shrink-0 font-pixel text-[8px] ${change.reverted ? 'text-forge-dim' : meta.tone}`}>
                  {meta.glyph} {meta.label}
                </span>
                <button
                  type="button"
                  onClick={() => onOpen?.(change)}
                  disabled={!onOpen || !change.file_id || change.reverted}
                  title={onOpen ? 'Open in editor' : undefined}
                  className={`min-w-0 truncate text-left font-pixel-body text-[15px] leading-none text-forge-ink hover:text-forge-amber hover:underline decoration-2 underline-offset-2 disabled:cursor-default disabled:hover:text-forge-ink disabled:hover:no-underline cursor-pointer ${change.reverted ? 'line-through' : ''}`}
                >
                  {change.path}
                </button>
                <span className="ml-auto flex flex-shrink-0 items-center gap-1.5 font-pixel-body text-[14px] leading-none">
                  {!!change.added && <span className="text-forge-green">+{change.added}</span>}
                  {!!change.removed && <span className="text-forge-red">-{change.removed}</span>}
                </span>
                {change.reverted ? (
                  <span className="font-pixel text-[8px] uppercase text-forge-dim">undone</span>
                ) : canRevert ? (
                  <button
                    type="button"
                    onClick={() => onRevert(index)}
                    disabled={busy}
                    title={change.operation === 'create_file' ? 'Delete this file' : 'Restore the previous content'}
                    className="pixel-border pixel-btn bg-black px-1.5 py-0.5 font-pixel text-[8px] uppercase text-forge-dim hover:text-forge-ink disabled:opacity-40 cursor-pointer"
                  >
                    {busy ? '...' : 'undo'}
                  </button>
                ) : null}
              </div>
              {change.summary && (
                <p className="mt-0.5 pl-14 font-pixel-body text-[14px] leading-tight text-forge-dim">{change.summary}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

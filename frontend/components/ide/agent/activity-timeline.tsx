'use client';

import { useState } from 'react';
import type { ActivityItem, ExecutionLog } from '@/lib/mock-data';
import { PixelArrow, PixelCheck, PixelCross, PixelSpinner } from './agent-mark';

// One-glyph tool icons in the pixel font; the label carries the meaning.
const TOOL_GLYPH: Record<string, string> = {
  list_files: '≡',
  read_file: '»',
  create_file: '+',
  edit_file: '✎',
  update_file: '↻',
  compile_project: '⚒',
  execute_in_sandbox: '>_',
  search_web: '◎',
};

function LogOutput({ log }: { log: ExecutionLog }) {
  const text = [log.stdout?.trim(), log.stderr?.trim()].filter(Boolean).join('\n');
  if (!text) return null;
  return (
    <pre className="pixel-border mt-2 ml-5 max-h-40 overflow-y-auto bg-black px-2 py-1.5 font-pixel-body text-[14px] leading-[1.15] text-forge-dim whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const hasLog = !!item.log && (!!item.log.stdout?.trim() || !!item.log.stderr?.trim());
  const tone =
    item.status === 'running' ? 'text-forge-amber' : item.status === 'failed' ? 'text-forge-red' : 'text-forge-ink/80';

  return (
    <li>
      <button
        type="button"
        onClick={() => hasLog && setOpen(v => !v)}
        className={`flex w-full items-center gap-2 px-1.5 py-[3px] text-left font-pixel-body text-[15px] leading-none ${
          hasLog ? 'hover:bg-white/[0.04] cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className={`flex h-3 w-3 flex-shrink-0 items-center justify-center ${tone}`}>
          {item.status === 'running' ? <PixelSpinner /> : item.status === 'failed' ? <PixelCross /> : <PixelCheck />}
        </span>
        <span className={`w-4 flex-shrink-0 text-center font-pixel text-[9px] ${item.status === 'running' ? 'text-forge-amber' : 'text-forge-dim'}`}>
          {TOOL_GLYPH[item.tool] ?? '•'}
        </span>
        <span className={`truncate ${tone}`}>
          {item.label}
          {item.detail && <span className="ml-1.5 text-forge-dim">{item.detail}</span>}
        </span>
        {item.status !== 'running' && item.summary && item.tool !== 'read_file' && item.tool !== 'list_files' && (
          <span className={`ml-auto truncate pl-2 text-[13px] ${item.status === 'failed' ? 'text-forge-red/80' : 'text-forge-dim'}`}>
            {item.summary}
          </span>
        )}
        {hasLog && <PixelArrow dir={open ? 'down' : 'right'} className="ml-1 flex-shrink-0 text-forge-dim" />}
      </button>
      {open && item.log && <LogOutput log={item.log} />}
    </li>
  );
}

interface ActivityTimelineProps {
  items: ActivityItem[];
  /** While streaming the list stays open; afterwards it collapses to one line. */
  live: boolean;
  statusText?: string;
}

/** The agent's tool calls for one turn, as a compact timeline. */
export default function ActivityTimeline({ items, live, statusText }: ActivityTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const show = live || expanded;
  const failed = items.filter(i => i.status === 'failed').length;
  const edits = items.filter(i => ['create_file', 'edit_file', 'update_file'].includes(i.tool) && i.status === 'done').length;

  if (items.length === 0 && !live) return null;

  return (
    <div className="pixel-border bg-forge-raised" style={{ ['--pb' as string]: live ? '#ffb000' : '#2e261c' }}>
      <button
        type="button"
        onClick={() => !live && setExpanded(v => !v)}
        className={`flex w-full items-center gap-2 px-2 py-1.5 font-pixel text-[9px] uppercase tracking-wide ${
          live ? 'cursor-default text-forge-amber' : 'cursor-pointer text-forge-dim hover:text-forge-ink'
        }`}
      >
        {live ? <PixelSpinner /> : <PixelArrow dir={expanded ? 'down' : 'right'} />}
        <span className="truncate">
          {live
            ? statusText || 'Working'
            : `${items.length} step${items.length === 1 ? '' : 's'}${edits ? ` / ${edits} edit${edits === 1 ? '' : 's'}` : ''}${failed ? ` / ${failed} failed` : ''}`}
        </span>
        {live && <span className="ml-auto animate-pixel-blink text-forge-ember">●REC</span>}
      </button>
      {show && items.length > 0 && (
        <ul className="border-t-2 border-forge-line px-0.5 py-1">
          {items.map(item => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

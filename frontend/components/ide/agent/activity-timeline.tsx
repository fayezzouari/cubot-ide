'use client';

import { useState } from 'react';
import {
  Check, ChevronDown, ChevronRight, FileSearch, FilePlus2, FilePen, FileCode2,
  Hammer, Loader2, Terminal, Globe, FolderTree, X,
} from 'lucide-react';
import type { ActivityItem, ExecutionLog } from '@/lib/mock-data';

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  list_files: FolderTree,
  read_file: FileSearch,
  create_file: FilePlus2,
  edit_file: FilePen,
  update_file: FileCode2,
  compile_project: Hammer,
  execute_in_sandbox: Terminal,
  search_web: Globe,
};

function LogOutput({ log }: { log: ExecutionLog }) {
  const text = [log.stdout?.trim(), log.stderr?.trim()].filter(Boolean).join('\n');
  if (!text) return null;
  return (
    <pre className="mt-1.5 ml-6 max-h-40 overflow-y-auto rounded-md border border-white/[0.06] bg-black/60 px-2.5 py-2 text-[11px] leading-relaxed font-mono text-white/45 whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[item.tool] ?? Terminal;
  const hasLog = !!item.log && (!!item.log.stdout?.trim() || !!item.log.stderr?.trim());
  const tone =
    item.status === 'running' ? 'text-amber-300' : item.status === 'failed' ? 'text-red-300' : 'text-white/55';

  return (
    <li className="group">
      <button
        type="button"
        onClick={() => hasLog && setOpen(v => !v)}
        className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] leading-snug transition-colors ${
          hasLog ? 'hover:bg-white/[0.04] cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center ${tone}`}>
          {item.status === 'running' ? (
            <Loader2 size={11} className="animate-spin" />
          ) : item.status === 'failed' ? (
            <X size={11} />
          ) : (
            <Check size={11} />
          )}
        </span>
        <Icon size={12} className={`flex-shrink-0 ${item.status === 'running' ? 'text-amber-300/80' : 'text-white/30'}`} />
        <span className={`truncate ${tone}`}>
          {item.label}
          {item.detail && (
            <span className="ml-1.5 font-mono text-white/40">{item.detail}</span>
          )}
        </span>
        {item.status !== 'running' && item.summary && item.tool !== 'read_file' && item.tool !== 'list_files' && (
          <span className={`ml-auto truncate pl-2 text-[10.5px] ${item.status === 'failed' ? 'text-red-300/70' : 'text-white/30'}`}>
            {item.summary}
          </span>
        )}
        {hasLog && (
          <span className="ml-1 text-white/25 group-hover:text-white/50">
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}
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
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => !live && setExpanded(v => !v)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-[11px] ${live ? 'cursor-default' : 'cursor-pointer hover:bg-white/[0.03]'}`}
      >
        {live ? (
          <Loader2 size={11} className="animate-spin text-amber-300" />
        ) : expanded ? (
          <ChevronDown size={11} className="text-white/35" />
        ) : (
          <ChevronRight size={11} className="text-white/35" />
        )}
        <span className={live ? 'text-amber-200/90' : 'text-white/45'}>
          {live
            ? statusText || 'Working'
            : `${items.length} step${items.length === 1 ? '' : 's'}${edits ? ` · ${edits} edit${edits === 1 ? '' : 's'}` : ''}${failed ? ` · ${failed} failed` : ''}`}
        </span>
        {live && <span className="ml-auto text-[10px] uppercase tracking-wider text-white/25">live</span>}
      </button>
      {show && items.length > 0 && (
        <ul className="space-y-0.5 border-t border-white/[0.05] px-1 py-1">
          {items.map(item => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

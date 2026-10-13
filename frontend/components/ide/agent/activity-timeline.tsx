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
    <pre className="mx-2 mb-2 max-h-36 overflow-y-auto rounded border border-white/[0.06] bg-black/50 p-2 font-mono text-[10.5px] leading-relaxed text-white/45 whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[item.tool] ?? Terminal;
  const hasLog = !!item.log && (!!item.log.stdout?.trim() || !!item.log.stderr?.trim());
  const tone = item.status === 'running' ? 'text-white/85' : item.status === 'failed' ? 'text-red-300/90' : 'text-white/55';

  return (
    <li>
      <button
        type="button"
        onClick={() => hasLog && setOpen(v => !v)}
        className={`flex w-full items-center gap-2 px-2 py-[3px] text-left text-[11.5px] ${
          hasLog ? 'cursor-pointer hover:bg-white/[0.04]' : 'cursor-default'
        }`}
      >
        <span className="flex w-3 flex-shrink-0 items-center justify-center">
          {item.status === 'running' ? (
            <Loader2 size={10} className="animate-spin text-white/70" />
          ) : item.status === 'failed' ? (
            <X size={10} className="text-red-300" />
          ) : (
            <Check size={10} className="text-white/40" />
          )}
        </span>
        <Icon size={11} className="flex-shrink-0 text-white/35" />
        <span className={`truncate ${tone}`}>
          {item.label}
          {item.detail && <span className="ml-1 font-mono text-white/45">{item.detail}</span>}
        </span>
        {item.status !== 'running' && item.summary && item.tool !== 'read_file' && item.tool !== 'list_files' && (
          <span className={`ml-auto truncate pl-2 text-[10.5px] ${item.status === 'failed' ? 'text-red-300/70' : 'text-white/30'}`}>
            {item.summary}
          </span>
        )}
        {hasLog && (open ? <ChevronDown size={11} className="ml-1 text-white/30" /> : <ChevronRight size={11} className="ml-1 text-white/30" />)}
      </button>
      {open && item.log && <LogOutput log={item.log} />}
    </li>
  );
}

interface ActivityTimelineProps {
  items: ActivityItem[];
  live: boolean;
  statusText?: string;
}

export default function ActivityTimeline({ items, live, statusText }: ActivityTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const show = live || expanded;
  const failed = items.filter(i => i.status === 'failed').length;
  const edits = items.filter(i => ['create_file', 'edit_file', 'update_file'].includes(i.tool) && i.status === 'done').length;

  if (items.length === 0 && !live) return null;

  return (
    <div className="rounded-md border border-white/[0.08] bg-[#121212]">
      <button
        type="button"
        onClick={() => !live && setExpanded(v => !v)}
        className={`flex w-full items-center gap-2 px-2 py-1.5 text-[11.5px] ${live ? 'cursor-default text-white/70' : 'cursor-pointer text-white/45 hover:text-white/75'}`}
      >
        {live ? (
          <Loader2 size={11} className="animate-spin text-white/60" />
        ) : expanded ? (
          <ChevronDown size={11} className="text-white/35" />
        ) : (
          <ChevronRight size={11} className="text-white/35" />
        )}
        <span className="truncate">
          {live
            ? statusText || 'Working'
            : `${items.length} step${items.length === 1 ? '' : 's'}${edits ? ` · ${edits} edit${edits === 1 ? '' : 's'}` : ''}${failed ? ` · ${failed} failed` : ''}`}
        </span>
      </button>
      {show && items.length > 0 && (
        <ul className="border-t border-white/[0.06] py-1">
          {items.map(item => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

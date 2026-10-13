'use client';

import { useState } from 'react';
import {
  Check, ChevronDown, ChevronUp, FileSearch, FilePlus2, FilePen, FileCode2,
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
    <pre className="mt-1 ml-5 max-h-32 overflow-y-auto rounded-lg bg-black/40 border border-white/[0.05] p-2 text-[9px] text-white/30 font-mono whitespace-pre-wrap leading-relaxed">
      {text}
    </pre>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[item.tool] ?? Terminal;
  const hasLog = !!item.log && (!!item.log.stdout?.trim() || !!item.log.stderr?.trim());
  const tone = item.status === 'running' ? 'text-blue-300/80' : item.status === 'failed' ? 'text-red-300/70' : 'text-white/40';

  return (
    <li>
      <button
        type="button"
        onClick={() => hasLog && setOpen(v => !v)}
        className={`flex w-full items-center gap-1.5 py-0.5 text-left text-[10px] ${hasLog ? 'cursor-pointer hover:text-white/60' : 'cursor-default'}`}
      >
        <span className={`w-3 flex-shrink-0 ${tone}`}>
          {item.status === 'running' ? <Loader2 size={9} className="animate-spin" /> : item.status === 'failed' ? <X size={9} /> : <Check size={9} />}
        </span>
        <Icon size={9} className="flex-shrink-0 text-white/25" />
        <span className={`truncate ${tone}`}>
          {item.label}
          {item.detail && <span className="ml-1 font-mono text-white/30">{item.detail}</span>}
        </span>
        {item.status !== 'running' && item.summary && item.tool !== 'read_file' && item.tool !== 'list_files' && (
          <span className={`ml-auto truncate pl-2 ${item.status === 'failed' ? 'text-red-300/60' : 'text-white/20'}`}>{item.summary}</span>
        )}
        {hasLog && (open ? <ChevronUp size={9} className="ml-1 text-white/25" /> : <ChevronDown size={9} className="ml-1 text-white/25" />)}
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

/** The agent's tool calls for one turn, as a compact list. */
export default function ActivityTimeline({ items, live, statusText }: ActivityTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const show = live || expanded;
  const failed = items.filter(i => i.status === 'failed').length;
  const edits = items.filter(i => ['create_file', 'edit_file', 'update_file'].includes(i.tool) && i.status === 'done').length;

  if (items.length === 0 && !live) return null;

  return (
    <div className="mb-1.5">
      <button
        type="button"
        onClick={() => !live && setExpanded(v => !v)}
        className={`flex items-center gap-1.5 text-[10px] ${live ? 'cursor-default text-white/40' : 'cursor-pointer text-white/25 hover:text-white/40'}`}
      >
        {live ? (
          <Loader2 size={9} className="animate-spin" />
        ) : expanded ? (
          <ChevronUp size={9} />
        ) : (
          <ChevronDown size={9} />
        )}
        {live
          ? statusText || 'Working…'
          : `${items.length} step${items.length === 1 ? '' : 's'}${edits ? ` · ${edits} edit${edits === 1 ? '' : 's'}` : ''}${failed ? ` · ${failed} failed` : ''}`}
      </button>
      {show && items.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-l border-white/[0.06] pl-2">
          {items.map(item => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

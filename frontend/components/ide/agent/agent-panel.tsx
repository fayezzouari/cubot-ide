'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, History, Pencil, Plus, Trash2 } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import { AGENT_MODES } from '@/lib/branding';
import type { ChatMessage, ChatMode, FileChange } from '@/lib/mock-data';
import type { ThreadSummary } from '@/lib/api/types';
import ActivityTimeline from './activity-timeline';
import FileChangeCard from './file-change-card';
import PlanStepCard from './plan-step-card';
import AgentComposer, { type CodeContext } from './agent-composer';

export type { CodeContext };

export interface AgentPanelProps {
  messages: ChatMessage[];
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  busy: boolean;

  input: string;
  onInputChange: (value: string) => void;
  onSend: (text?: string) => void;
  onStop: () => void;

  threads: ThreadSummary[];
  activeThreadId: string | null;
  onNewThread: () => void;
  onSelectThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;

  webSearch: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  activeFileName: string | null;
  codeContexts: CodeContext[];
  onRemoveContext: (id: string) => void;

  onOpenFile: (change: FileChange) => void;
  onRevertChange: (messageId: string, index: number) => void;
  reverting: { messageId: string; index: number } | null;

  onRunStep: (messageId: string, stepId: string) => void;
  onRunAllSteps: (messageId: string) => void;
  onDiscardStep: (messageId: string, stepId: string) => void;

  quickPrompts?: Array<{ label: string; prompt: string; icon?: 'fix' | 'explain' | 'improve' }>;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

const iconButton =
  'flex h-6 w-6 items-center justify-center rounded text-white/40 hover:text-white/90 hover:bg-white/[0.07] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent';

export default function AgentPanel(props: AgentPanelProps) {
  const {
    messages, mode, onModeChange, busy, input, onInputChange, onSend, onStop,
    threads, activeThreadId, onNewThread, onSelectThread, onDeleteThread, onRenameThread,
    webSearch, onWebSearchChange, activeFileName, codeContexts, onRemoveContext,
    onOpenFile, onRevertChange, reverting, onRunStep, onRunAllSteps, onDiscardStep, quickPrompts = [],
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const activeThread = threads.find(t => t.id === activeThreadId);
  const title = activeThread?.title ?? 'New chat';

  return (
    <aside className="relative flex h-full w-full flex-col border-l border-white/[0.08] bg-[#0e0e0e]">
      <div className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-white/[0.08] px-2">
        <span className="min-w-0 flex-1 truncate px-1 text-[12px] font-medium text-white/80" title={title}>
          {title}
        </span>
        {busy && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-white/60 animate-pulse" />}
        <button type="button" onClick={onNewThread} title="New chat" className={iconButton}>
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen(v => !v)}
          title="History"
          aria-expanded={historyOpen}
          className={`${iconButton} ${historyOpen ? 'bg-white/[0.07] text-white/90' : ''}`}
        >
          <History size={13} />
        </button>
      </div>

      {historyOpen && (
        <ThreadList
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={id => { onSelectThread(id); setHistoryOpen(false); }}
          onDelete={onDeleteThread}
          onRename={onRenameThread}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-3 text-center">
            <p className="text-[12px] text-white/50">{AGENT_MODES[mode].empty}</p>
            {quickPrompts.length > 0 && (
              <div className="mt-3 flex flex-col items-center gap-1">
                {quickPrompts.map(q => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => onSend(q.prompt)}
                    disabled={busy}
                    className="rounded px-2 py-1 text-[11.5px] text-white/40 hover:text-white/85 hover:bg-white/[0.05] disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map(message => (
          <MessageRow
            key={message.id}
            message={message}
            onOpenFile={onOpenFile}
            onRevert={index => onRevertChange(message.id, index)}
            revertingIndex={reverting?.messageId === message.id ? reverting.index : null}
            onRunStep={onRunStep}
            onRunAllSteps={onRunAllSteps}
            onDiscardStep={onDiscardStep}
          />
        ))}
      </div>

      <AgentComposer
        value={input}
        onChange={onInputChange}
        onSend={() => onSend()}
        onStop={onStop}
        busy={busy}
        mode={mode}
        onModeChange={onModeChange}
        webSearch={webSearch}
        onWebSearchChange={onWebSearchChange}
        activeFileName={activeFileName}
        codeContexts={codeContexts}
        onRemoveContext={onRemoveContext}
      />
    </aside>
  );
}

function ThreadList({
  threads, activeThreadId, onSelect, onDelete, onRename, onClose,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const commit = () => {
    if (editing) onRename(editing.id, editing.value);
    setEditing(null);
  };

  return (
    <div
      ref={ref}
      className="absolute right-2 top-9 z-30 w-[calc(100%-16px)] max-w-[360px] rounded-md border border-white/[0.1] bg-[#161616] shadow-xl shadow-black/60"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-1.5">
        <span className="text-[11px] font-medium text-white/50">Past chats</span>
        <span className="text-[10px] text-white/25">{threads.length}</span>
      </div>
      <ul className="max-h-72 overflow-y-auto py-1">
        {threads.length === 0 && <li className="px-3 py-3 text-[11.5px] text-white/35">No conversations yet.</li>}
        {threads.map(t => {
          const active = t.id === activeThreadId;
          const isEditing = editing?.id === t.id;
          return (
            <li key={t.id} className={`group flex items-center gap-2 px-2 ${active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}>
              {isEditing ? (
                <input
                  autoFocus
                  value={editing.value}
                  onChange={e => setEditing({ id: t.id, value: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={commit}
                  className="my-1 min-w-0 flex-1 rounded border border-white/[0.15] bg-black px-1.5 py-0.5 text-[12px] text-white/90 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left cursor-pointer"
                >
                  {active ? <Check size={11} className="flex-shrink-0 text-white/60" /> : <span className="w-[11px] flex-shrink-0" />}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">{t.title}</span>
                  <span className="flex-shrink-0 text-[10px] text-white/30">{relativeTime(t.updated_at)}</span>
                </button>
              )}
              {!isEditing && (
                <span className="flex flex-shrink-0 items-center opacity-0 group-hover:opacity-100">
                  <button type="button" title="Rename" onClick={() => setEditing({ id: t.id, value: t.title })} className={iconButton}>
                    <Pencil size={11} />
                  </button>
                  <button type="button" title="Delete" onClick={() => onDelete(t.id)} className={`${iconButton} hover:text-red-300`}>
                    <Trash2 size={11} />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MessageRow({
  message, onOpenFile, onRevert, revertingIndex, onRunStep, onRunAllSteps, onDiscardStep,
}: {
  message: ChatMessage;
  onOpenFile: (change: FileChange) => void;
  onRevert: (index: number) => void;
  revertingIndex: number | null;
  onRunStep: (messageId: string, stepId: string) => void;
  onRunAllSteps: (messageId: string) => void;
  onDiscardStep: (messageId: string, stepId: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="rounded-md border border-white/[0.08] bg-[#161616] px-3 py-2">
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {message.attachments.map(a => (
              <span key={a} className="rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px font-mono text-[10px] text-white/50">
                {a}
              </span>
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-white/85" style={{ wordBreak: 'break-word' }}>
          {message.content}
        </p>
      </div>
    );
  }

  const streaming = message.status === 'streaming';
  const errored = message.status === 'error';
  const steps = message.planSteps ?? [];
  const hasSteps = steps.length > 0;
  const activity = message.activity ?? [];
  const changes = message.fileOps ?? [];

  return (
    <div className="min-w-0 space-y-2 px-0.5">
      {(activity.length > 0 || streaming) && (
        <ActivityTimeline items={activity} live={streaming} statusText={message.statusText} />
      )}

      {errored && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/[0.05] px-2.5 py-2 text-[11.5px] text-red-200/85">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{message.content || 'Something went wrong.'}</span>
        </div>
      )}

      {!errored && message.content && !hasSteps && (
        <div className="min-w-0 break-words text-[12.5px] leading-relaxed text-white/80">
          <MarkdownRenderer content={message.content} />
          {streaming && <span className="ml-0.5 inline-block h-3 w-[2px] translate-y-[2px] bg-white/60 animate-pulse" aria-hidden />}
        </div>
      )}

      {hasSteps && <PlanSteps message={message} steps={steps} onRunStep={onRunStep} onRunAllSteps={onRunAllSteps} onDiscardStep={onDiscardStep} />}

      {changes.length > 0 && (
        <FileChangeCard changes={changes} onOpen={onOpenFile} onRevert={onRevert} revertingIndex={revertingIndex} />
      )}
    </div>
  );
}

function PlanSteps({
  message, steps, onRunStep, onRunAllSteps, onDiscardStep,
}: {
  message: ChatMessage;
  steps: NonNullable<ChatMessage['planSteps']>;
  onRunStep: (messageId: string, stepId: string) => void;
  onRunAllSteps: (messageId: string) => void;
  onDiscardStep: (messageId: string, stepId: string) => void;
}) {
  const anyRunning = steps.some(s => s.status === 'executing');
  const firstPending = steps.findIndex(s => s.status === 'pending');
  const visible = steps.filter((s, i) => s.status !== 'pending' || (!anyRunning && i === firstPending));
  const hidden = firstPending === -1 ? 0 : steps.length - firstPending - 1;
  const pending = steps.filter(s => s.status === 'pending').length;

  return (
    <div className="space-y-1.5">
      {message.content && (
        <div className="text-[12px] leading-relaxed text-white/60">
          <MarkdownRenderer content={message.content} />
        </div>
      )}
      <div className="flex items-center justify-between px-0.5 text-[10.5px] uppercase tracking-wide text-white/35">
        <span>Plan · {steps.length} step{steps.length === 1 ? '' : 's'}</span>
        {pending > 1 && !anyRunning && (
          <button
            type="button"
            onClick={() => onRunAllSteps(message.id)}
            className="rounded px-1.5 py-0.5 normal-case tracking-normal text-white/60 hover:bg-white/[0.07] hover:text-white/90 transition-colors cursor-pointer"
          >
            Run all {pending}
          </button>
        )}
      </div>
      {visible.map(step => (
        <PlanStepCard key={step.id} step={step} messageId={message.id} onRun={onRunStep} onDiscard={onDiscardStep} />
      ))}
      {hidden > 0 && (
        <p className="px-0.5 text-[10.5px] text-white/30">{hidden} more step{hidden > 1 ? 's' : ''} after this one</p>
      )}
    </div>
  );
}

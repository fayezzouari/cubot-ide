'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle, Bug, FileSearch, ListChecks, Sparkles, Trash2, Wand2 } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import { AGENT, AGENT_MODES } from '@/lib/branding';
import type { ChatMessage, ChatMode, FileChange } from '@/lib/mock-data';
import AgentMark from './agent-mark';
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
  onClear: () => void;

  webSearch: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  activeFileName: string | null;
  includeActiveFile: boolean;
  onIncludeActiveFileChange: (include: boolean) => void;
  codeContexts: CodeContext[];
  onRemoveContext: (id: string) => void;

  onOpenFile: (change: FileChange) => void;
  onRevertChange: (messageId: string, index: number) => void;
  reverting: { messageId: string; index: number } | null;

  onRunStep: (messageId: string, stepId: string) => void;
  onRunAllSteps: (messageId: string) => void;
  onDiscardStep: (messageId: string, stepId: string) => void;

  /** Prompts offered on an empty conversation. Each sends immediately. */
  quickPrompts?: Array<{ label: string; prompt: string; icon?: 'fix' | 'explain' | 'improve' }>;
}

const QUICK_ICONS = { fix: Bug, explain: FileSearch, improve: Wand2 } as const;

export default function AgentPanel(props: AgentPanelProps) {
  const {
    messages, mode, onModeChange, busy, input, onInputChange, onSend, onStop, onClear,
    webSearch, onWebSearchChange, activeFileName, includeActiveFile, onIncludeActiveFileChange,
    codeContexts, onRemoveContext, onOpenFile, onRevertChange, reverting,
    onRunStep, onRunAllSteps, onDiscardStep, quickPrompts = [],
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Follow new content unless the user scrolled up to read something.
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

  const empty = messages.length === 0;

  return (
    <aside className="flex h-full w-full flex-col border-l border-white/[0.06] bg-[#0b0b0b]">
      {/* Header */}
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-3">
        <AgentMark size={22} active={busy} />
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[13px] font-semibold tracking-tight text-white/90">{AGENT.name}</span>
          <span className="truncate text-[10.5px] text-white/30">{busy ? 'working' : AGENT.tagline}</span>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <span
            className={`mr-1 rounded-full border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider ${
              mode === 'plan' ? 'border-sky-400/30 text-sky-300/80' : 'border-amber-400/30 text-amber-300/80'
            }`}
          >
            {AGENT_MODES[mode].label}
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={busy || empty}
            title="Clear conversation"
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {empty && (
          <div className="flex h-full flex-col items-center justify-center px-2 text-center">
            <AgentMark size={40} className="mb-4 rounded-xl" />
            <p className="text-[13px] font-semibold text-white/85">
              {AGENT.name}
              <span className="ml-1.5 font-normal text-white/35">{AGENT.tagline}</span>
            </p>
            <p className="mt-1 max-w-[240px] text-[11.5px] leading-relaxed text-white/40">
              {mode === 'plan' ? AGENT_MODES.plan.hint : AGENT.intro}
            </p>
            {quickPrompts.length > 0 && (
              <div className="mt-5 flex w-full max-w-[260px] flex-col gap-1.5">
                {quickPrompts.map(q => {
                  const Icon = q.icon ? QUICK_ICONS[q.icon] : Sparkles;
                  return (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => onSend(q.prompt)}
                      disabled={busy}
                      className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-left text-[11.5px] text-white/60 transition-colors hover:border-amber-400/30 hover:bg-amber-400/[0.05] hover:text-white/85 disabled:opacity-40 cursor-pointer"
                    >
                      <Icon size={12} className="flex-shrink-0 text-amber-300/80" />
                      {q.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {messages.map(message => (
          <MessageRow
            key={message.id}
            message={message}
            mode={mode}
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
        includeActiveFile={includeActiveFile}
        onIncludeActiveFileChange={onIncludeActiveFileChange}
        codeContexts={codeContexts}
        onRemoveContext={onRemoveContext}
      />
    </aside>
  );
}

function MessageRow({
  message, mode, onOpenFile, onRevert, revertingIndex, onRunStep, onRunAllSteps, onDiscardStep,
}: {
  message: ChatMessage;
  mode: ChatMode;
  onOpenFile: (change: FileChange) => void;
  onRevert: (index: number) => void;
  revertingIndex: number | null;
  onRunStep: (messageId: string, stepId: string) => void;
  onRunAllSteps: (messageId: string) => void;
  onDiscardStep: (messageId: string, stepId: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-xl rounded-br-sm bg-white/[0.07] px-3 py-2 text-[12px] leading-relaxed text-white/85">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {message.attachments.map(a => (
                <span key={a} className="rounded border border-white/[0.1] px-1 font-mono text-[10px] text-white/45">{a}</span>
              ))}
            </div>
          )}
          <p className="whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word' }}>{message.content}</p>
        </div>
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
    <div className="flex items-start gap-2.5">
      <AgentMark size={20} active={streaming} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        {(activity.length > 0 || streaming) && (
          <ActivityTimeline items={activity} live={streaming} statusText={message.statusText} />
        )}

        {errored && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.05] px-2.5 py-2 text-[11.5px] text-red-200/85">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{message.content || 'Something went wrong.'}</span>
          </div>
        )}

        {!errored && message.content && !hasSteps && (
          <div className="prose prose-sm max-w-none text-[12px] leading-relaxed text-white/75 [&_pre]:whitespace-pre-wrap [&_code]:break-words">
            <MarkdownRenderer content={message.content} />
          </div>
        )}

        {hasSteps && <PlanSteps message={message} steps={steps} onRunStep={onRunStep} onRunAllSteps={onRunAllSteps} onDiscardStep={onDiscardStep} />}

        {changes.length > 0 && (
          <FileChangeCard changes={changes} onOpen={onOpenFile} onRevert={onRevert} revertingIndex={revertingIndex} />
        )}

        {message.mode && message.mode !== mode && (
          <p className="text-[10px] uppercase tracking-wider text-white/20">{AGENT_MODES[message.mode].label} mode</p>
        )}
      </div>
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
  // Show resolved steps plus the next pending one; the rest wait until it's their turn.
  const visible = steps.filter((s, i) => s.status !== 'pending' || (!anyRunning && i === firstPending));
  const hidden = firstPending === -1 ? 0 : steps.length - firstPending - 1;
  const pending = steps.filter(s => s.status === 'pending').length;

  return (
    <div className="space-y-2">
      {message.content && (
        <div className="text-[11.5px] leading-relaxed text-white/50">
          <MarkdownRenderer content={message.content} />
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-sky-300/70">
        <ListChecks size={11} />
        Plan · {steps.length} step{steps.length === 1 ? '' : 's'}
      </div>
      {visible.map(step => (
        <PlanStepCard key={step.id} step={step} messageId={message.id} onRun={onRunStep} onDiscard={onDiscardStep} />
      ))}
      {hidden > 0 && (
        <div className="flex items-center gap-2 px-1 py-1">
          <div className="h-px flex-1 bg-white/[0.06]" />
          <span className="whitespace-nowrap text-[10.5px] text-white/25">{hidden} more to review</span>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>
      )}
      {pending > 1 && !anyRunning && (
        <button
          type="button"
          onClick={() => onRunAllSteps(message.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-sky-400/25 bg-sky-400/[0.06] py-1.5 text-[11px] font-semibold text-sky-200 transition-colors hover:bg-sky-400/[0.12] cursor-pointer"
        >
          Run all {pending} steps
        </button>
      )}
    </div>
  );
}

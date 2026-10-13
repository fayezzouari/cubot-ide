'use client';

import { useEffect, useRef } from 'react';
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

const QUICK_GLYPH = { fix: '☠', explain: '?', improve: '⚒' } as const;

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
  const modeColor = mode === 'plan' ? '#5ab4ff' : '#ffb000';

  return (
    <aside className="scanlines relative flex h-full w-full flex-col border-l-2 border-forge-line bg-forge-panel">
      {/* Header */}
      <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b-2 border-forge-line bg-black px-3">
        <AgentMark size={24} active={busy} />
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-pixel text-[11px] font-bold uppercase tracking-wide text-forge-ink">{AGENT.name}</span>
          <span className="truncate font-pixel text-[7px] uppercase text-forge-dim">
            {busy ? <span className="animate-pixel-blink text-forge-amber">working</span> : AGENT.tagline}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className="pixel-border px-1.5 py-0.5 font-pixel text-[7px] uppercase text-black"
            style={{ ['--pb' as string]: modeColor, backgroundColor: modeColor }}
          >
            {AGENT_MODES[mode].label}
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={busy || empty}
            title="Clear conversation"
            className="pixel-border pixel-btn bg-black px-1.5 py-0.5 font-pixel text-[7px] uppercase text-forge-dim hover:text-forge-red disabled:opacity-30 disabled:hover:text-forge-dim cursor-pointer disabled:cursor-default"
          >
            clr
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="relative flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {empty && (
          <div className="flex h-full flex-col items-center justify-center px-2 text-center">
            <AgentMark size={64} className="mb-5" />
            <p className="font-pixel text-[13px] font-bold uppercase tracking-wide text-forge-ink">{AGENT.name}</p>
            <p className="mt-1 font-pixel text-[7px] uppercase text-forge-dim">{AGENT.tagline}</p>
            <p className="mt-3 max-w-[260px] font-pixel-body text-[16px] leading-tight text-forge-dim">
              {mode === 'plan' ? AGENT_MODES.plan.hint : AGENT.intro}
            </p>
            {quickPrompts.length > 0 && (
              <div className="mt-6 flex w-full max-w-[280px] flex-col gap-3">
                <p className="font-pixel text-[7px] uppercase text-forge-dim/70">— select —</p>
                {quickPrompts.map(q => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => onSend(q.prompt)}
                    disabled={busy}
                    className="pixel-border pixel-btn group flex items-center gap-3 bg-black px-3 py-2 text-left font-pixel-body text-[16px] leading-none text-forge-ink hover:bg-forge-raised disabled:opacity-40 cursor-pointer"
                  >
                    <span className="w-3 font-pixel text-[9px] text-forge-amber opacity-0 group-hover:opacity-100">▶</span>
                    <span className="w-4 font-pixel text-[9px] text-forge-dim">{q.icon ? QUICK_GLYPH[q.icon] : '•'}</span>
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
      <div className="flex justify-end pr-1">
        <div className="pixel-border max-w-[88%] bg-forge-raised px-3 py-2" style={{ ['--pb' as string]: '#3a2f22' }}>
          <div className="mb-1 flex flex-wrap items-center gap-2 font-pixel text-[7px] uppercase text-forge-dim">
            <span>you</span>
            {message.attachments?.map(a => (
              <span key={a} className="font-pixel-body text-[13px] normal-case text-forge-dim/80">[{a}]</span>
            ))}
          </div>
          <p className="whitespace-pre-wrap break-words font-pixel-body text-[16px] leading-tight text-forge-ink" style={{ wordBreak: 'break-word' }}>
            {message.content}
          </p>
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
    <div className="flex items-start gap-3">
      <AgentMark size={22} active={streaming} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-3">
        {(activity.length > 0 || streaming) && (
          <ActivityTimeline items={activity} live={streaming} statusText={message.statusText} />
        )}

        {errored && (
          <div className="pixel-border bg-black px-3 py-2 font-pixel-body text-[15px] leading-tight text-forge-red" style={{ ['--pb' as string]: '#ff4d4d' }}>
            <span className="mr-2 font-pixel text-[8px] uppercase">error</span>
            {message.content || 'Something went wrong.'}
          </div>
        )}

        {!errored && message.content && !hasSteps && (
          <div className="font-pixel-body text-[16px] leading-tight text-forge-ink/90">
            <MarkdownRenderer content={message.content} variant="pixel" />
          </div>
        )}

        {hasSteps && <PlanSteps message={message} steps={steps} onRunStep={onRunStep} onRunAllSteps={onRunAllSteps} onDiscardStep={onDiscardStep} />}

        {changes.length > 0 && (
          <FileChangeCard changes={changes} onOpen={onOpenFile} onRevert={onRevert} revertingIndex={revertingIndex} />
        )}

        {message.mode && message.mode !== mode && (
          <p className="font-pixel text-[7px] uppercase text-forge-dim/60">{AGENT_MODES[message.mode].label} mode</p>
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
    <div className="space-y-3">
      {message.content && (
        <div className="font-pixel-body text-[15px] leading-tight text-forge-dim">
          <MarkdownRenderer content={message.content} variant="pixel" />
        </div>
      )}
      <div className="font-pixel text-[8px] uppercase tracking-wide text-forge-blue">
        ≡ quest log · {steps.length} step{steps.length === 1 ? '' : 's'}
      </div>
      {visible.map(step => (
        <PlanStepCard key={step.id} step={step} messageId={message.id} onRun={onRunStep} onDiscard={onDiscardStep} />
      ))}
      {hidden > 0 && (
        <p className="text-center font-pixel text-[7px] uppercase text-forge-dim/70">
          ▼ {hidden} more locked ▼
        </p>
      )}
      {pending > 1 && !anyRunning && (
        <button
          type="button"
          onClick={() => onRunAllSteps(message.id)}
          className="pixel-border pixel-btn w-full bg-black py-1.5 font-pixel text-[8px] uppercase text-forge-blue hover:bg-forge-raised cursor-pointer"
          style={{ ['--pb' as string]: '#5ab4ff' }}
        >
          ▶▶ run all {pending} steps
        </button>
      )}
    </div>
  );
}

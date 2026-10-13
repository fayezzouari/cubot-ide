'use client';

import { useEffect, useRef } from 'react';
import { AlertCircle, Bot, CheckCheck, ListChecks, Loader2, Sparkles, Trash2, User, Zap } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import { AGENT, AGENT_MODES } from '@/lib/branding';
import type { ChatMessage, ChatMode, FileChange } from '@/lib/mock-data';
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

export default function AgentPanel(props: AgentPanelProps) {
  const {
    messages, mode, onModeChange, busy, input, onInputChange, onSend, onStop, onClear,
    webSearch, onWebSearchChange, activeFileName,
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

  return (
    <aside className="w-full h-full border-l border-white/[0.06] flex flex-col bg-[#0b0b0b]">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2 flex-shrink-0">
        <div className="w-6 h-6 rounded-md bg-white/[0.06] flex items-center justify-center">
          <Bot size={13} className="text-white/60" />
        </div>
        <span className="text-xs font-semibold text-white/70">{AGENT.name}</span>

        <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
          <button
            onClick={() => onModeChange('build')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
              mode === 'build' ? 'bg-white/[0.08] text-white/80' : 'text-white/30 hover:text-white/50'
            }`}
          >
            <Zap size={10} />
            {AGENT_MODES.build.label}
          </button>
          <button
            onClick={() => onModeChange('plan')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
              mode === 'plan' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-white/30 hover:text-white/50'
            }`}
          >
            <ListChecks size={10} />
            {AGENT_MODES.plan.label}
          </button>
        </div>

        <button
          onClick={onClear}
          disabled={busy}
          title="Clear conversation"
          className="p-1 rounded-md text-white/25 hover:text-white/60 hover:bg-white/[0.06] disabled:opacity-30 transition-colors cursor-pointer ml-1"
        >
          <Trash2 size={12} />
        </button>

        {busy && <Loader2 size={12} className="animate-spin text-white/30 ml-1" />}
      </div>

      {/* Plan mode banner */}
      {mode === 'plan' && (
        <div className="px-3 py-2 border-b border-blue-500/10 bg-blue-500/[0.04] flex items-center gap-2">
          <ListChecks size={11} className="text-blue-400 flex-shrink-0" />
          <p className="text-[10px] text-blue-300/60 leading-snug">{AGENT_MODES.plan.hint}</p>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <div className="w-10 h-10 rounded-xl border border-white/[0.08] bg-white/[0.04] flex items-center justify-center mb-4">
              <Bot size={18} className="text-white/30" />
            </div>
            <p className="text-xs font-semibold text-white/60 mb-1">{AGENT.name}</p>
            <p className="text-[11px] text-white/25 leading-relaxed max-w-[200px]">{AGENT_MODES[mode].empty}</p>
            {quickPrompts.length > 0 && (
              <div className="mt-4 flex w-full max-w-[220px] flex-col gap-1.5">
                {quickPrompts.map(q => (
                  <button
                    key={q.label}
                    onClick={() => onSend(q.prompt)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] text-left text-[10px] text-white/40 hover:text-white/70 hover:bg-white/[0.05] disabled:opacity-40 transition-colors cursor-pointer"
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
        webSearch={webSearch}
        onWebSearchChange={onWebSearchChange}
        activeFileName={activeFileName}
        codeContexts={codeContexts}
        onRemoveContext={onRemoveContext}
      />
    </aside>
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
  const isUser = message.role === 'user';
  const streaming = message.status === 'streaming';
  const errored = message.status === 'error';
  const steps = message.planSteps ?? [];
  const hasSteps = steps.length > 0;
  const activity = message.activity ?? [];
  const changes = message.fileOps ?? [];

  return (
    <div className={`flex gap-2 items-start ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md ${isUser ? 'bg-white/[0.06] text-white/40' : 'bg-blue-500/10 text-blue-400'}`}>
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>

      <div
        className={`flex-1 min-w-0 text-xs leading-relaxed ${isUser ? 'px-3 py-2.5 rounded-xl bg-white/[0.06] text-white/70' : 'bg-transparent text-white/60'}`}
        style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
      >
        {isUser ? (
          <>
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {message.attachments.map(a => (
                  <span key={a} className="rounded border border-white/[0.1] px-1 font-mono text-[9px] text-white/35">{a}</span>
                ))}
              </div>
            )}
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </>
        ) : (
          <div className="px-1">
            {(activity.length > 0 || streaming) && (
              <ActivityTimeline items={activity} live={streaming} statusText={message.statusText} />
            )}

            {streaming && activity.length === 0 && !message.content && (
              <div className="flex items-center gap-2 text-white/30 py-1">
                <Sparkles size={11} className="animate-pulse" />
                <span>{message.statusText || 'Thinking…'}</span>
              </div>
            )}

            {errored && (
              <div className="flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-2.5 py-2 text-[11px] text-red-300/80">
                <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
                <span>{message.content || 'Something went wrong.'}</span>
              </div>
            )}

            {!errored && message.content && !hasSteps && (
              <div className="min-w-0 break-words">
                <MarkdownRenderer content={message.content} />
                {streaming && <span className="inline-block w-[2px] h-3 ml-0.5 align-middle bg-white/50 animate-pulse" aria-hidden />}
              </div>
            )}

            {hasSteps && <PlanSteps message={message} steps={steps} onRunStep={onRunStep} onRunAllSteps={onRunAllSteps} onDiscardStep={onDiscardStep} />}

            {changes.length > 0 && (
              <FileChangeCard changes={changes} onOpen={onOpenFile} onRevert={onRevert} revertingIndex={revertingIndex} />
            )}
          </div>
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
        <div className="px-1 pb-1 prose prose-sm max-w-none text-white/40 text-[11px]">
          <MarkdownRenderer content={message.content} />
        </div>
      )}
      {visible.map(step => (
        <PlanStepCard key={step.id} step={step} messageId={message.id} onRun={onRunStep} onDiscard={onDiscardStep} />
      ))}
      {hidden > 0 && (
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex-1 h-px bg-white/[0.06]" />
          <span className="text-[10px] text-white/20 whitespace-nowrap">{hidden} more step{hidden > 1 ? 's' : ''} to review</span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>
      )}
      {pending > 1 && !anyRunning && (
        <button
          onClick={() => onRunAllSteps(message.id)}
          className="w-full flex items-center justify-center gap-1.5 mt-1 py-1.5 rounded-xl text-[10px] font-semibold border border-blue-500/20 bg-blue-500/[0.06] text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
        >
          <CheckCheck size={11} />
          Execute all {pending} steps
        </button>
      )}
    </div>
  );
}

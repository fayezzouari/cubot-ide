'use client';

import { useRef, useEffect, useState } from 'react';
import {
  Bot, User, Send, Loader2, X, Code2, Sparkles,
  Zap, ListChecks, Check, CheckCheck, Trash2, ChevronDown, ChevronUp,
  Terminal, AlertCircle,
} from 'lucide-react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import type { ChatMessage, ChatMode, PlanStep, PlanStepExecutionResult } from '@/lib/mock-data';

export interface CodeContext {
  id: string;
  fileName: string;
  startLine: number;
  endLine: number;
  content: string;
}

interface ChatSidebarProps {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  isLoading?: boolean;
  codeContexts?: CodeContext[];
  onRemoveContext?: (id: string) => void;
  chatMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  onAcceptStep: (messageId: string, stepId: string) => void;
  onAcceptAllSteps: (messageId: string) => void;
  onDiscardStep: (messageId: string, stepId: string) => void;
}

function ExecutionLogBlock({ logs }: { logs: PlanStepExecutionResult['logs'] }) {
  const [expanded, setExpanded] = useState(false);
  if (logs.length === 0) return null;
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 text-[10px] text-white/25 hover:text-white/40 transition-colors cursor-pointer"
      >
        <Terminal size={9} />
        {expanded ? 'Hide' : 'Show'} {logs.length} command{logs.length > 1 ? 's' : ''}
        {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1.5">
          {logs.map((log, i) => (
            <div key={i} className="rounded-lg bg-black/40 border border-white/[0.05] p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.success ? 'bg-green-500' : 'bg-red-500'}`} />
                <code className="text-[10px] text-white/50 font-mono truncate">{log.command}</code>
              </div>
              {log.stdout && (
                <pre className="text-[9px] text-white/30 font-mono whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto">{log.stdout.trim()}</pre>
              )}
              {log.stderr && (
                <pre className="text-[9px] text-red-400/50 font-mono whitespace-pre-wrap leading-relaxed max-h-16 overflow-y-auto">{log.stderr.trim()}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanStepCard({
  step,
  messageId,
  onAccept,
  onDiscard,
}: {
  step: PlanStep;
  messageId: string;
  onAccept: (messageId: string, stepId: string) => void;
  onDiscard: (messageId: string, stepId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isPending = step.status === 'pending';
  const isExecuting = step.status === 'executing';
  const isDone = step.status === 'done';
  const isDiscarded = step.status === 'discarded';
  const failed = isDone && step.executionResult && !step.executionResult.success;

  return (
    <div
      className={`rounded-xl border transition-colors ${
        isDone && !failed
          ? 'border-green-500/20 bg-green-500/[0.04]'
          : failed
          ? 'border-red-500/20 bg-red-500/[0.03]'
          : isExecuting
          ? 'border-blue-500/20 bg-blue-500/[0.04]'
          : isDiscarded
          ? 'border-white/[0.05] bg-transparent opacity-40'
          : 'border-white/[0.08] bg-white/[0.02]'
      }`}
    >
      {/* Step header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Step number / status badge */}
        <div
          className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
            isDone && !failed
              ? 'bg-green-500/20 text-green-400'
              : failed
              ? 'bg-red-500/20 text-red-400'
              : isExecuting
              ? 'bg-blue-500/10 text-blue-400'
              : isDiscarded
              ? 'bg-white/[0.06] text-white/30'
              : 'bg-blue-500/10 text-blue-400'
          }`}
        >
          {isExecuting ? (
            <Loader2 size={10} className="animate-spin" />
          ) : isDone && !failed ? (
            <Check size={10} />
          ) : failed ? (
            <AlertCircle size={10} />
          ) : (
            step.stepNumber
          )}
        </div>

        {/* Title */}
        <span
          className={`flex-1 text-[11px] font-semibold leading-tight ${
            isDiscarded
              ? 'line-through text-white/30'
              : isDone && !failed
              ? 'text-green-300/80'
              : failed
              ? 'text-red-300/80'
              : isExecuting
              ? 'text-blue-300/80'
              : 'text-white/70'
          }`}
        >
          {step.title}
        </span>

        {/* Status label */}
        {isExecuting && (
          <span className="text-[9px] text-blue-400/60 font-medium">Running…</span>
        )}
        {isDone && !failed && (
          <span className="text-[9px] text-green-400/60 font-medium">Done</span>
        )}
        {failed && (
          <span className="text-[9px] text-red-400/60 font-medium">Failed</span>
        )}

        {/* Expand toggle for body */}
        {step.body && !isExecuting && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-white/20 hover:text-white/50 transition-colors cursor-pointer"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>

      {/* Body */}
      {step.body && expanded && !isExecuting && (
        <div className="px-3 pb-2">
          <div className="text-[11px] text-white/40 leading-relaxed pl-7">
            <MarkdownRenderer content={step.body} />
          </div>
        </div>
      )}

      {/* Execution result */}
      {isDone && step.executionResult && (
        <div className="px-3 pb-2.5 pl-10 space-y-1">
          {step.executionResult.message && (
            <p className="text-[11px] text-white/40 leading-snug">{step.executionResult.message}</p>
          )}
          <ExecutionLogBlock logs={step.executionResult.logs} />
        </div>
      )}

      {/* Actions — only on pending steps */}
      {isPending && (
        <div className="flex items-center gap-1.5 px-3 pb-2.5 pl-10">
          <button
            onClick={() => onAccept(messageId, step.id)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-colors cursor-pointer"
          >
            <Zap size={9} />
            Execute step
          </button>
          <button
            onClick={() => onDiscard(messageId, step.id)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/[0.04] border border-white/[0.08] text-white/30 hover:text-white/50 hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <Trash2 size={9} />
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChatSidebar({
  messages,
  chatInput,
  onChatInputChange,
  onSendMessage,
  isLoading = false,
  codeContexts = [],
  onRemoveContext,
  chatMode,
  onModeChange,
  onAcceptStep,
  onAcceptAllSteps,
  onDiscardStep,
}: ChatSidebarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [chatInput]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      onSendMessage();
    }
  };

  return (
    <aside className="w-full h-full border-l border-white/[0.06] flex flex-col bg-[#0b0b0b]">

      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2 flex-shrink-0">
        <div className="w-6 h-6 rounded-md bg-white/[0.06] flex items-center justify-center">
          <Bot size={13} className="text-white/60" />
        </div>
        <span className="text-xs font-semibold text-white/70">AI Assistant</span>

        {/* Mode toggle */}
        <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
          <button
            onClick={() => onModeChange('vibe')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
              chatMode === 'vibe'
                ? 'bg-white/[0.08] text-white/80'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            <Zap size={10} />
            Vibe
          </button>
          <button
            onClick={() => onModeChange('plan')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
              chatMode === 'plan'
                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            <ListChecks size={10} />
            Plan
          </button>
        </div>

        {isLoading && <Loader2 size={12} className="animate-spin text-white/30 ml-1" />}
      </div>

      {/* Plan mode banner */}
      {chatMode === 'plan' && (
        <div className="px-3 py-2 border-b border-blue-500/10 bg-blue-500/[0.04] flex items-center gap-2">
          <ListChecks size={11} className="text-blue-400 flex-shrink-0" />
          <p className="text-[10px] text-blue-300/60 leading-snug">
            Plan mode — AI will break your request into structured steps you can review before applying.
          </p>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <div className="w-10 h-10 rounded-xl border border-white/[0.08] bg-white/[0.04] flex items-center justify-center mb-4">
              <Bot size={18} className="text-white/30" />
            </div>
            <p className="text-xs font-semibold text-white/60 mb-1">AI Assistant</p>
            <p className="text-[11px] text-white/25 leading-relaxed max-w-[200px]">
              {chatMode === 'plan'
                ? 'Describe what you want to build and the AI will create a step-by-step plan.'
                : 'Ask questions about your code or get help with programming tasks.'}
            </p>
          </div>
        )}

        {messages.map((message, index) => {
          const isUser = message.role === 'user';
          const isAssistant = message.role === 'assistant';
          const isThinking = message.content === '...';
          const hasPlanSteps = isAssistant && message.planSteps && message.planSteps.length > 0;
          const pendingSteps = message.planSteps?.filter((s) => s.status === 'pending') ?? [];
          const hasPendingOps = (message.pendingFileOps?.length ?? 0) > 0;

          return (
            <div
              key={`${message.id}-${index}`}
              className={`flex gap-2 items-start ${isUser ? 'flex-row-reverse' : ''}`}
            >
              {/* Avatar */}
              <div className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md ${
                isAssistant
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'bg-white/[0.06] text-white/40'
              }`}>
                {isAssistant ? <Bot size={12} /> : <User size={12} />}
              </div>

              {/* Bubble */}
              <div
                className={`flex-1 min-w-0 ${
                  isUser
                    ? 'px-3 py-2.5 rounded-xl bg-white/[0.06] text-white/70'
                    : 'bg-transparent text-white/60'
                } text-xs leading-relaxed`}
                style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
              >
                {isAssistant ? (
                  isThinking ? (
                    <div className="flex items-center gap-2 text-white/30 px-3 py-2.5">
                      <Sparkles size={11} className="animate-pulse" />
                      <span>{chatMode === 'plan' ? 'Planning…' : 'Thinking…'}</span>
                    </div>
                  ) : hasPlanSteps ? (
                    /* Plan mode: reveal steps one at a time */
                    (() => {
                      const allSteps = message.planSteps!;
                      const isAnyExecuting = allSteps.some(s => s.status === 'executing');
                      const firstPendingIdx = allSteps.findIndex(s => s.status === 'pending');
                      // While a step is executing, show only resolved/executing steps (no next pending yet).
                      // Once it finishes, reveal the next pending step for the user to act on.
                      const visibleSteps = allSteps.filter(
                        (s, i) => s.status !== 'pending' || (!isAnyExecuting && i === firstPendingIdx)
                      );
                      const hiddenCount =
                        firstPendingIdx === -1
                          ? 0
                          : allSteps.length - firstPendingIdx - 1;
                      const allDone = firstPendingIdx === -1;

                      return (
                        <div className="space-y-2">
                          {/* Optional intro text */}
                          {message.content && (
                            <div className="px-1 pb-1 prose prose-sm max-w-none text-white/40 text-[11px]">
                              <MarkdownRenderer content={message.content} />
                            </div>
                          )}

                          {visibleSteps.map((step) => (
                            <PlanStepCard
                              key={step.id}
                              step={step}
                              messageId={message.id}
                              onAccept={onAcceptStep}
                              onDiscard={onDiscardStep}
                            />
                          ))}

                          {/* "N more steps" hint */}
                          {hiddenCount > 0 && (
                            <div className="flex items-center gap-2 px-3 py-2">
                              <div className="flex-1 h-px bg-white/[0.06]" />
                              <span className="text-[10px] text-white/20 whitespace-nowrap">
                                {hiddenCount} more step{hiddenCount > 1 ? 's' : ''} to review
                              </span>
                              <div className="flex-1 h-px bg-white/[0.06]" />
                            </div>
                          )}

                          {/* Execute all — only when multiple pending remain */}
                          {pendingSteps.length > 1 && (
                            <button
                              onClick={() => onAcceptAllSteps(message.id)}
                              className="w-full flex items-center justify-center gap-1.5 mt-1 py-1.5 rounded-xl text-[10px] font-semibold border border-blue-500/20 bg-blue-500/[0.06] text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
                            >
                              <CheckCheck size={11} />
                              Execute all {pendingSteps.length} steps
                            </button>
                          )}

                          {/* No more pending steps — nothing extra needed */}
                        </div>
                      );
                    })()
                  ) : (
                    /* Vibe mode (or plan response without detected steps) */
                    <div className="prose prose-sm max-w-none break-words [&>*]:break-words [&_pre]:whitespace-pre-wrap [&_code]:break-words [&_p]:break-words">
                      <MarkdownRenderer content={message.content} />
                    </div>
                  )
                ) : (
                  <p className="whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word' }}>
                    {message.content}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-white/[0.06] flex-shrink-0 space-y-2">

        {/* Code context chips */}
        {codeContexts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {codeContexts.map((ctx) => (
              <div
                key={ctx.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-[10px] font-mono text-blue-300"
              >
                <Code2 size={10} className="text-blue-400 flex-shrink-0" />
                <span>
                  {ctx.fileName}:{ctx.startLine}
                  {ctx.endLine !== ctx.startLine ? `-${ctx.endLine}` : ''}
                </span>
                {onRemoveContext && (
                  <button
                    onClick={() => onRemoveContext(ctx.id)}
                    className="text-blue-400/50 hover:text-blue-300 transition-colors -mr-0.5 cursor-pointer"
                    aria-label="Remove context"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className={`flex items-end gap-2 bg-[#161616] border rounded-xl px-3 py-2 focus-within:border-white/20 transition-colors ${
          chatMode === 'plan' ? 'border-blue-500/20 focus-within:border-blue-500/40' : 'border-white/[0.08]'
        }`}>
          <textarea
            ref={textareaRef}
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              chatMode === 'plan'
                ? 'Describe what to build — AI will plan the steps…'
                : 'Ask AI for help… (Shift+Enter for newline)'
            }
            disabled={isLoading}
            rows={2}
            className="flex-1 bg-transparent text-xs text-white/70 placeholder:text-white/20 focus:outline-none disabled:opacity-40 resize-none leading-relaxed min-h-[40px] max-h-[120px] overflow-y-auto"
          />
          <button
            onClick={onSendMessage}
            disabled={isLoading || !chatInput.trim()}
            className={`w-6 h-6 flex items-center justify-center disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed flex-shrink-0 mb-0.5 ${
              chatMode === 'plan'
                ? 'text-blue-400/50 hover:text-blue-400'
                : 'text-white/30 hover:text-white/70'
            }`}
          >
            {isLoading
              ? <Loader2 size={13} className="animate-spin" />
              : chatMode === 'plan'
              ? <ListChecks size={13} />
              : <Send size={13} />
            }
          </button>
        </div>
        <p className="text-[10px] text-white/15 text-center">Enter to send · Shift+Enter for newline</p>
      </div>
    </aside>
  );
}

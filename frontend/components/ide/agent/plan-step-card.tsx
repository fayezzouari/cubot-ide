'use client';

import { useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Loader2, Terminal, Trash2, Zap } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import type { ExecutionLog, PlanStep } from '@/lib/mock-data';
import FileChangeCard from './file-change-card';

function ExecutionLogBlock({ logs }: { logs: ExecutionLog[] }) {
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

interface PlanStepCardProps {
  step: PlanStep;
  messageId: string;
  onRun: (messageId: string, stepId: string) => void;
  onDiscard: (messageId: string, stepId: string) => void;
}

export default function PlanStepCard({ step, messageId, onRun, onDiscard }: PlanStepCardProps) {
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
      <div className="flex items-center gap-2 px-3 py-2">
        <div
          className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
            isDone && !failed
              ? 'bg-green-500/20 text-green-400'
              : failed
              ? 'bg-red-500/20 text-red-400'
              : isDiscarded
              ? 'bg-white/[0.06] text-white/30'
              : 'bg-blue-500/10 text-blue-400'
          }`}
        >
          {isExecuting ? <Loader2 size={10} className="animate-spin" /> : isDone && !failed ? <Check size={10} /> : failed ? <AlertCircle size={10} /> : step.stepNumber}
        </div>
        <span
          className={`flex-1 text-[11px] font-semibold leading-tight ${
            isDiscarded ? 'line-through text-white/30' : isDone && !failed ? 'text-green-300/80' : failed ? 'text-red-300/80' : isExecuting ? 'text-blue-300/80' : 'text-white/70'
          }`}
        >
          {step.title}
        </span>
        {isExecuting && <span className="text-[9px] text-blue-400/60 font-medium">Running…</span>}
        {isDone && !failed && <span className="text-[9px] text-green-400/60 font-medium">Done</span>}
        {failed && <span className="text-[9px] text-red-400/60 font-medium">Failed</span>}
        {step.body && !isExecuting && (
          <button onClick={() => setExpanded(v => !v)} className="text-white/20 hover:text-white/50 transition-colors cursor-pointer">
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>

      {step.body && expanded && !isExecuting && (
        <div className="px-3 pb-2">
          <div className="text-[11px] text-white/40 leading-relaxed pl-7">
            <MarkdownRenderer content={step.body} />
          </div>
        </div>
      )}

      {isDone && step.executionResult && (
        <div className="px-3 pb-2.5 pl-10 space-y-1">
          {step.executionResult.message && (
            <div className="text-[11px] text-white/40 leading-snug">
              <MarkdownRenderer content={step.executionResult.message} />
            </div>
          )}
          {step.executionResult.fileOps.length > 0 && <FileChangeCard changes={step.executionResult.fileOps} />}
          <ExecutionLogBlock logs={step.executionResult.logs} />
        </div>
      )}

      {isPending && (
        <div className="flex items-center gap-1.5 px-3 pb-2.5 pl-10">
          <button
            onClick={() => onRun(messageId, step.id)}
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

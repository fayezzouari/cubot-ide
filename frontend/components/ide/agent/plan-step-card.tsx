'use client';

import { useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Loader2, Play, Trash2 } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import type { ExecutionLog, PlanStep } from '@/lib/mock-data';
import FileChangeCard from './file-change-card';

function CommandLogs({ logs }: { logs: ExecutionLog[] }) {
  const [open, setOpen] = useState(false);
  if (logs.length === 0) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[10.5px] text-white/30 transition-colors hover:text-white/55 cursor-pointer"
      >
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        {logs.length} command{logs.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5">
          {logs.map((log, i) => (
            <div key={i} className="rounded-md border border-white/[0.05] bg-black/50 p-2">
              <div className="mb-1 flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${log.success ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <code className="truncate font-mono text-[10.5px] text-white/55">{log.command}</code>
              </div>
              {log.stdout && (
                <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-white/35">{log.stdout.trim()}</pre>
              )}
              {log.stderr && (
                <pre className="max-h-16 overflow-y-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-red-300/60">{log.stderr.trim()}</pre>
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

/** One step of a plan: run it, skip it, see what it did. */
export default function PlanStepCard({ step, messageId, onRun, onDiscard }: PlanStepCardProps) {
  const [expanded, setExpanded] = useState(true);
  const running = step.status === 'executing';
  const discarded = step.status === 'discarded';
  const done = step.status === 'done';
  const failed = done && step.executionResult && !step.executionResult.success;
  const pending = step.status === 'pending';

  const frame = failed
    ? 'border-red-500/25 bg-red-500/[0.04]'
    : done
    ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
    : running
    ? 'border-amber-500/30 bg-amber-500/[0.05]'
    : discarded
    ? 'border-white/[0.05] opacity-40'
    : 'border-white/[0.08] bg-white/[0.02]';

  const badge = failed
    ? 'bg-red-500/20 text-red-300'
    : done
    ? 'bg-emerald-500/20 text-emerald-300'
    : running
    ? 'bg-amber-500/20 text-amber-200'
    : 'bg-white/[0.06] text-white/50';

  return (
    <div className={`rounded-lg border transition-colors ${frame}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[10.5px] font-bold ${badge}`}>
          {running ? <Loader2 size={10} className="animate-spin" /> : failed ? <AlertCircle size={10} /> : done ? <Check size={10} /> : step.stepNumber}
        </div>
        <span className={`flex-1 text-[12px] font-semibold leading-tight ${discarded ? 'line-through text-white/30' : 'text-white/80'}`}>
          {step.title}
        </span>
        {running && <span className="text-[10.5px] text-amber-200/70">Running</span>}
        {done && !failed && <span className="text-[10.5px] text-emerald-300/70">Done</span>}
        {failed && <span className="text-[10.5px] text-red-300/70">Failed</span>}
        {step.body && !running && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-white/25 transition-colors hover:text-white/60 cursor-pointer"
            aria-label={expanded ? 'Collapse step' : 'Expand step'}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      {step.body && expanded && !running && (
        <div className="px-2.5 pb-2 pl-9 text-[11.5px] leading-relaxed text-white/50">
          <MarkdownRenderer content={step.body} />
        </div>
      )}

      {done && step.executionResult && (
        <div className="space-y-1.5 px-2.5 pb-2.5 pl-9">
          {step.executionResult.message && (
            <div className="text-[11.5px] leading-relaxed text-white/55">
              <MarkdownRenderer content={step.executionResult.message} />
            </div>
          )}
          {step.executionResult.fileOps.length > 0 && <FileChangeCard changes={step.executionResult.fileOps} />}
          <CommandLogs logs={step.executionResult.logs} />
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pl-9">
          <button
            type="button"
            onClick={() => onRun(messageId, step.id)}
            className="flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-400/20 cursor-pointer"
          >
            <Play size={9} />
            Run step
          </button>
          <button
            type="button"
            onClick={() => onDiscard(messageId, step.id)}
            className="flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-0.5 text-[11px] font-medium text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white/60 cursor-pointer"
          >
            <Trash2 size={9} />
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

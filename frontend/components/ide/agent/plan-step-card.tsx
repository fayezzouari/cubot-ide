'use client';

import { useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, Play, X } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import type { ExecutionLog, PlanStep } from '@/lib/mock-data';
import FileChangeCard from './file-change-card';

function CommandLogs({ logs }: { logs: ExecutionLog[] }) {
  const [open, setOpen] = useState(false);
  if (logs.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[10.5px] text-white/35 hover:text-white/65 transition-colors cursor-pointer"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {logs.length} command{logs.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {logs.map((log, i) => (
            <div key={i} className="rounded border border-white/[0.06] bg-black/50 p-2">
              <div className="mb-1 flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${log.success ? 'bg-green-400' : 'bg-red-400'}`} />
                <code className="truncate font-mono text-[10.5px] text-white/60">{log.command}</code>
              </div>
              {log.stdout && <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-white/40">{log.stdout.trim()}</pre>}
              {log.stderr && <pre className="max-h-16 overflow-y-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-red-300/70">{log.stderr.trim()}</pre>}
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
  const running = step.status === 'executing';
  const discarded = step.status === 'discarded';
  const done = step.status === 'done';
  const failed = done && step.executionResult && !step.executionResult.success;
  const pending = step.status === 'pending';

  const badge = failed
    ? 'bg-red-500/20 text-red-300'
    : done
    ? 'bg-green-500/20 text-green-300'
    : running
    ? 'bg-white/[0.12] text-white/90'
    : pending
    ? 'bg-blue-500/20 text-blue-200'
    : 'bg-white/[0.06] text-white/35';

  return (
    <div className={`rounded-md border bg-[#121212] ${running ? 'border-white/20' : 'border-white/[0.08]'} ${discarded ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[10px] font-semibold ${badge}`}>
          {running ? <Loader2 size={9} className="animate-spin" /> : failed ? <AlertCircle size={9} /> : done ? <Check size={9} /> : step.stepNumber}
        </span>
        <span className={`min-w-0 flex-1 truncate text-[12px] ${discarded ? 'line-through text-white/35' : 'text-white/85'}`}>
          {step.title}
        </span>
        {running && <span className="text-[10.5px] text-white/50">Running</span>}
        {done && !failed && <span className="text-[10.5px] text-green-300/70">Done</span>}
        {failed && <span className="text-[10.5px] text-red-300/80">Failed</span>}
        {pending && (
          <>
            <button
              type="button"
              onClick={() => onRun(messageId, step.id)}
              className="flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-black hover:bg-white/85 transition-colors cursor-pointer"
            >
              <Play size={9} fill="currentColor" />
              Run
            </button>
            <button
              type="button"
              onClick={() => onDiscard(messageId, step.id)}
              title="Skip this step"
              className="flex h-5 w-5 items-center justify-center rounded text-white/35 hover:bg-white/[0.07] hover:text-white/80 transition-colors cursor-pointer"
            >
              <X size={11} />
            </button>
          </>
        )}
        {step.body && !running && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="flex h-5 w-5 items-center justify-center rounded text-white/30 hover:text-white/70 cursor-pointer"
            aria-label={expanded ? 'Collapse step' : 'Expand step'}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        )}
      </div>

      {((step.body && expanded && !running) || (done && step.executionResult)) && (
        <div className="space-y-1.5 border-t border-white/[0.06] px-2 py-1.5 pl-8">
          {step.body && expanded && !running && (
            <div className="text-[11.5px] leading-relaxed text-white/50">
              <MarkdownRenderer content={step.body} />
            </div>
          )}
          {done && step.executionResult && (
            <>
              {step.executionResult.message && (
                <div className="text-[11.5px] leading-relaxed text-white/65">
                  <MarkdownRenderer content={step.executionResult.message} />
                </div>
              )}
              {step.executionResult.fileOps.length > 0 && <FileChangeCard changes={step.executionResult.fileOps} />}
              <CommandLogs logs={step.executionResult.logs} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

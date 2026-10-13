'use client';

import { useState } from 'react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import type { ExecutionLog, PlanStep } from '@/lib/mock-data';
import FileChangeCard from './file-change-card';
import { PixelArrow, PixelCheck, PixelCross, PixelSpinner } from './agent-mark';

function CommandLogs({ logs }: { logs: ExecutionLog[] }) {
  const [open, setOpen] = useState(false);
  if (logs.length === 0) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 font-pixel text-[8px] uppercase text-forge-dim hover:text-forge-ink cursor-pointer"
      >
        <PixelArrow dir={open ? 'down' : 'right'} />
        {logs.length} command{logs.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {logs.map((log, i) => (
            <div key={i} className="pixel-border bg-black p-2">
              <div className="mb-1 flex items-center gap-1.5 font-pixel-body text-[14px] leading-none">
                <span className={`h-[6px] w-[6px] flex-shrink-0 ${log.success ? 'bg-forge-green' : 'bg-forge-red'}`} />
                <code className="truncate text-forge-ink/80">{log.command}</code>
              </div>
              {log.stdout && (
                <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap font-pixel-body text-[13px] leading-[1.15] text-forge-dim">{log.stdout.trim()}</pre>
              )}
              {log.stderr && (
                <pre className="max-h-16 overflow-y-auto whitespace-pre-wrap font-pixel-body text-[13px] leading-[1.15] text-forge-red/80">{log.stderr.trim()}</pre>
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

  const border = failed ? '#ff4d4d' : done ? '#4ade80' : running ? '#ffb000' : pending ? '#5ab4ff' : '#2e261c';
  const badge = failed
    ? 'bg-forge-red text-black'
    : done
    ? 'bg-forge-green text-black'
    : running
    ? 'bg-forge-amber text-black'
    : discarded
    ? 'bg-forge-line text-forge-dim'
    : 'bg-forge-blue text-black';

  return (
    <div className={`pixel-border bg-forge-raised ${discarded ? 'opacity-40' : ''}`} style={{ ['--pb' as string]: border }}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center font-pixel text-[9px] ${badge}`}>
          {running ? <PixelSpinner /> : failed ? <PixelCross /> : done ? <PixelCheck /> : step.stepNumber}
        </div>
        <span className={`flex-1 font-pixel text-[9px] uppercase leading-tight ${discarded ? 'line-through text-forge-dim' : 'text-forge-ink'}`}>
          {step.title}
        </span>
        {running && <span className="font-pixel text-[8px] text-forge-amber animate-pixel-blink">RUN</span>}
        {done && !failed && <span className="font-pixel text-[8px] text-forge-green">OK</span>}
        {failed && <span className="font-pixel text-[8px] text-forge-red">FAIL</span>}
        {step.body && !running && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-forge-dim hover:text-forge-ink cursor-pointer"
            aria-label={expanded ? 'Collapse step' : 'Expand step'}
          >
            <PixelArrow dir={expanded ? 'up' : 'down'} />
          </button>
        )}
      </div>

      {step.body && expanded && !running && (
        <div className="px-2 pb-2 pl-9 font-pixel-body text-[15px] leading-tight text-forge-dim">
          <MarkdownRenderer content={step.body} variant="pixel" />
        </div>
      )}

      {done && step.executionResult && (
        <div className="space-y-2 px-2 pb-2 pl-9">
          {step.executionResult.message && (
            <div className="font-pixel-body text-[15px] leading-tight text-forge-ink/85">
              <MarkdownRenderer content={step.executionResult.message} variant="pixel" />
            </div>
          )}
          {step.executionResult.fileOps.length > 0 && <FileChangeCard changes={step.executionResult.fileOps} />}
          <CommandLogs logs={step.executionResult.logs} />
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-3 px-2 pb-2.5 pl-9 pt-0.5">
          <button
            type="button"
            onClick={() => onRun(messageId, step.id)}
            className="pixel-border pixel-btn bg-forge-blue px-2 py-1 font-pixel text-[8px] uppercase text-black cursor-pointer"
            style={{ ['--pb' as string]: '#5ab4ff' }}
          >
            ▶ run
          </button>
          <button
            type="button"
            onClick={() => onDiscard(messageId, step.id)}
            className="pixel-border pixel-btn bg-black px-2 py-1 font-pixel text-[8px] uppercase text-forge-dim hover:text-forge-ink cursor-pointer"
          >
            skip
          </button>
        </div>
      )}
    </div>
  );
}

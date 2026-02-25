'use client';

import { Loader2, CheckCircle2, XCircle, Circle, RefreshCw } from 'lucide-react';
import type { PlanStepState } from '@/lib/api/types';

interface CadPlanPanelProps {
  steps: PlanStepState[];
  phase: 'planning' | 'executing' | 'assembling' | 'complete' | null;
}

function StepIcon({ status }: { status: PlanStepState['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={13} className="animate-spin text-blue-400 flex-shrink-0" />;
    case 'success':
      return <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />;
    case 'failed':
      return <XCircle size={13} className="text-red-400/70 flex-shrink-0" />;
    default:
      return <Circle size={13} className="text-white/20 flex-shrink-0" />;
  }
}

export default function CadPlanPanel({ steps, phase }: CadPlanPanelProps) {
  if (!steps.length && phase !== 'planning') return null;

  return (
    <div className="mx-3 mb-3 rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        {phase === 'planning' ? (
          <Loader2 size={11} className="animate-spin text-white/30" />
        ) : phase === 'complete' ? (
          <CheckCircle2 size={11} className="text-green-400/70" />
        ) : (
          <RefreshCw size={11} className="text-blue-400/60" />
        )}
        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">
          {phase === 'planning'
            ? 'Planning…'
            : phase === 'complete'
            ? 'Build complete'
            : 'Building parts'}
        </span>
        {phase === 'executing' && steps.length > 0 && (
          <span className="ml-auto text-[10px] text-white/20">
            {steps.filter(s => s.status === 'success').length}/{steps.length}
          </span>
        )}
      </div>

      {/* Steps */}
      {steps.length > 0 && (
        <div className="py-1.5">
          {steps.map((step, i) => (
            <div
              key={step.id}
              className={`flex items-start gap-2.5 px-3 py-1.5 transition-colors ${
                step.status === 'running' ? 'bg-blue-500/[0.04]' : ''
              }`}
            >
              <div className="mt-0.5">
                <StepIcon status={step.status} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[11px] font-medium leading-tight ${
                      step.status === 'success'
                        ? 'text-white/60'
                        : step.status === 'failed'
                        ? 'text-red-400/60'
                        : step.status === 'running'
                        ? 'text-white/80'
                        : 'text-white/30'
                    }`}
                  >
                    {step.name}
                  </span>

                  {/* Attempt badge */}
                  {step.attempts && step.attempts > 1 && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400/60 font-medium flex-shrink-0">
                      retry {step.attempts}
                    </span>
                  )}

                  {/* Filename pill */}
                  <span className="text-[9px] text-white/15 font-mono ml-auto flex-shrink-0">
                    {step.filename}
                  </span>
                </div>

                <p className="text-[10px] text-white/20 leading-snug mt-0.5 truncate">
                  {step.description}
                </p>

                {/* Error snippet */}
                {step.status === 'failed' && step.error && (
                  <p className="text-[9px] text-red-400/50 mt-1 font-mono leading-snug line-clamp-2">
                    {step.error.split('\n')[0]}
                  </p>
                )}
              </div>

              {/* Step index */}
              <span className="text-[9px] text-white/10 font-mono mt-0.5 flex-shrink-0">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Planning placeholder */}
      {phase === 'planning' && steps.length === 0 && (
        <div className="px-3 py-3 space-y-1.5">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-white/[0.05] flex-shrink-0 animate-pulse" />
              <div
                className="h-2 rounded bg-white/[0.04] animate-pulse"
                style={{ width: `${55 + i * 15}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

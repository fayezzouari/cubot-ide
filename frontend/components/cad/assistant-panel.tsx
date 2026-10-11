'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2, Circle, Loader2, RefreshCw, Send, Sparkles, Square, Wand2, X, XCircle } from 'lucide-react';
import type { FaceInfo } from '@/lib/api/cad';

export interface PlanRow {
  id: string;
  name: string;
  description?: string;
  count?: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempt?: number;
  error?: string;
}

export interface LogEntry {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
}

interface Props {
  input: string;
  busy: boolean;
  editTarget: { name: string } | null;
  face: FaceInfo | null;
  plan: PlanRow[];
  log: LogEntry[];
  onInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onClearFace: () => void;
}

const NEW_SUGGESTIONS = [
  'A two-wheeled robot chassis with motor mounts and a caster',
  'An L-bracket, 3 mm aluminium, with four M4 holes',
  'A spur gear with 24 teeth, module 1.5, 8 mm bore with keyway',
  'A parallel gripper: base, two fingers and a servo mount',
];

const EDIT_SUGGESTIONS = ['Add 4 M3 mounting holes', 'Fillet the outer edges by 2 mm', 'Make it 20% thicker'];

function StatusIcon({ status }: { status: PlanRow['status'] }) {
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />;
  if (status === 'done') return <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />;
  if (status === 'failed') return <XCircle size={13} className="text-red-400/80 shrink-0" />;
  return <Circle size={13} className="text-white/20 shrink-0" />;
}

export default function AssistantPanel({
  input,
  busy,
  editTarget,
  face,
  plan,
  log,
  onInput,
  onSend,
  onStop,
  onClearFace,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [log, plan]);

  const suggestions = editTarget ? EDIT_SUGGESTIONS : NEW_SUGGESTIONS;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {log.length === 0 && plan.length === 0 && (
          <div className="pt-4">
            <p className="text-xs font-semibold text-white/70">Describe what to build</p>
            <p className="text-[11px] text-white/35 mt-1 leading-relaxed">
              New prompts become separate, parametric parts placed in the assembly. Select a part to edit it
              instead; click it again to point at a face.
            </p>
            <div className="mt-4 space-y-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => onInput(s)}
                  className="w-full text-left text-[11px] px-2.5 py-2 border border-white/[0.07] hover:border-white/20 hover:bg-white/[0.03] text-white/45 hover:text-white/80 rounded-md transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {log.map((entry) => (
          <div
            key={entry.id}
            className={
              entry.role === 'user'
                ? 'ml-6 px-2.5 py-2 rounded-md bg-white/[0.06] text-[11.5px] text-white/80 whitespace-pre-wrap'
                : entry.role === 'error'
                  ? 'px-2.5 py-2 rounded-md border border-red-500/20 bg-red-500/[0.06] text-[11px] text-red-300/90 whitespace-pre-wrap font-mono'
                  : 'px-1 text-[11.5px] text-white/60 whitespace-pre-wrap'
            }
          >
            {entry.text}
          </div>
        ))}

        {plan.length > 0 && (
          <div className="rounded-md border border-white/[0.07] bg-white/[0.02]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/40">
              <RefreshCw size={10} className={busy ? 'animate-spin' : ''} />
              Parts
              <span className="ml-auto font-mono">
                {plan.filter((p) => p.status === 'done').length}/{plan.length}
              </span>
            </div>
            {plan.map((row) => (
              <div key={row.id} className="flex gap-2 px-2.5 py-1.5">
                <div className="mt-0.5">
                  <StatusIcon status={row.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11.5px] text-white/75 truncate">{row.name}</span>
                    {row.count && row.count > 1 && (
                      <span className="text-[10px] font-mono text-white/35">×{row.count}</span>
                    )}
                    {row.attempt && row.status === 'running' && (
                      <span className="text-[9px] px-1 rounded bg-amber-400/10 text-amber-300/80">fix {row.attempt}</span>
                    )}
                  </div>
                  {row.error && <p className="text-[10px] text-red-300/70 font-mono mt-0.5 line-clamp-2">{row.error}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-white/[0.06] space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] text-white/40 min-h-4">
          {editTarget ? (
            <>
              <Wand2 size={11} className="text-blue-400" />
              <span>
                Editing <span className="text-white/75">{editTarget.name}</span>
              </span>
              {face && (
                <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-300/90">
                  {face.type.toLowerCase()} face
                  <button onClick={onClearFace} title="Clear face" className="hover:text-white">
                    <X size={10} />
                  </button>
                </span>
              )}
            </>
          ) : (
            <>
              <Sparkles size={11} />
              <span>New parts</span>
            </>
          )}
        </div>
        <div className="flex items-end gap-2 bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 focus-within:border-white/25">
          <textarea
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !busy) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={2}
            disabled={busy}
            placeholder={editTarget ? `Change ${editTarget.name}…` : 'Describe a part or an assembly…'}
            className="flex-1 resize-none bg-transparent text-[12px] text-white/85 placeholder:text-white/25 focus:outline-none disabled:opacity-50"
          />
          {busy ? (
            <button onClick={onStop} title="Stop" className="p-1 text-white/50 hover:text-white">
              <Square size={13} />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!input.trim()}
              title="Send"
              className="p-1 text-white/50 hover:text-white disabled:opacity-25"
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

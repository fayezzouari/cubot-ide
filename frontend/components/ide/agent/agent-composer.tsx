'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, FileText, Globe, ListChecks, Square, X, Zap } from 'lucide-react';
import { AGENT_MODES } from '@/lib/branding';
import type { ChatMode } from '@/lib/mock-data';

export interface CodeContext {
  id: string;
  fileName: string;
  startLine: number;
  endLine: number;
  content: string;
}

interface AgentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  webSearch: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  activeFileName: string | null;
  codeContexts: CodeContext[];
  onRemoveContext: (id: string) => void;
}

const MODE_ICON = { build: Zap, plan: ListChecks } as const;

export default function AgentComposer({
  value, onChange, onSend, onStop, busy, mode, onModeChange,
  webSearch, onWebSearchChange, activeFileName, codeContexts, onRemoveContext,
}: AgentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!busy && value.trim()) onSend();
    }
    if (e.key === 'Escape' && busy) onStop();
  };

  const canSend = !busy && value.trim().length > 0;

  return (
    <div className="flex-shrink-0 px-2.5 pb-2.5 pt-1">
      <div className="rounded-md border border-white/[0.1] bg-[#141414] transition-colors focus-within:border-white/25">
        {(activeFileName || codeContexts.length > 0) && (
          <div className="flex flex-wrap items-center gap-1 px-2 pt-2">
            {activeFileName && (
              <span
                title="The open file is sent with every message"
                className="flex items-center gap-1 rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px font-mono text-[10.5px] text-white/60"
              >
                <FileText size={10} className="text-white/40" />
                {activeFileName}
              </span>
            )}
            {codeContexts.map(ctx => (
              <span
                key={ctx.id}
                className="flex items-center gap-1 rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px font-mono text-[10.5px] text-white/60"
              >
                {ctx.fileName}
                <span className="text-white/35">:{ctx.startLine}{ctx.endLine !== ctx.startLine ? `-${ctx.endLine}` : ''}</span>
                <button
                  type="button"
                  onClick={() => onRemoveContext(ctx.id)}
                  className="-mr-0.5 text-white/30 hover:text-white/80 cursor-pointer"
                  aria-label="Remove selection"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={AGENT_MODES[mode].placeholder}
          rows={2}
          className="block w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-[12.5px] leading-relaxed text-white/90 placeholder:text-white/25 focus:outline-none min-h-[44px] max-h-[180px] overflow-y-auto"
        />

        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <ModeMenu mode={mode} onChange={onModeChange} />
          <button
            type="button"
            onClick={() => onWebSearchChange(!webSearch)}
            title={webSearch ? 'Web search on' : 'Web search off'}
            aria-pressed={webSearch}
            className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition-colors cursor-pointer ${
              webSearch ? 'bg-white/[0.08] text-white/85' : 'text-white/35 hover:bg-white/[0.05] hover:text-white/70'
            }`}
          >
            <Globe size={11} />
            {webSearch && 'Web'}
          </button>

          <span className="ml-auto" />

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop (Esc)"
              className="flex h-6 w-6 items-center justify-center rounded bg-white/[0.1] text-white/80 hover:bg-white/[0.18] transition-colors cursor-pointer"
            >
              <Square size={9} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              title="Send (Enter)"
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer disabled:cursor-not-allowed ${
                canSend ? 'bg-white text-black hover:bg-white/85' : 'bg-white/[0.06] text-white/25'
              }`}
            >
              <ArrowUp size={12} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeMenu({ mode, onChange }: { mode: ChatMode; onChange: (mode: ChatMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const Icon = MODE_ICON[mode];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-white/70 hover:bg-white/[0.07] hover:text-white/90 transition-colors cursor-pointer"
      >
        <Icon size={11} className={mode === 'plan' ? 'text-blue-300' : 'text-white/60'} />
        {AGENT_MODES[mode].label}
        <ChevronDown size={10} className="text-white/35" />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-7 left-0 z-30 w-56 rounded-md border border-white/[0.1] bg-[#1a1a1a] p-1 shadow-xl shadow-black/60">
          {(['build', 'plan'] as ChatMode[]).map(m => {
            const ItemIcon = MODE_ICON[m];
            return (
              <button
                key={m}
                type="button"
                role="menuitem"
                onClick={() => { onChange(m); setOpen(false); }}
                className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-white/[0.07] cursor-pointer"
              >
                <ItemIcon size={12} className={`mt-0.5 flex-shrink-0 ${m === 'plan' ? 'text-blue-300' : 'text-white/60'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-white/90">{AGENT_MODES[m].label}</span>
                  <span className="block text-[10.5px] leading-snug text-white/40">{AGENT_MODES[m].hint}</span>
                </span>
                {m === mode && <Check size={11} className="mt-0.5 flex-shrink-0 text-white/60" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

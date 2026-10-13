'use client';

import { useEffect, useRef } from 'react';
import { ArrowUp, Code2, FileText, Globe, Hammer, ListChecks, Square, X } from 'lucide-react';
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
  includeActiveFile: boolean;
  onIncludeActiveFileChange: (include: boolean) => void;
  codeContexts: CodeContext[];
  onRemoveContext: (id: string) => void;
}

/** Input box: context chips on top, text in the middle, mode and tools underneath. */
export default function AgentComposer({
  value, onChange, onSend, onStop, busy,
  mode, onModeChange, webSearch, onWebSearchChange,
  activeFileName, includeActiveFile, onIncludeActiveFileChange,
  codeContexts, onRemoveContext,
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
  const accent = mode === 'plan' ? 'focus-within:border-sky-400/40' : 'focus-within:border-amber-400/40';

  return (
    <div className="flex-shrink-0 border-t border-white/[0.06] bg-[#0b0b0b] p-3">
      <div className={`rounded-xl border border-white/[0.09] bg-[#121212] transition-colors ${accent}`}>
        {/* Context chips */}
        {(activeFileName || codeContexts.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-2.5">
            {activeFileName && (
              <button
                type="button"
                onClick={() => onIncludeActiveFileChange(!includeActiveFile)}
                title={includeActiveFile ? 'Open file is sent as context. Click to exclude.' : 'Open file is not sent. Click to include.'}
                className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] transition-colors cursor-pointer ${
                  includeActiveFile
                    ? 'border-white/[0.12] bg-white/[0.06] text-white/70'
                    : 'border-dashed border-white/[0.12] text-white/30 line-through'
                }`}
              >
                <FileText size={10} />
                {activeFileName}
              </button>
            )}
            {codeContexts.map(ctx => (
              <span
                key={ctx.id}
                className="flex items-center gap-1 rounded-md border border-amber-400/25 bg-amber-400/[0.08] px-1.5 py-0.5 font-mono text-[10.5px] text-amber-100/90"
              >
                <Code2 size={10} className="text-amber-300" />
                {ctx.fileName}:{ctx.startLine}{ctx.endLine !== ctx.startLine ? `-${ctx.endLine}` : ''}
                <button
                  type="button"
                  onClick={() => onRemoveContext(ctx.id)}
                  className="-mr-0.5 text-amber-200/50 hover:text-amber-100 cursor-pointer"
                  aria-label="Remove selection"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Text */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={AGENT_MODES[mode].placeholder}
          rows={2}
          className="block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[12.5px] leading-relaxed text-white/85 placeholder:text-white/25 focus:outline-none min-h-[44px] max-h-[180px] overflow-y-auto"
        />

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-2 pb-2">
          <div className="flex items-center rounded-lg border border-white/[0.07] bg-black/40 p-0.5">
            <ModeButton
              active={mode === 'build'}
              onClick={() => onModeChange('build')}
              icon={<Hammer size={10} />}
              label={AGENT_MODES.build.label}
              hint={AGENT_MODES.build.hint}
              activeClass="bg-amber-400/15 text-amber-200"
            />
            <ModeButton
              active={mode === 'plan'}
              onClick={() => onModeChange('plan')}
              icon={<ListChecks size={10} />}
              label={AGENT_MODES.plan.label}
              hint={AGENT_MODES.plan.hint}
              activeClass="bg-sky-400/15 text-sky-200"
            />
          </div>

          <button
            type="button"
            onClick={() => onWebSearchChange(!webSearch)}
            title={webSearch ? 'Web search on. Forge can look up docs and datasheets.' : 'Web search off'}
            aria-pressed={webSearch}
            className={`ml-1 flex h-6 w-6 items-center justify-center rounded-md transition-colors cursor-pointer ${
              webSearch ? 'bg-white/[0.08] text-white/85' : 'text-white/30 hover:bg-white/[0.05] hover:text-white/60'
            }`}
          >
            <Globe size={12} />
          </button>

          <span className="ml-auto hidden text-[10px] text-white/20 sm:block">
            {busy ? 'Esc to stop' : 'Enter to send · Shift+Enter newline'}
          </span>

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.1] text-white/80 transition-colors hover:bg-red-500/25 hover:text-red-200 cursor-pointer"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              title="Send"
              className={`ml-1 flex h-7 w-7 items-center justify-center rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed ${
                canSend
                  ? mode === 'plan'
                    ? 'bg-sky-400 text-black hover:bg-sky-300'
                    : 'bg-amber-400 text-black hover:bg-amber-300'
                  : 'bg-white/[0.06] text-white/25'
              }`}
            >
              <ArrowUp size={13} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active, onClick, icon, label, hint, activeClass,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors cursor-pointer ${
        active ? activeClass : 'text-white/35 hover:text-white/65'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

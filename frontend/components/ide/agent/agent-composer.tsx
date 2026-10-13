'use client';

import { useEffect, useRef } from 'react';
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
  const accent = mode === 'plan' ? '#5ab4ff' : '#ffb000';

  return (
    <div className="flex-shrink-0 border-t-2 border-forge-line bg-forge-panel p-3">
      <div className="pixel-border bg-black" style={{ ['--pb' as string]: busy ? accent : '#3a2f22' }}>
        {/* Context chips */}
        {(activeFileName || codeContexts.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
            {activeFileName && (
              <button
                type="button"
                onClick={() => onIncludeActiveFileChange(!includeActiveFile)}
                title={includeActiveFile ? 'Open file is sent as context. Click to exclude.' : 'Open file is not sent. Click to include.'}
                className={`pixel-border px-1.5 py-0.5 font-pixel-body text-[14px] leading-none cursor-pointer ${
                  includeActiveFile ? 'bg-forge-raised text-forge-ink' : 'bg-transparent text-forge-dim line-through'
                }`}
                style={{ ['--pb' as string]: includeActiveFile ? '#3a2f22' : '#2e261c' }}
              >
                ▣ {activeFileName}
              </button>
            )}
            {codeContexts.map(ctx => (
              <span
                key={ctx.id}
                className="pixel-border flex items-center gap-1.5 bg-forge-raised px-1.5 py-0.5 font-pixel-body text-[14px] leading-none text-forge-amber"
                style={{ ['--pb' as string]: '#ffb000' }}
              >
                ‹› {ctx.fileName}:{ctx.startLine}{ctx.endLine !== ctx.startLine ? `-${ctx.endLine}` : ''}
                <button
                  type="button"
                  onClick={() => onRemoveContext(ctx.id)}
                  className="font-pixel text-[8px] text-forge-amber/60 hover:text-forge-amber cursor-pointer"
                  aria-label="Remove selection"
                >
                  X
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
          placeholder={`> ${AGENT_MODES[mode].placeholder}`}
          rows={2}
          spellCheck={false}
          className="block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 font-pixel-body text-[17px] leading-[1.2] text-forge-ink placeholder:text-forge-dim/70 caret-forge-amber focus:outline-none min-h-[48px] max-h-[180px] overflow-y-auto"
        />

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-2 pb-2 pt-1">
          <ModeButton
            active={mode === 'build'}
            onClick={() => onModeChange('build')}
            label={AGENT_MODES.build.label}
            hint={AGENT_MODES.build.hint}
            color="#ffb000"
          />
          <ModeButton
            active={mode === 'plan'}
            onClick={() => onModeChange('plan')}
            label={AGENT_MODES.plan.label}
            hint={AGENT_MODES.plan.hint}
            color="#5ab4ff"
          />

          <button
            type="button"
            onClick={() => onWebSearchChange(!webSearch)}
            title={webSearch ? 'Web search on. Forge can look up docs and datasheets.' : 'Web search off'}
            aria-pressed={webSearch}
            className={`pixel-border pixel-btn px-1.5 py-1 font-pixel text-[8px] uppercase cursor-pointer ${
              webSearch ? 'bg-forge-ink text-black' : 'bg-black text-forge-dim hover:text-forge-ink'
            }`}
            style={{ ['--pb' as string]: webSearch ? '#f2e9d8' : '#2e261c' }}
          >
            web {webSearch ? 'on' : 'off'}
          </button>

          <span className="ml-auto hidden font-pixel text-[7px] uppercase text-forge-dim/70 sm:block">
            {busy ? 'esc = stop' : 'enter = send'}
          </span>

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              className="pixel-border pixel-btn bg-forge-red px-2 py-1 font-pixel text-[8px] uppercase text-black cursor-pointer"
              style={{ ['--pb' as string]: '#ff4d4d' }}
            >
              ■ stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              title="Send"
              className={`pixel-border pixel-btn px-2 py-1 font-pixel text-[8px] uppercase cursor-pointer disabled:cursor-not-allowed ${
                canSend ? 'text-black' : 'bg-forge-line text-forge-dim'
              }`}
              style={{
                ['--pb' as string]: canSend ? accent : '#2e261c',
                backgroundColor: canSend ? accent : undefined,
              }}
            >
              send ▶
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active, onClick, label, hint, color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={`pixel-border pixel-btn px-2 py-1 font-pixel text-[8px] uppercase cursor-pointer ${
        active ? 'text-black' : 'bg-black text-forge-dim hover:text-forge-ink'
      }`}
      style={{ ['--pb' as string]: active ? color : '#2e261c', backgroundColor: active ? color : undefined }}
    >
      {active ? '◆' : '◇'} {label}
    </button>
  );
}

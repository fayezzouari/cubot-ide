'use client';

import { useEffect, useRef } from 'react';
import { Code2, FileText, Globe, ListChecks, Loader2, Send, Square, X } from 'lucide-react';
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
  webSearch: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  activeFileName: string | null;
  includeActiveFile: boolean;
  onIncludeActiveFileChange: (include: boolean) => void;
  codeContexts: CodeContext[];
  onRemoveContext: (id: string) => void;
}

/** Input area: context chips, web search toggle, text box, send or stop. */
export default function AgentComposer({
  value, onChange, onSend, onStop, busy, mode,
  webSearch, onWebSearchChange,
  activeFileName, includeActiveFile, onIncludeActiveFileChange,
  codeContexts, onRemoveContext,
}: AgentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!busy && value.trim()) onSend();
    }
    if (e.key === 'Escape' && busy) onStop();
  };

  return (
    <div className="p-3 border-t border-white/[0.06] flex-shrink-0 space-y-2">
      {/* Context chips: the open file (toggle) and pinned selections */}
      {(activeFileName || codeContexts.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {activeFileName && (
            <button
              type="button"
              onClick={() => onIncludeActiveFileChange(!includeActiveFile)}
              title={includeActiveFile ? 'Open file is sent as context. Click to exclude.' : 'Open file is not sent. Click to include.'}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-mono transition-colors cursor-pointer ${
                includeActiveFile
                  ? 'bg-white/[0.04] border-white/[0.1] text-white/60'
                  : 'border-dashed border-white/[0.1] text-white/25 line-through'
              }`}
            >
              <FileText size={10} />
              {activeFileName}
            </button>
          )}
          {codeContexts.map(ctx => (
            <div
              key={ctx.id}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-[10px] font-mono text-blue-300"
            >
              <Code2 size={10} className="text-blue-400 flex-shrink-0" />
              <span>
                {ctx.fileName}:{ctx.startLine}
                {ctx.endLine !== ctx.startLine ? `-${ctx.endLine}` : ''}
              </span>
              <button
                onClick={() => onRemoveContext(ctx.id)}
                className="text-blue-400/50 hover:text-blue-300 transition-colors -mr-0.5 cursor-pointer"
                aria-label="Remove context"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Websearch toggle */}
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={() => onWebSearchChange(!webSearch)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
            webSearch
              ? 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
              : 'bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white/60'
          }`}
          title="Enable web search (powered by Exa) for up-to-date information"
        >
          <Globe size={10} />
          {webSearch ? 'Web search on' : 'Web search off'}
        </button>
      </div>

      {/* Input row */}
      <div className={`flex items-end gap-2 bg-[#161616] border rounded-xl px-3 py-2 focus-within:border-white/20 transition-colors ${
        mode === 'plan' ? 'border-blue-500/20 focus-within:border-blue-500/40' : 'border-white/[0.08]'
      }`}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={AGENT_MODES[mode].placeholder}
          rows={2}
          className="flex-1 bg-transparent text-xs text-white/70 placeholder:text-white/20 focus:outline-none resize-none leading-relaxed min-h-[40px] max-h-[120px] overflow-y-auto"
        />
        {busy ? (
          <button
            onClick={onStop}
            title="Stop (Esc)"
            className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-red-400 transition-colors cursor-pointer flex-shrink-0 mb-0.5"
          >
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!value.trim()}
            className={`w-6 h-6 flex items-center justify-center disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed flex-shrink-0 mb-0.5 ${
              mode === 'plan' ? 'text-blue-400/50 hover:text-blue-400' : 'text-white/30 hover:text-white/70'
            }`}
          >
            {mode === 'plan' ? <ListChecks size={13} /> : <Send size={13} />}
          </button>
        )}
      </div>
      <p className="text-[10px] text-white/15 text-center">
        {busy ? (
          <span className="inline-flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> Working · Esc to stop</span>
        ) : (
          'Enter to send · Shift+Enter for newline'
        )}
      </p>
    </div>
  );
}

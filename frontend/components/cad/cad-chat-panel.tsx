'use client';

import { useRef, useEffect } from 'react';
import { Bot, User, Send, Loader2, Box, Sparkles } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import CadPlanPanel from '@/components/cad/cad-plan-panel';
import type { PlanStepState } from '@/lib/api/types';

export interface CadChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cadquery_code?: string | null;
  has_model?: boolean;
}

interface CadChatPanelProps {
  messages: CadChatMessage[];
  input: string;
  isGenerating: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  planSteps?: PlanStepState[];
  planPhase?: 'planning' | 'executing' | 'assembling' | 'complete' | null;
  mode: 'part' | 'assembly';
  onModeChange: (mode: 'part' | 'assembly') => void;
}

const PART_SUGGESTIONS = [
  'Create a gear with 20 teeth',
  'Make a box with rounded edges',
  'Design an L-bracket with mounting holes',
];

const ASSEMBLY_SUGGESTIONS = [
  'Build a two-finger gripper',
  'Design a bracket assembly',
  'Create an electronics enclosure',
];

export default function CadChatPanel({
  messages,
  input,
  isGenerating,
  onInputChange,
  onSend,
  planSteps = [],
  planPhase = null,
  mode,
  onModeChange,
}: CadChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, planSteps, planPhase]);

  const showPlan = isGenerating && (planPhase !== null || planSteps.length > 0);

  return (
    <div className="flex flex-col h-full bg-[#0b0b0b] border-r border-white/[0.06]">

      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2 flex-shrink-0">
        <div className="w-6 h-6 rounded-md bg-white/[0.06] flex items-center justify-center flex-shrink-0">
          <Box size={13} className="text-white/60" />
        </div>
        <span className="text-xs font-semibold text-white/70">CAD Assistant</span>
        {isGenerating && !showPlan && (
          <Loader2 size={12} className="animate-spin ml-auto text-white/30 flex-shrink-0" />
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">

        {messages.length === 0 && !showPlan && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <div className="w-10 h-10 rounded-xl border border-white/[0.08] bg-white/[0.04] flex items-center justify-center mb-4">
              <Box size={18} className="text-white/30" />
            </div>
            <p className="text-xs font-semibold text-white/60 mb-1">
              {mode === 'part' ? 'Part Generator' : 'Assembly Generator'}
            </p>
            <p className="text-[11px] text-white/25 leading-relaxed max-w-[220px]">
              {mode === 'part'
                ? "Describe a single 3D component — I'll generate it directly."
                : "Describe a multi-part model — I'll plan and build each part."}
            </p>
            <div className="mt-5 w-full space-y-1.5">
              <p className="text-[10px] font-medium text-white/20 uppercase tracking-wider mb-2">Try saying</p>
              {(mode === 'part' ? PART_SUGGESTIONS : ASSEMBLY_SUGGESTIONS).map((s, i) => (
                <button
                  key={i}
                  onClick={() => onInputChange(s)}
                  className="w-full text-left text-[11px] px-3 py-2 border border-white/[0.06] hover:border-white/[0.14] hover:bg-white/[0.03] text-white/35 hover:text-white/60 rounded-lg transition-all cursor-pointer"
                >
                  &ldquo;{s}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <div
            key={message.id}
            className={`flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            {/* Avatar */}
            <div className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md ${
              message.role === 'assistant'
                ? 'bg-blue-500/10 text-blue-400'
                : 'bg-white/[0.06] text-white/40'
            }`}>
              {message.role === 'assistant' ? <Bot size={12} /> : <User size={12} />}
            </div>

            {/* Bubble */}
            <div className={`flex-1 min-w-0 px-3 py-2.5 rounded-xl text-xs leading-relaxed ${
              message.role === 'user'
                ? 'bg-white/[0.06] text-white/70'
                : 'bg-transparent text-white/60'
            }`}>
              {message.role === 'assistant' ? (
                <MarkdownRenderer content={message.content} />
              ) : (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}

              {message.cadquery_code && (
                <details className="mt-2">
                  <summary className="text-[10px] font-medium text-white/25 hover:text-white/50 cursor-pointer transition-colors">
                    View code
                  </summary>
                  <pre className="mt-1.5 p-2.5 bg-black border border-white/[0.06] rounded-lg text-[10px] font-mono text-white/40 overflow-x-auto leading-relaxed">
                    {message.cadquery_code}
                  </pre>
                </details>
              )}

              {message.has_model && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-green-400/70">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400/60 inline-block" />
                  Model updated in viewport
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Live plan panel — shown while generating in assembly mode */}
        {showPlan && mode === 'assembly' && (
          <div className="-mx-3">
            <CadPlanPanel steps={planSteps} phase={planPhase} />
          </div>
        )}

        {/* Generic generating indicator (before plan arrives) */}
        {isGenerating && !showPlan && (
          <div className="flex gap-2">
            <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
              <Bot size={12} />
            </div>
            <div className="flex-1 min-w-0 px-3 py-2.5 rounded-xl">
              <div className="flex items-center gap-2 text-[11px] text-white/30">
                <Sparkles size={11} className="animate-pulse" />
                Generating model…
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/[0.06] flex-shrink-0">
        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 bg-white/[0.04] border border-white/[0.06] rounded-lg p-0.5 mb-2 w-fit">
          <button
            onClick={() => onModeChange('part')}
            disabled={isGenerating}
            className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer disabled:cursor-not-allowed ${
              mode === 'part'
                ? 'bg-white/[0.1] text-white/80 border border-white/[0.12]'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            Part
          </button>
          <button
            onClick={() => onModeChange('assembly')}
            disabled={isGenerating}
            className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer disabled:cursor-not-allowed ${
              mode === 'assembly'
                ? 'bg-white/[0.1] text-white/80 border border-white/[0.12]'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            Assembly
          </button>
        </div>
        <div className="flex items-center gap-2 bg-[#161616] border border-white/[0.08] rounded-xl px-3 py-2 focus-within:border-white/20 transition-colors">
          <input
            type="text"
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !isGenerating) {
                e.preventDefault();
                onSend();
              }
            }}
            disabled={isGenerating}
            placeholder={mode === 'part' ? 'Describe a 3D part…' : 'Describe an assembly to build…'}
            className="flex-1 bg-transparent text-xs text-white/70 placeholder:text-white/20 focus:outline-none disabled:opacity-40"
          />
          <button
            onClick={onSend}
            disabled={isGenerating || !input.trim()}
            className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white/70 disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed flex-shrink-0"
          >
            {isGenerating
              ? <Loader2 size={13} className="animate-spin" />
              : <Send size={13} />
            }
          </button>
        </div>
        <p className="text-[10px] text-white/15 mt-1.5 text-center">
          {mode === 'part' ? 'Enter to send · single-pass generation' : 'Enter to send · parts built step by step'}
        </p>
      </div>
    </div>
  );
}

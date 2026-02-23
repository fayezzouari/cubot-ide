'use client';

import { useRef, useEffect } from 'react';
import { Bot, User, Send, Loader2, Box, Sparkles } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import MarkdownRenderer from '@/components/ui/markdown-renderer';

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
}

const SUGGESTIONS = [
  'Create a gear with 20 teeth',
  'Make a box with rounded edges',
  'Design an L-bracket with mounting holes',
];

export default function CadChatPanel({
  messages,
  input,
  isGenerating,
  onInputChange,
  onSend,
}: CadChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-[#0b0b0b] border-r border-white/[0.06]">

      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2 flex-shrink-0">
        <div className="w-6 h-6 rounded-md bg-white/[0.06] flex items-center justify-center">
          <Box size={13} className="text-white/60" />
        </div>
        <span className="text-xs font-semibold text-white/70">CAD Assistant</span>
        {isGenerating && (
          <Loader2 size={12} className="animate-spin ml-auto text-white/30" />
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <div className="w-10 h-10 rounded-xl border border-white/[0.08] bg-white/[0.04] flex items-center justify-center mb-4">
              <Box size={18} className="text-white/30" />
            </div>
            <p className="text-xs font-semibold text-white/60 mb-1">CAD Assistant</p>
            <p className="text-[11px] text-white/25 leading-relaxed max-w-[220px]">
              Describe a 3D component and I&apos;ll generate it using CadQuery.
            </p>
            <div className="mt-5 w-full space-y-1.5">
              <p className="text-[10px] font-medium text-white/20 uppercase tracking-wider mb-2">Try saying</p>
              {SUGGESTIONS.map((s, i) => (
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

        {isGenerating && (
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
            placeholder="Describe a 3D model…"
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
        <p className="text-[10px] text-white/15 mt-1.5 text-center">Enter to send · refine through conversation</p>
      </div>
    </div>
  );
}

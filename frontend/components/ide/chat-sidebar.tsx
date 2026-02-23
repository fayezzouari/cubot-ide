'use client';

import { useRef, useEffect } from 'react';
import { Bot, User, Send, Loader2, X, Code2, Sparkles } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import type { ChatMessage } from '@/lib/mock-data';

export interface CodeContext {
  id: string;
  fileName: string;
  startLine: number;
  endLine: number;
  content: string;
}

interface ChatSidebarProps {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  isLoading?: boolean;
  codeContexts?: CodeContext[];
  onRemoveContext?: (id: string) => void;
}

export default function ChatSidebar({
  messages,
  chatInput,
  onChatInputChange,
  onSendMessage,
  isLoading = false,
  codeContexts = [],
  onRemoveContext,
}: ChatSidebarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [chatInput]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      onSendMessage();
    }
  };

  return (
    <aside className="w-full h-full border-l border-white/[0.06] flex flex-col bg-[#0b0b0b]">

      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2 flex-shrink-0">
        <div className="w-6 h-6 rounded-md bg-white/[0.06] flex items-center justify-center">
          <Bot size={13} className="text-white/60" />
        </div>
        <span className="text-xs font-semibold text-white/70">AI Assistant</span>
        {isLoading && <Loader2 size={12} className="animate-spin ml-auto text-white/30" />}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <div className="w-10 h-10 rounded-xl border border-white/[0.08] bg-white/[0.04] flex items-center justify-center mb-4">
              <Bot size={18} className="text-white/30" />
            </div>
            <p className="text-xs font-semibold text-white/60 mb-1">AI Assistant</p>
            <p className="text-[11px] text-white/25 leading-relaxed max-w-[200px]">
              Ask questions about your code or get help with programming tasks.
            </p>
          </div>
        )}

        {messages.map((message, index) => {
          const isUser = message.role === 'user';
          const isAssistant = message.role === 'assistant';
          const isThinking = message.content === '...';

          return (
            <div
              key={`${message.id}-${index}`}
              className={`flex gap-2 items-start ${isUser ? 'flex-row-reverse' : ''}`}
            >
              {/* Avatar */}
              <div className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md ${
                isAssistant
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'bg-white/[0.06] text-white/40'
              }`}>
                {isAssistant ? <Bot size={12} /> : <User size={12} />}
              </div>

              {/* Bubble */}
              <div
                className={`flex-1 min-w-0 px-3 py-2.5 rounded-xl text-xs leading-relaxed ${
                  isUser
                    ? 'bg-white/[0.06] text-white/70'
                    : 'bg-transparent text-white/60'
                }`}
                style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
              >
                {isAssistant ? (
                  isThinking ? (
                    <div className="flex items-center gap-2 text-white/30">
                      <Sparkles size={11} className="animate-pulse" />
                      <span>Thinking…</span>
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none break-words [&>*]:break-words [&_pre]:whitespace-pre-wrap [&_code]:break-words [&_p]:break-words">
                      <MarkdownRenderer content={message.content} />
                    </div>
                  )
                ) : (
                  <p className="whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word' }}>
                    {message.content}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-white/[0.06] flex-shrink-0 space-y-2">

        {/* Code context chips */}
        {codeContexts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {codeContexts.map((ctx) => (
              <div
                key={ctx.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-[10px] font-mono text-blue-300"
              >
                <Code2 size={10} className="text-blue-400 flex-shrink-0" />
                <span>
                  {ctx.fileName}:{ctx.startLine}
                  {ctx.endLine !== ctx.startLine ? `-${ctx.endLine}` : ''}
                </span>
                {onRemoveContext && (
                  <button
                    onClick={() => onRemoveContext(ctx.id)}
                    className="text-blue-400/50 hover:text-blue-300 transition-colors -mr-0.5 cursor-pointer"
                    aria-label="Remove context"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2 bg-[#161616] border border-white/[0.08] rounded-xl px-3 py-2 focus-within:border-white/20 transition-colors">
          <textarea
            ref={textareaRef}
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI for help… (Shift+Enter for newline)"
            disabled={isLoading}
            rows={2}
            className="flex-1 bg-transparent text-xs text-white/70 placeholder:text-white/20 focus:outline-none disabled:opacity-40 resize-none leading-relaxed min-h-[40px] max-h-[120px] overflow-y-auto"
          />
          <button
            onClick={onSendMessage}
            disabled={isLoading || !chatInput.trim()}
            className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white/70 disabled:opacity-20 transition-colors cursor-pointer disabled:cursor-not-allowed flex-shrink-0 mb-0.5"
          >
            {isLoading
              ? <Loader2 size={13} className="animate-spin" />
              : <Send size={13} />
            }
          </button>
        </div>
        <p className="text-[10px] text-white/15 text-center">Enter to send · Shift+Enter for newline</p>
      </div>
    </aside>
  );
}

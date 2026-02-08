'use client';

import { useRef, useEffect } from 'react';
import { Bot, User, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

export default function CadChatPanel({
  messages,
  input,
  isGenerating,
  onInputChange,
  onSend,
}: CadChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-background/80 backdrop-blur-sm">
      {/* Header */}
      <div className="p-4 border-b-4 border-foreground flex items-center gap-2">
        <Bot size={20} />
        <span className="font-black text-sm tracking-wide">CAD ASSISTANT</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Bot size={40} className="text-muted-foreground/40 mb-4" />
            <p className="font-black text-muted-foreground/60 text-sm">
              CAD ASSISTANT READY
            </p>
            <p className="text-xs font-bold text-muted-foreground/40 mt-2 max-w-[260px]">
              Describe a 3D component and I&apos;ll generate it using CadQuery. You can refine it through conversation.
            </p>
            <div className="mt-6 space-y-2 text-left w-full max-w-[280px]">
              <p className="text-xs font-black text-muted-foreground/50 tracking-widest">
                TRY SAYING:
              </p>
              {[
                'Create a gear with 20 teeth',
                'Make a box with rounded edges',
                'Design an L-bracket with mounting holes',
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => {
                    onInputChange(suggestion);
                  }}
                  className="w-full text-left text-xs font-bold px-3 py-2 border-2 border-foreground/20 hover:border-foreground hover:bg-muted transition-all"
                >
                  &quot;{suggestion}&quot;
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`w-full flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`w-8 h-8 flex-shrink-0 flex items-center justify-center border-2 border-foreground ${
                message.role === 'assistant' ? 'bg-primary' : 'bg-muted'
              }`}
            >
              {message.role === 'assistant' ? (
                <Bot size={14} className="text-primary-foreground" />
              ) : (
                <User size={14} />
              )}
            </div>
            <div
              className={`flex-1 w-full min-w-0 p-3 border-2 border-foreground text-sm ${
                message.role === 'user' ? 'bg-muted' : 'bg-background'
              }`}
            >
              {message.role === 'assistant' ? (
                <MarkdownRenderer content={message.content} />
              ) : (
                <p className="whitespace-pre-wrap font-bold">{message.content}</p>
              )}
              {message.cadquery_code && (
                <details className="mt-2">
                  <summary className="text-xs font-black text-muted-foreground cursor-pointer hover:text-foreground">
                    VIEW CODE
                  </summary>
                  <pre className="mt-2 p-2 bg-muted text-xs overflow-x-auto border border-foreground/20 font-mono">
                    {message.cadquery_code}
                  </pre>
                </details>
              )}
              {message.has_model && (
                <div className="mt-2 flex items-center gap-1 text-xs font-black text-emerald-600 dark:text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  MODEL UPDATED
                </div>
              )}
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="w-full flex gap-2">
            <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center border-2 border-foreground bg-primary">
              <Bot size={14} className="text-primary-foreground" />
            </div>
            <div className="flex-1 w-full min-w-0 p-3 border-2 border-foreground bg-background">
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Generating model...
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t-4 border-foreground">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isGenerating) {
                e.preventDefault();
                onSend();
              }
            }}
            disabled={isGenerating}
            placeholder="Describe a 3D model..."
            className="flex-1 px-3 py-2 border-2 border-foreground bg-background text-sm font-bold placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground disabled:opacity-50"
          />
          <Button
            onClick={onSend}
            size="icon"
            disabled={isGenerating || !input.trim()}
            className="border-2 border-foreground"
          >
            {isGenerating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <div className="p-1 bg-primary/10 rounded">
          <Bot size={16} className="text-primary" />
        </div>
        <span className="font-semibold text-sm">CAD Assistant</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="p-4 bg-primary/10 rounded-full mb-4">
              <Bot size={32} className="text-primary" />
            </div>
            <p className="font-semibold text-foreground text-sm mb-2">
              CAD Assistant Ready
            </p>
            <p className="text-xs text-muted-foreground mt-2 max-w-[260px]">
              Describe a 3D component and I&apos;ll generate it using CadQuery. You can refine it through conversation.
            </p>
            <div className="mt-6 space-y-2 text-left w-full max-w-[280px]">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Try saying:
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
                  className="w-full text-left text-xs px-3 py-2 border border-border rounded hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-pointer"
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
              className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded ${
                message.role === 'assistant' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {message.role === 'assistant' ? (
                <Bot size={14} />
              ) : (
                <User size={14} />
              )}
            </div>
            <div
              className={`flex-1 w-full min-w-0 p-3 rounded-lg border text-sm ${
                message.role === 'user' ? 'bg-muted/50 border-border' : 'bg-background border-border'
              }`}
            >
              {message.role === 'assistant' ? (
                <MarkdownRenderer content={message.content} />
              ) : (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}
              {message.cadquery_code && (
                <details className="mt-2">
                  <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                    View code
                  </summary>
                  <pre className="mt-2 p-2 bg-muted text-xs overflow-x-auto border border-border rounded font-mono">
                    {message.cadquery_code}
                  </pre>
                </details>
              )}
              {message.has_model && (
                <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                  Model updated
                </div>
              )}
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="w-full flex gap-2">
            <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded bg-primary text-primary-foreground">
              <Bot size={14} />
            </div>
            <div className="flex-1 w-full min-w-0 p-3 rounded-lg border border-border bg-background">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Generating model...
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
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
            className="flex-1 px-3 py-2 border border-input bg-background text-sm rounded placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <Button
            onClick={onSend}
            size="icon"
            className="h-9 w-9"
            disabled={isGenerating || !input.trim()}
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

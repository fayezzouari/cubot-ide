'use client';

import { useRef, useEffect } from 'react';
import { Bot, User, Send, Loader2, X, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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

  // Auto-resize textarea based on content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [chatInput]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      onSendMessage();
    }
  };

  return (
    <aside className="w-full h-full border-l border-border flex flex-col bg-card">
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <div className="p-1 bg-primary/10 rounded">
          <Bot size={16} className="text-primary" />
        </div>
        <span className="font-semibold text-sm">AI Assistant</span>
        {isLoading && <Loader2 size={14} className="animate-spin ml-auto text-muted-foreground" />}
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((message, index) => {
            const isUser = message.role === 'user';
            const isAssistant = message.role === 'assistant';
            const isThinking = message.content === '...';

            return (
              <div
                key={`${message.id}-${index}`}
                className={`flex gap-2 items-start ${isUser ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded ${
                    isAssistant ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isAssistant ? <Bot size={14} /> : <User size={14} />}
                </div>
                <div
                  className={`flex-1 min-w-0 p-3 rounded-lg border text-sm ${
                    isUser ? 'bg-muted/50 border-border' : 'bg-background border-border'
                  }`}
                  style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
                >
                  {isAssistant ? (
                    isThinking ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 size={16} className="animate-spin" />
                        <span>Thinking...</span>
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
      </ScrollArea>

      <div className="p-3 border-t border-border space-y-2">
        {/* Code context chips */}
        {codeContexts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {codeContexts.map((ctx) => (
              <div
                key={ctx.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-xs font-mono text-blue-300"
              >
                <Code2 size={10} className="text-blue-400 flex-shrink-0" />
                <span>
                  {ctx.fileName}:{ctx.startLine}
                  {ctx.endLine !== ctx.startLine ? `-${ctx.endLine}` : ''}
                </span>
                {onRemoveContext && (
                  <button
                    onClick={() => onRemoveContext(ctx.id)}
                    className="text-blue-400/50 hover:text-blue-300 transition-colors -mr-0.5"
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
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI for help… (Shift+Enter for newline)"
            disabled={isLoading}
            rows={2}
            className="flex-1 px-3 py-2 border border-white/[0.08] bg-[#1c1c1c] text-sm rounded-lg resize-none leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-white/20 focus:border-white/20 disabled:opacity-50 min-h-[60px] max-h-[160px] overflow-y-auto"
          />
          <Button
            onClick={onSendMessage}
            size="icon"
            className="h-9 w-9 flex-shrink-0 mb-px"
            disabled={isLoading || !chatInput.trim()}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </div>
      </div>
    </aside>
  );
}

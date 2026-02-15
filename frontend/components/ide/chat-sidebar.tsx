'use client';

import { Bot, User, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import MarkdownRenderer from '@/components/ui/markdown-renderer';
import type { ChatMessage } from '@/lib/mock-data';

interface ChatSidebarProps {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  isLoading?: boolean;
}

export default function ChatSidebar({
  messages,
  chatInput,
  onChatInputChange,
  onSendMessage,
  isLoading = false,
}: ChatSidebarProps) {
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
          {messages.map((message) => {
            const isUser = message.role === 'user';
            const isAssistant = message.role === 'assistant';
            const isThinking = message.content === '...';

            return (
              <div
                key={message.id}
                className={`flex gap-2 items-start ${isUser ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded ${
                    isAssistant ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isAssistant ? (
                    <Bot size={14} />
                  ) : (
                    <User size={14} />
                  )}
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
                    <p className="whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word' }}>{message.content}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="p-3 border-t border-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && onSendMessage()}
            placeholder="Ask AI for help..."
            disabled={isLoading}
            className="flex-1 px-3 py-2 border border-input bg-background text-sm rounded placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <Button
            onClick={onSendMessage}
            size="icon"
            className="h-9 w-9"
            disabled={isLoading || !chatInput.trim()}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </div>
      </div>
    </aside>
  );
}

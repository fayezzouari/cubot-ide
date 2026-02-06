'use client';

import { Bot, User, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChatMessage } from '@/lib/mock-data';

interface ChatSidebarProps {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
}

export default function ChatSidebar({
  messages,
  chatInput,
  onChatInputChange,
  onSendMessage,
}: ChatSidebarProps) {
  return (
    <aside className="w-80 border-l-4 border-foreground flex flex-col bg-background/80 backdrop-blur-sm">
      <div className="p-3 border-b-2 border-foreground flex items-center gap-2">
        <Bot size={18} />
        <span className="font-black text-sm">AI ASSISTANT</span>
      </div>
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-8 h-8 flex items-center justify-center border-2 border-foreground ${
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
                className={`flex-1 p-3 border-2 border-foreground text-sm ${
                  message.role === 'user' ? 'bg-muted' : 'bg-background'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="p-3 border-t-2 border-foreground">
        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSendMessage()}
            placeholder="Ask AI for help..."
            className="flex-1 px-3 py-2 border-2 border-foreground bg-background text-sm font-bold placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground"
          />
          <Button onClick={onSendMessage} size="icon" className="border-2 border-foreground">
            <Send size={16} />
          </Button>
        </div>
      </div>
    </aside>
  );
}

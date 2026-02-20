'use client';

import ChatSidebar from './chat-sidebar';
import type { ChatMessage } from '@/lib/mock-data';
import type { CodeContext } from './chat-sidebar';

interface RightSidebarProps {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  isLoading?: boolean;
  codeContexts?: CodeContext[];
  onRemoveContext?: (id: string) => void;
}

export default function RightSidebar({
  messages,
  chatInput,
  onChatInputChange,
  onSendMessage,
  isLoading = false,
  codeContexts = [],
  onRemoveContext,
}: RightSidebarProps) {
  return (
    <div className="w-full h-full flex flex-col bg-background">
      <ChatSidebar
        messages={messages}
        chatInput={chatInput}
        onChatInputChange={onChatInputChange}
        onSendMessage={onSendMessage}
        isLoading={isLoading}
        codeContexts={codeContexts}
        onRemoveContext={onRemoveContext}
      />
    </div>
  );
}

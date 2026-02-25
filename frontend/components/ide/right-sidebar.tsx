'use client';

import ChatSidebar from './chat-sidebar';
import type { ChatMessage, ChatMode } from '@/lib/mock-data';
import type { CodeContext } from './chat-sidebar';

interface RightSidebarProps {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  isLoading?: boolean;
  codeContexts?: CodeContext[];
  onRemoveContext?: (id: string) => void;
  chatMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  onAcceptStep: (messageId: string, stepId: string) => void;
  onAcceptAllSteps: (messageId: string) => void;
  onDiscardStep: (messageId: string, stepId: string) => void;
}

export default function RightSidebar({
  messages,
  chatInput,
  onChatInputChange,
  onSendMessage,
  isLoading = false,
  codeContexts = [],
  onRemoveContext,
  chatMode,
  onModeChange,
  onAcceptStep,
  onAcceptAllSteps,
  onDiscardStep,
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
        chatMode={chatMode}
        onModeChange={onModeChange}
        onAcceptStep={onAcceptStep}
        onAcceptAllSteps={onAcceptAllSteps}
        onDiscardStep={onDiscardStep}
      />
    </div>
  );
}

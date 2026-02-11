'use client';

import { useState } from 'react';
import { MessageSquare, Terminal as TerminalIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ChatSidebar from './chat-sidebar';
import SandboxTerminal from './sandbox-terminal';
import type { ChatMessage } from '@/lib/mock-data';

interface RightSidebarProps {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
  isLoading?: boolean;
}

export default function RightSidebar({
  messages,
  chatInput,
  onChatInputChange,
  onSendMessage,
  isLoading = false,
}: RightSidebarProps) {
  const [workspaceId, setWorkspaceId] = useState<string | undefined>();

  return (
    <div className="w-full h-full  flex flex-col bg-background">
          <ChatSidebar
            messages={messages}
            chatInput={chatInput}
            onChatInputChange={onChatInputChange}
            onSendMessage={onSendMessage}
            isLoading={isLoading}
          />
    </div>
  );
}

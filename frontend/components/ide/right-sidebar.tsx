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
    <div className="w-full h-full border-l-4 border-foreground flex flex-col bg-background">
      <Tabs defaultValue="chat" className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start border-b-2 border-foreground rounded-none bg-background">
          <TabsTrigger value="chat" className="flex items-center gap-2">
            <MessageSquare size={16} />
            <span className="font-black text-xs">CHAT</span>
          </TabsTrigger>
          <TabsTrigger value="terminal" className="flex items-center gap-2">
            <TerminalIcon size={16} />
            <span className="font-black text-xs">TERMINAL</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 m-0 data-[state=active]:flex">
          <ChatSidebar
            messages={messages}
            chatInput={chatInput}
            onChatInputChange={onChatInputChange}
            onSendMessage={onSendMessage}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="terminal" className="flex-1 m-0 data-[state=active]:flex">
          <SandboxTerminal
            workspaceId={workspaceId}
            onWorkspaceCreate={setWorkspaceId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Send,
  Bot,
  User,
  Play,
  Square,
  Settings,
  Home,
  Plus,
  MoreVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  mockFileTree,
  mockFileContents,
  mockMessages as initialMessages,
  type FileNode,
  type ChatMessage,
} from '@/lib/mock-data';

function FileTreeItem({ 
  node, 
  depth = 0, 
  selectedFile,
  onSelectFile,
}: { 
  node: FileNode; 
  depth?: number;
  selectedFile: string | null;
  onSelectFile: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const isFolder = node.type === 'folder';
  const isSelected = selectedFile === node.id;

  return (
    <div>
      <button
        className={`w-full flex items-center gap-2 px-2 py-1 text-left text-sm font-bold hover:bg-muted transition-colors ${
          isSelected ? 'bg-muted border-l-2 border-foreground' : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (isFolder) {
            setIsOpen(!isOpen);
          } else {
            onSelectFile(node.id);
          }
        }}
      >
        {isFolder ? (
          <>
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {isOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File size={14} />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isFolder && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem 
              key={child.id} 
              node={child} 
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function IDEPage() {
  const [selectedFile, setSelectedFile] = useState<string | null>('2');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    
    setMessages([
      ...messages,
      {
        id: Date.now().toString(),
        role: 'user',
        content: chatInput,
      },
    ]);
    setChatInput('');
    
    // Simulate AI response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'I\'m processing your request. This is a mock response for demonstration purposes.',
        },
      ]);
    }, 1000);
  };

  const currentFileContent = selectedFile ? mockFileContents[selectedFile] : null;
  const currentFileName = selectedFile 
    ? mockFileTree.flatMap(f => f.type === 'folder' && f.children ? f.children : [f]).find(f => f.id === selectedFile)?.name 
    : null;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Top Bar */}
      <header className="h-14 border-b-4 border-foreground flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary border-2 border-foreground flex items-center justify-center">
              <span className="text-primary-foreground font-black text-sm">⚙</span>
            </div>
            <span className="font-serif text-xl font-black">CUBOT IDE</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="border-2 border-foreground font-black">
            <Play size={14} />
            COMPILE
          </Button>
          <Button variant="outline" size="sm" className="border-2 border-foreground font-black">
            <Square size={14} />
            STOP
          </Button>
          <Button variant="ghost" size="icon">
            <Settings size={18} />
          </Button>
          <Link href="/">
            <Button variant="ghost" size="icon">
              <Home size={18} />
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Sidebar */}
        <aside className="w-64 border-r-4 border-foreground flex flex-col">
          <div className="p-3 border-b-2 border-foreground flex items-center justify-between">
            <span className="font-black text-sm">EXPLORER</span>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <Plus size={14} />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="py-2">
              {mockFileTree.map((node) => (
                <FileTreeItem 
                  key={node.id} 
                  node={node}
                  selectedFile={selectedFile}
                  onSelectFile={setSelectedFile}
                />
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Editor Area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          {currentFileName && (
            <div className="h-10 border-b-2 border-foreground flex items-center px-2">
              <div className="flex items-center gap-2 px-3 py-1 bg-muted border-2 border-foreground">
                <File size={12} />
                <span className="text-sm font-bold">{currentFileName}</span>
              </div>
            </div>
          )}
          
          {/* Code Editor / Logo Display */}
          <div className="flex-1 overflow-auto">
            {currentFileContent ? (
              <div className="p-4 font-mono text-sm">
                <pre className="whitespace-pre-wrap">
                  {currentFileContent.split('\n').map((line, i) => (
                    <div key={i} className="flex">
                      <span className="w-10 text-right pr-4 text-muted-foreground select-none">
                        {i + 1}
                      </span>
                      <code>{line}</code>
                    </div>
                  ))}
                </pre>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-32 h-32 mx-auto mb-6 bg-primary border-4 border-foreground flex items-center justify-center">
                    <span className="text-primary-foreground font-black text-6xl">⚙</span>
                  </div>
                  <h2 className="text-2xl font-black mb-2">CUBOT IDE</h2>
                  <p className="text-muted-foreground font-bold">Select a file to start editing</p>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Chat Sidebar */}
        <aside className="w-80 border-l-4 border-foreground flex flex-col">
          <div className="p-3 border-b-2 border-foreground flex items-center gap-2">
            <Bot size={18} />
            <span className="font-black text-sm">AI ASSISTANT</span>
          </div>
          
          {/* Messages */}
          <ScrollArea className="flex-1 p-3">
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-2 ${
                    message.role === 'user' ? 'flex-row-reverse' : ''
                  }`}
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

          {/* Input */}
          <div className="p-3 border-t-2 border-foreground">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Ask AI for help..."
                className="flex-1 px-3 py-2 border-2 border-foreground bg-background text-sm font-bold placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground"
              />
              <Button
                onClick={handleSendMessage}
                size="icon"
                className="border-2 border-foreground"
              >
                <Send size={16} />
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

'use client';

import { useState, useRef, useEffect } from 'react';
import { Terminal, Play, Trash2, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { daytonaApi } from '@/lib/api/daytona';
import { toast } from 'sonner';

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'system';
  content: string;
  timestamp: Date;
}

interface SandboxTerminalProps {
  workspaceId?: string;
  onWorkspaceCreate?: (workspaceId: string) => void;
}

export default function SandboxTerminal({ workspaceId, onWorkspaceCreate }: SandboxTerminalProps) {
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: '0',
      type: 'system',
      content: 'Sandbox Terminal - Type Python code and press Enter or click Run',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(workspaceId);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    if (workspaceId) {
      setCurrentWorkspaceId(workspaceId);
    }
  }, [workspaceId]);

  const addLine = (type: TerminalLine['type'], content: string) => {
    setLines((prev) => [
      ...prev,
      {
        id: Date.now().toString() + Math.random(),
        type,
        content,
        timestamp: new Date(),
      },
    ]);
  };

  const ensureWorkspace = async () => {
    if (currentWorkspaceId) return currentWorkspaceId;

    setIsCreatingWorkspace(true);
    addLine('system', 'Creating sandbox...');

    try {
      const workspace = await daytonaApi.createWorkspace('terminal-session');
      setCurrentWorkspaceId(workspace.workspace_id);
      onWorkspaceCreate?.(workspace.workspace_id);
      addLine('system', `Sandbox created: ${workspace.workspace_id}`);
      return workspace.workspace_id;
    } catch (error) {
      addLine('error', `Failed to create sandbox: ${error}`);
      toast.error('Failed to create sandbox');
      throw error;
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const executeCode = async () => {
    if (!input.trim() || isExecuting) return;

    const code = input.trim();
    addLine('input', `>>> ${code}`);
    setInput('');
    setIsExecuting(true);

    try {
      const wsId = await ensureWorkspace();

      const result = await daytonaApi.executeCode({
        workspace_id: wsId,
        code,
        language: 'python',
        timeout: 30,
      });

      if (result.success) {
        if (result.stdout) {
          addLine('output', result.stdout);
        }
      } else {
        addLine('error', result.stderr || result.error || 'Execution failed');
      }
    } catch (error) {
      addLine('error', `Error: ${error}`);
      toast.error('Execution failed');
    } finally {
      setIsExecuting(false);
      inputRef.current?.focus();
    }
  };

  const clearTerminal = () => {
    setLines([
      {
        id: Date.now().toString(),
        type: 'system',
        content: 'Terminal cleared',
        timestamp: new Date(),
      },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCode();
    }
  };

  const getLineColor = (type: TerminalLine['type']) => {
    switch (type) {
      case 'input':
        return 'text-blue-400';
      case 'output':
        return 'text-foreground';
      case 'error':
        return 'text-red-400';
      case 'system':
        return 'text-yellow-400';
      default:
        return 'text-foreground';
    }
  };

  const getLineIcon = (type: TerminalLine['type']) => {
    switch (type) {
      case 'input':
        return <Play size={12} className="text-blue-400" />;
      case 'output':
        return <CheckCircle size={12} className="text-green-400" />;
      case 'error':
        return <XCircle size={12} className="text-red-400" />;
      case 'system':
        return <Terminal size={12} className="text-yellow-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col bg-black/95 text-white font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-900">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-green-400" />
          <span className="font-bold text-xs">SANDBOX TERMINAL</span>
          {currentWorkspaceId && (
            <span className="text-xs text-gray-400">({currentWorkspaceId.slice(0, 12)}...)</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isCreatingWorkspace && (
            <span className="text-xs text-yellow-400 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Creating...
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-gray-400 hover:text-white"
            onClick={clearTerminal}
            title="Clear terminal"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {/* Terminal Output */}
      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        <div className="space-y-1">
          {lines.map((line) => (
            <div key={line.id} className="flex items-start gap-2 font-mono text-xs">
              <span className="flex-shrink-0 mt-0.5">{getLineIcon(line.type)}</span>
              <pre className={`flex-1 whitespace-pre-wrap break-words ${getLineColor(line.type)}`}>
                {line.content}
              </pre>
            </div>
          ))}
          {isExecuting && (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 size={12} className="animate-spin" />
              <span className="text-xs">Executing...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-gray-700 bg-gray-900 p-2">
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold">&gt;&gt;&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter Python code..."
            disabled={isExecuting || isCreatingWorkspace}
            className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-500 font-mono text-xs disabled:opacity-50"
            autoFocus
          />
          <Button
            onClick={executeCode}
            size="sm"
            disabled={isExecuting || isCreatingWorkspace || !input.trim()}
            className="h-7 px-2 bg-green-600 hover:bg-green-700 text-white border-none"
          >
            {isExecuting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <>
                <Play size={14} />
                <span className="ml-1 text-xs">Run</span>
              </>
            )}
          </Button>
        </div>
        <div className="mt-1 text-[10px] text-gray-500">
          Press Enter to execute • Shift+Enter for new line • Python 3.12
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal, Play, Trash2, Loader2, CheckCircle, XCircle, RefreshCw, FolderSync } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { daytonaApi } from '@/lib/api/daytona';
import { useProject } from '@/contexts/project-context';
import { toast } from 'sonner';

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'system';
  content: string;
  timestamp: Date;
  isPrompt?: boolean; // true for "$ " prompt line
}

interface SandboxTerminalProps {
  workspaceId?: string;
  onWorkspaceCreate?: (workspaceId: string) => void;
}

type InitStage = 'idle' | 'creating' | 'syncing' | 'ready';

export default function SandboxTerminal({ workspaceId, onWorkspaceCreate }: SandboxTerminalProps) {
  const { currentProject } = useProject();

  // Only show terminal for ROS projects
  const isRosProject = currentProject?.project_type === 'ros';

  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(workspaceId);
  const [initStage, setInitStage] = useState<InitStage>('idle');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize terminal message based on project type
  useEffect(() => {
    if (currentProject) {
      const welcomeMessages = isRosProject
        ? [
            {
              id: '0',
              type: 'system',
              content: '🤖 ROS Sandbox Terminal - Ready for ROS development',
              timestamp: new Date(),
            },
            {
              id: '1',
              type: 'system',
              content: '📁 Project files: /home/daytona/project | Auto-sync enabled',
              timestamp: new Date(),
            },
            {
              id: '2',
              type: 'system',
              content: '💡 Quick start: roscore | rosrun | rostopic list | rosmsg show',
              timestamp: new Date(),
            },
          ]
        : [
            {
              id: '0',
              type: 'system',
              content: 'Sandbox Terminal - Available only for ROS projects',
              timestamp: new Date(),
            },
          ];
      setLines(welcomeMessages);
    }
  }, [isRosProject, currentProject?.id]);

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

  const addLine = (type: TerminalLine['type'], content: string, isPrompt: boolean = false) => {
    setLines((prev) => [
      ...prev,
      {
        id: Date.now().toString() + Math.random(),
        type,
        content,
        timestamp: new Date(),
        isPrompt,
      },
    ]);
  };

  const ensureWorkspace = useCallback(async (): Promise<string | null> => {
    if (currentWorkspaceId) return currentWorkspaceId;

    if (!isRosProject) {
      addLine('error', 'Daytona sandboxes are only available for ROS projects');
      return null;
    }

    const projectId = currentProject?.id || 'terminal-session';

    // Stage 1: Creating sandbox environment
    setInitStage('creating');
    addLine('system', 'Creating sandbox environment...');

    try {
      // Stage 2: The backend creates the sandbox AND syncs files
      setInitStage('syncing');
      addLine('system', 'Syncing project files to sandbox...');

      const workspace = await daytonaApi.createWorkspace(projectId);
      const wsId = workspace.workspace_id;

      setCurrentWorkspaceId(wsId);
      onWorkspaceCreate?.(wsId);

      // Show sync results
      if (workspace.files_synced > 0) {
        addLine(
          'system',
          `Synced ${workspace.files_synced} project file${workspace.files_synced !== 1 ? 's' : ''} to sandbox`
        );
      }

      if (workspace.sync_status === 'partial') {
        addLine('error', 'Warning: Some files failed to sync');
      }

      // Stage 3: Ready
      setInitStage('ready');
      addLine(
        'system',
        `Sandbox ready (${wsId.slice(0, 12)}...) - working directory: /home/daytona/project`
      );

      return wsId;
    } catch (error) {
      addLine('error', `Failed to create sandbox: ${error}`);
      toast.error('Failed to create sandbox');
      return null;
    } finally {
      setInitStage('idle');
    }
  }, [currentWorkspaceId, currentProject?.id, onWorkspaceCreate]);

  const executeCommand = async () => {
    if (!input.trim() || isExecuting) return;

    const command = input.trim();

    // Add command to history and display
    setHistory((prev) => [command, ...prev]);
    setHistoryIndex(-1);
    addLine('input', `$ ${command}`, true);
    setInput('');
    setIsExecuting(true);

    try {
      const wsId = await ensureWorkspace();
      if (!wsId) {
        setIsExecuting(false);
        return;
      }

      // Auto-sync files before executing command
      if (currentProject?.id) {
        addLine('system', 'Syncing latest files...');
        try {
          const syncResult = await daytonaApi.syncFiles(wsId, currentProject.id);
          if (syncResult.files_synced > 0) {
            addLine('system', `✓ Synced ${syncResult.files_synced} file${syncResult.files_synced !== 1 ? 's' : ''}`);
          }
          if (syncResult.errors.length > 0) {
            syncResult.errors.slice(0, 3).forEach(err => addLine('error', err));
          }
        } catch (syncError) {
          addLine('error', `Sync warning: ${syncError}`);
          // Continue anyway - files might still be there from initial sync
        }
      }

      const result = await daytonaApi.executeCode({
        workspace_id: wsId,
        code: command,
        language: 'shell',
        timeout: 30,
      });

      // Display output
      if (result.stdout.trim()) {
        addLine('output', result.stdout);
      }

      // Display errors if any
      if (!result.success) {
        if (result.stderr.trim()) {
          addLine('error', result.stderr);
        }
        if (result.error) {
          addLine('error', result.error);
        }
      }
    } catch (error) {
      addLine('error', `Error: ${error}`);
      toast.error('Command failed');
    } finally {
      setIsExecuting(false);
      inputRef.current?.focus();
    }
  };

  const resyncFiles = async () => {
    if (!currentWorkspaceId || !currentProject?.id) {
      toast.error('No active sandbox or project');
      return;
    }

    setInitStage('syncing');
    addLine('system', 'Re-syncing project files...');

    try {
      const result = await daytonaApi.syncFiles(currentWorkspaceId, currentProject.id);
      addLine(
        'system',
        `Synced ${result.files_synced} file${result.files_synced !== 1 ? 's' : ''} (${result.sync_status})`
      );
      if (result.errors.length > 0) {
        result.errors.forEach((err) => addLine('error', err));
      }
    } catch (error) {
      addLine('error', `Sync failed: ${error}`);
      toast.error('File sync failed');
    } finally {
      setInitStage('idle');
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

  const resetSandbox = async () => {
    if (currentWorkspaceId) {
      try {
        await daytonaApi.stopWorkspace(currentWorkspaceId);
      } catch {
        // Ignore cleanup errors
      }
    }
    setCurrentWorkspaceId(undefined);
    setInitStage('idle');
    setLines([
      {
        id: Date.now().toString(),
        type: 'system',
        content: 'Sandbox reset. A new sandbox will be created on next execution.',
        timestamp: new Date(),
      },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand();
    } else if (e.key === 'ArrowUp' && !e.shiftKey) {
      e.preventDefault();
      if (history.length > 0 && historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  const getLineColor = (type: TerminalLine['type']) => {
    switch (type) {
      case 'input':
        return 'text-cyan-400 font-semibold';
      case 'output':
        return 'text-gray-100 font-medium';
      case 'error':
        return 'text-red-400 font-medium';
      case 'system':
        return 'text-emerald-400 font-medium';
      default:
        return 'text-gray-100';
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

  const getInitStageLabel = () => {
    switch (initStage) {
      case 'creating':
        return 'Creating sandbox...';
      case 'syncing':
        return 'Syncing files...';
      default:
        return '';
    }
  };

  const isInitializing = initStage !== 'idle' && initStage !== 'ready';

  return (
    <div className="h-full flex flex-col bg-black/95 text-white font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-900">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-green-400" />
          <span className="font-bold text-xs">SANDBOX TERMINAL</span>
          {currentWorkspaceId && (
            <>
              <span className="text-xs text-gray-400">({currentWorkspaceId.slice(0, 12)}...)</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-green-600/20 text-green-400 border border-green-600/40 rounded" title="Files auto-sync before each command">
                AUTO-SYNC
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isInitializing && (
            <span className="text-xs text-yellow-400 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              {getInitStageLabel()}
            </span>
          )}
          {currentWorkspaceId && currentProject?.id && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-gray-400 hover:text-white"
              onClick={resyncFiles}
              disabled={isInitializing}
              title="Re-sync project files"
            >
              <FolderSync size={14} />
            </Button>
          )}
          {currentWorkspaceId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-gray-400 hover:text-white"
              onClick={resetSandbox}
              disabled={isInitializing}
              title="Reset sandbox"
            >
              <RefreshCw size={14} />
            </Button>
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
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-1">
          {lines.map((line) => (
            <div key={line.id} className="flex items-start gap-0 font-mono text-sm leading-relaxed">
              {line.isPrompt ? (
                <pre className={`flex-1 whitespace-pre-wrap break-words ${getLineColor(line.type)}`}>
                  {line.content}
                </pre>
              ) : (
                <>
                  <span className="flex-shrink-0 mt-1 mr-2">{getLineIcon(line.type)}</span>
                  <pre className={`flex-1 whitespace-pre-wrap break-words ${getLineColor(line.type)}`}>
                    {line.content}
                  </pre>
                </>
              )}
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
      <div className="border-t border-gray-700 bg-gray-900 p-3">
        <div className="flex items-start gap-2">
          <span className="text-green-400 font-bold text-sm mt-1">$</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRosProject ? 'Enter ROS command (roscore, rosrun, rostopic...)' : 'Only available for ROS projects'}
            disabled={isExecuting || isInitializing || !isRosProject}
            className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-500 font-mono text-sm disabled:opacity-50 resize-none min-h-[28px] max-h-[120px]"
            rows={1}
            autoFocus
          />
          <Button
            onClick={executeCommand}
            size="sm"
            disabled={isExecuting || isInitializing || !input.trim() || !isRosProject}
            className="h-7 px-2 bg-green-600 hover:bg-green-700 text-white border-none flex-shrink-0 mt-1"
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
        <div className="mt-2 text-xs text-gray-400 flex items-center gap-3">
          <span>⏎ Execute</span>
          <span>⇧⏎ New line</span>
          <span>↑↓ History</span>
        </div>
      </div>
    </div>
  );
}

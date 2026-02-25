'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { daytonaApi, type SandboxFileEntry } from '@/lib/api/daytona';
import { compileService, chatService, projectService, fileService } from '@/lib/api';
import type { CompilerType, ProjectWithFiles } from '@/lib/api/types';
import { useProject } from '@/contexts/project-context';
import { mockMessages as initialMessages, parsePlanSteps, type FileNode, type ChatMessage, type ChatMode } from '@/lib/mock-data';
import TopBar from '@/components/ide/top-bar';
import VscodeFileExplorer from '@/components/ide/vscode-file-explorer';
import EditorPanel, { type EditorSelection } from '@/components/ide/editor-panel';
import RightSidebar from '@/components/ide/right-sidebar';
import type { CodeContext } from '@/components/ide/chat-sidebar';
import TerminalTabsManager from '@/components/ide/terminal-tabs-manager';
import CompileDialog from '@/components/ide/compile-dialog';
import SerialDialog from '@/components/ide/serial-dialog';
import UploadDialog from '@/components/ide/upload-dialog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { buildProjectFileTree, buildSandboxFileTree, buildUnifiedFileTree } from './helpers/fileTreeHelpers';
import { importSandboxFile, syncSandboxToProject } from './helpers/fileHandlers';
import { handleWorkspaceCreate as wsHandleWorkspaceCreate, handleSyncComplete as wsHandleSyncComplete } from './helpers/wsHandlers';

export default function IDEPage() {
  const { currentProject, updateFile, deleteFile, loadProject, createFile, compileProject, isLoading } = useProject();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [editedContent, setEditedContent] = useState<string>('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isCompileModalOpen, setIsCompileModalOpen] = useState(false);
  const [selectedCompiler, setSelectedCompiler] = useState<CompilerType>('arduino' as CompilerType);
  const [compileLogs, setCompileLogs] = useState('');
  const [compileErrors, setCompileErrors] = useState<string[]>([]);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [isSerialModalOpen, setIsSerialModalOpen] = useState(false);
  const [serialPort, setSerialPort] = useState('/dev/ttyACM0');
  const [serialBaud, setSerialBaud] = useState('115200');
  const [serialLogs, setSerialLogs] = useState('');
  const [isSerialConnecting, setIsSerialConnecting] = useState(false);
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [serialError, setSerialError] = useState<string | null>(null);
  const [codeContexts, setCodeContexts] = useState<CodeContext[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>('vibe');

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const serialSocketRef = useRef<WebSocket | null>(null);
  const hasLoadedProjectRef = useRef(false);

  // Sandbox file tree state
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [sandboxEntries, setSandboxEntries] = useState<SandboxFileEntry[]>([]);
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const [isImportingFile, setIsImportingFile] = useState(false);

  // Convert project files to file tree structure
  const projectFileTree = useMemo(() => buildProjectFileTree(currentProject?.files || []), [currentProject?.files]);

  // Use project files only
  const displayFileTree = useMemo(() => {
    if (currentProject?.files && currentProject.files.length > 0) {
      return projectFileTree;
    }
    return [];
  }, [currentProject?.files, projectFileTree]);

  // Build sandbox file tree using explicit type info from the backend.
  const sandboxFileTree = useMemo(() => buildSandboxFileTree(sandboxEntries), [sandboxEntries]);

  // Determine the full relative path for a project file (dir + name)
  const projectFilePaths = useMemo(() => {
    if (!currentProject?.files) return new Set<string>();
    return new Set(
      currentProject.files.map(f => {
        const dir = f.path && f.path !== '/' && f.path !== '.'
          ? f.path.replace(/^\//, '').replace(/\/$/, '') + '/'
          : '';
        return dir + f.name;
      })
    );
  }, [currentProject?.files]);

  // Map from sandbox-relative-path → project file ID (tracked files)
  const sandboxToProjectMap = useMemo(() => {
    const map = new Map<string, string>();
    currentProject?.files.forEach(f => {
      const dir = f.path && f.path !== '/' && f.path !== '.'
        ? f.path.replace(/^\//, '').replace(/\/$/, '') + '/'
        : '';
      map.set(dir + f.name, f.id);
    });
    return map;
  }, [currentProject?.files]);

  // Unified tree: sandbox structure with per-node source annotation.
  const unifiedFileTree = useMemo(
    () => buildUnifiedFileTree(activeWorkspaceId, sandboxFileTree, sandboxToProjectMap),
    [activeWorkspaceId, sandboxFileTree, sandboxToProjectMap]
  );

  // Pull any src/ sandbox files that are not yet tracked in the project into MongoDB.
  const syncSandboxToProjectCb = useCallback(
    (wsId: string, entries: SandboxFileEntry[]) =>
      syncSandboxToProject({
        wsId,
        entries,
        currentProject,
        projectFilePaths,
        loadProject,
      }),
    [currentProject, projectFilePaths, loadProject]
  );

  // Called by SandboxTerminal when a workspace is created/reconnected.
  const handleWorkspaceCreate = useCallback(
    (wsId: string) =>
      wsHandleWorkspaceCreate({
        wsId,
        setActiveWorkspaceId,
        setIsSandboxLoading,
        setSandboxEntries,
        currentProject,
        projectFilePaths,
        loadProject,
      }),
    [setActiveWorkspaceId, setIsSandboxLoading, setSandboxEntries, currentProject, projectFilePaths, loadProject]
  );

  // Called by SandboxTerminal after a project→sandbox sync completes.
  // Refreshes the sandbox file list and imports any new sandbox files back into the project.
  const handleSyncComplete = useCallback(
    (wsId: string) =>
      wsHandleSyncComplete({
        wsId,
        setIsSandboxLoading,
        setSandboxEntries,
        currentProject,
        projectFilePaths,
        loadProject,
      }),
    [setIsSandboxLoading, setSandboxEntries, currentProject, projectFilePaths, loadProject]
  );

  // Import an untracked sandbox file into the project on click, then open it.
  const handleSandboxFileClick = useCallback(
    async (nodeId: string) => {
      if (!activeWorkspaceId || !currentProject || isImportingFile) return;
      const relPath = nodeId.replace(/^sandbox:/, '');
      const entry = sandboxEntries.find(e => e.path === relPath);
      if (!entry) return;
      setIsImportingFile(true);
      try {
        await importSandboxFile({
          wsId: activeWorkspaceId,
          entry,
          currentProject,
          createFile,
          setSelectedFile,
          setEditedContent,
          setFileContents,
        });
      } catch (err) {
        console.error('Failed to import sandbox file:', err);
      } finally {
        setIsImportingFile(false);
      }
    },
    [activeWorkspaceId, currentProject, isImportingFile, createFile, sandboxEntries]
  );

  // Unified click handler for the merged sidebar tree.
  // Sandbox-prefixed IDs are untracked files → import them first.
  // All other IDs are tracked project files → open directly.
  const handleUnifiedFileClick = useCallback(async (nodeId: string) => {
    if (nodeId.startsWith('sandbox:')) {
      await handleSandboxFileClick(nodeId);
    } else {
      handleFileSelect(nodeId);
    }
  }, [handleSandboxFileClick]);

  const handleAddSelectionToChat = useCallback((selection: EditorSelection) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    setCodeContexts((prev) => [
      ...prev,
      { id, ...selection },
    ]);
  }, []);

  const handleRemoveContext = useCallback((id: string) => {
    setCodeContexts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /** Apply file operations from a chat API response and refresh editor state. */
  const applyFileOperations = async (fileOps: any[]) => {
    if (!currentProject || fileOps.length === 0) return;
    await loadProject(currentProject.id);
    const updatedProject = await projectService.getWithFiles(currentProject.id);
    const newContents: Record<string, string> = {};
    updatedProject.files.forEach(file => {
      newContents[file.id] = file.content;
    });
    setFileContents(newContents);
    if (selectedFile && newContents[selectedFile] !== undefined) {
      setEditedContent(newContents[selectedFile]);
      setHasUnsavedChanges(false);
    }
    if (!selectedFile && fileOps.some(op => op.operation === 'create_file')) {
      const createdOp = fileOps.find(op => op.operation === 'create_file');
      const fileId = createdOp?.file_id;
      if (fileId && newContents[fileId]) {
        setSelectedFile(fileId);
        setEditedContent(newContents[fileId]);
      }
    }
  };

  /** Execute a single plan step via the agent and update the step card with the result. */
  const handleAcceptStep = async (messageId: string, stepId: string) => {
    if (!currentProject) return;

    // Find the step
    let stepToRun: import('@/lib/mock-data').PlanStep | undefined;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.planSteps) return m;
        const updatedSteps = m.planSteps.map((s) => {
          if (s.id === stepId) {
            stepToRun = s;
            return { ...s, status: 'executing' as const };
          }
          return s;
        });
        return { ...m, planSteps: updatedSteps };
      })
    );

    if (!stepToRun) return;

    // Build file context for the current file
    const fileCtx = selectedFile && currentFileContent
      ? [{ path: currentProject.files.find(f => f.id === selectedFile)?.path || '', content: editedContent || currentFileContent }]
      : undefined;

    try {
      const result = await chatService.executeStep(currentProject.id, {
        step_title: stepToRun.title,
        step_body: stepToRun.body,
        workspace_id: activeWorkspaceId ?? undefined,
        file_context: fileCtx,
        compiler: currentProject.target_compiler,
      });

      // Mark step as done with result
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.planSteps) return m;
          const updatedSteps = m.planSteps.map((s) =>
            s.id === stepId
              ? {
                  ...s,
                  status: 'done' as const,
                  executionResult: {
                    message: result.message,
                    logs: result.execution_logs,
                    fileOps: result.file_operations,
                    success: result.success,
                  },
                }
              : s
          );
          return { ...m, planSteps: updatedSteps };
        })
      );

      // Apply file operations if the agent created/modified files
      if (result.file_operations.length > 0) {
        await applyFileOperations(result.file_operations);
      }
    } catch (err) {
      console.error('Step execution failed:', err);
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.planSteps) return m;
          const updatedSteps = m.planSteps.map((s) =>
            s.id === stepId
              ? {
                  ...s,
                  status: 'done' as const,
                  executionResult: {
                    message: 'Execution failed. Please try again.',
                    logs: [],
                    fileOps: [],
                    success: false,
                  },
                }
              : s
          );
          return { ...m, planSteps: updatedSteps };
        })
      );
    }
  };

  const handleDiscardStep = (messageId: string, stepId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.planSteps) return m;
        const updatedSteps = m.planSteps.map((s) =>
          s.id === stepId ? { ...s, status: 'discarded' as const } : s
        );
        return { ...m, planSteps: updatedSteps };
      })
    );
  };

  /** Execute all remaining pending steps sequentially. */
  const handleAcceptAllSteps = async (messageId: string) => {
    if (!currentProject) return;

    // Gather all pending step IDs in order
    let pendingStepIds: string[] = [];
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.planSteps) return m;
        pendingStepIds = m.planSteps.filter(s => s.status === 'pending').map(s => s.id);
        return m;
      })
    );

    // Execute each one sequentially
    for (const stepId of pendingStepIds) {
      await handleAcceptStep(messageId, stepId);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !currentProject) return;

    setIsChatLoading(true);
    const userMessage = chatInput.trim();
    const contextSnapshot = [...codeContexts];
    const isPlanMode = chatMode === 'plan';

    const newUserMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      role: 'user',
      content: userMessage,
    };

    setMessages([...messages, newUserMessage]);
    setChatInput('');
    setCodeContexts([]);

    // Add loading message
    const loadingMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      role: 'assistant',
      content: '...',
    };
    setMessages((prev) => [...prev, loadingMessage]);

    try {
      // Prepare file context (current file + any pinned code selections)
      const baseFileContext = selectedFile && currentFileContent
        ? [{
            path: currentProject.files.find(f => f.id === selectedFile)?.path || '',
            content: editedContent || currentFileContent,
          }]
        : [];

      const selectionContext = contextSnapshot.map((ctx) => ({
        path: `${ctx.fileName}:${ctx.startLine}-${ctx.endLine}`,
        content: ctx.content,
      }));

      const fileContext = [...baseFileContext, ...selectionContext].length > 0
        ? [...baseFileContext, ...selectionContext]
        : undefined;

      // Prepare conversation history
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Call chat API — plan_mode=true makes the backend use a planning-only prompt (no tools)
      const response = await chatService.sendMessage(currentProject.id, {
        message: userMessage,
        file_context: fileContext,
        compiler: currentProject.target_compiler,
        conversation_history: conversationHistory,
        plan_mode: isPlanMode,
      } as any);

      // Parse plan steps in plan mode
      const planSteps = isPlanMode ? parsePlanSteps(response.message) : undefined;
      const hasPlanSteps = planSteps && planSteps.length > 0;

      // Remove loading message and add real response
      setMessages((prev) => {
        const withoutLoading = prev.filter(m => m.id !== loadingMessage.id);
        return [
          ...withoutLoading,
          {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            role: 'assistant' as const,
            content: hasPlanSteps ? '' : response.message,
            ...(hasPlanSteps && { planSteps }),
          },
        ];
      });

      // Auto-apply file operations only in vibe mode
      if (!isPlanMode && response.file_operations && response.file_operations.length > 0) {
        console.log('File operations performed:', response.file_operations);
        await applyFileOperations(response.file_operations);
      }

    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => {
        const withoutLoading = prev.filter(m => m.id !== loadingMessage.id);
        return [
          ...withoutLoading,
          {
            id: (Date.now() + 2).toString(),
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
          },
        ];
      });
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleFileSelect = (fileId: string) => {
    // Save current changes before switching if there are any
    if (hasUnsavedChanges && selectedFile) {
      const confirmSwitch = window.confirm('You have unsaved changes. Do you want to discard them?');
      if (!confirmSwitch) return;
    }
    
    setSelectedFile(fileId);
    const content = fileContents[fileId] || '';
    setEditedContent(content);
    setHasUnsavedChanges(false);
    
    // Save selected file to localStorage
    if (currentProject) {
      localStorage.setItem(`cubot-ide-selected-file-${currentProject.id}`, fileId);
    }
  };

  const handleContentChange = (value: string | undefined) => {
    setEditedContent(value ?? '');
    setHasUnsavedChanges(true);
  };

  const handleSaveFile = async () => {
    if (selectedFile) {
      setIsSaving(true);
      try {
        // Update local state immediately for responsiveness
        const updatedContents = {
          ...fileContents,
          [selectedFile]: editedContent,
        };
        setFileContents(updatedContents);
        
        // Save to MongoDB via API if project is loaded
        if (currentProject) {
          const file = currentProject.files.find(f => f.id === selectedFile);
          if (file) {
            await updateFile(file.id, { content: editedContent });
            console.log('File saved to MongoDB:', file.name);
          }
        }
        
        setHasUnsavedChanges(false);
      } catch (error) {
        console.error('Failed to save file:', error);
        alert('Failed to save file to server. Changes saved locally.');
        setHasUnsavedChanges(false);
      } finally {
        setIsSaving(false);
      }
    }
  };

  useEffect(() => {
    const handleGlobalSave = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (hasUnsavedChanges) {
          handleSaveFile();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalSave);
    return () => window.removeEventListener('keydown', handleGlobalSave);
  }, [hasUnsavedChanges, handleSaveFile]);

  // Inline create: called by VscodeFileExplorer when user confirms a new filename
  const handleInlineCreate = async (folderPath: string, fileName: string) => {
    if (!fileName.trim() || !currentProject) return;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const fileType = ext === 'c' ? 'c' : ext === 'cpp' ? 'cpp' : ext === 'h' ? 'h' : 'other';
    try {
      const newFile = await createFile(fileName, folderPath, '', fileType);
      setSelectedFile(newFile.id);
      setEditedContent('');
      setFileContents(prev => ({ ...prev, [newFile.id]: '' }));
    } catch (error) {
      console.error('Failed to create file:', error);
      throw error; // re-throw so explorer can keep input open
    }
  };

  // Inline rename: called by VscodeFileExplorer when user confirms a new name
  const handleInlineRename = async (fileId: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      await updateFile(fileId, { name: newName.trim() });
    } catch (error) {
      console.error('Failed to rename file:', error);
      throw error; // re-throw so explorer can keep input open
    }
  };

  // Handles both file and folder deletion
  const handleDeleteFile = async (nodeId: string) => {
    // If this is a folder node (UI id like 'folder-<name>'), delete all files under it using their real IDs.
    // If it's a sandbox folder (id like 'sandbox-folder:...'), call the Daytona API to delete the path.
    if (nodeId.startsWith('sandbox-folder:')) {
      const folderPath = nodeId.replace(/^sandbox-folder:/, '');
      if (!activeWorkspaceId) return;
      if (!window.confirm(`Delete sandbox folder "${folderPath}" and all its contents? This cannot be undone.`)) return;
      try {
        await daytonaApi.deletePath(activeWorkspaceId, folderPath);
        // Refresh the sandbox file list and import any new files back into project
        if (activeWorkspaceId) await handleSyncComplete(activeWorkspaceId);
      } catch (err) {
        console.error('Failed to delete sandbox folder:', err);
        alert('Failed to delete sandbox folder. See console for details.');
      }
      return;
    }

    if (nodeId.startsWith('folder-')) {
      const folderName = nodeId.replace(/^folder-/, '');
      if (!window.confirm(`Delete folder "${folderName}" and all its contents? This cannot be undone.`)) return;
      const files = currentProject?.files || [];
      const toDelete = files.filter(f => {
        const fileDir = f.path ? f.path.replace(/^\//, '') : '';
        return fileDir === folderName || fileDir.startsWith(folderName + '/');
      });

      // Batch-delete: avoid reloading project after each deletion to prevent
      // inconsistent state. Delete all files, skipping refresh, then reload once.
      for (const f of toDelete) {
        try {
          await deleteFile(f.id, true);
        } catch (err) {
          console.error(`Failed to delete file ${f.name}:`, err);
        }
      }

      // Reload project to refresh file list once
      if (currentProject) await loadProject(currentProject.id);
      // Deselect selected file if it was inside deleted folder
      if (selectedFile) {
        const sel = currentProject?.files.find(f => f.id === selectedFile);
        if (sel && (sel.path === folderName || sel.path?.startsWith(folderName + '/'))) {
          setSelectedFile(null);
          setEditedContent('');
        }
      }
      return;
    }

    // Otherwise treat as a file ID and delete normally
    try {
      await deleteFile(nodeId);
      if (selectedFile === nodeId) {
        setSelectedFile(null);
        setEditedContent('');
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      alert('Failed to delete file. Please try again.');
    }
  };

  const getLanguageFromFileName = (name?: string | null) => {
    if (!name) return 'plaintext';
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'c':
        return 'c';
      case 'h':
        return 'cpp';
      case 'cpp':
      case 'hpp':
        return 'cpp';
      case 'ino':
        return 'cpp';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'py':
        return 'python';
      case 'json':
        return 'json';
      case 'md':
        return 'markdown';
      default:
        return 'plaintext';
    }
  };

  const handleOpenCompileModal = () => {
    setCompileLogs('');
    setCompileErrors([]);
    setExplanation('');
    setIsCompileModalOpen(true);
  };

  const handleOpenSerialModal = () => {
    setSerialError(null);
    setSerialLogs('');
    setIsSerialModalOpen(true);
  };

  const handleOpenUploadModal = () => setIsUploadModalOpen(true);

  const handleCompileForUpload = async (_fqbn: string) => {
    if (!currentProject || currentProject.files.length === 0) {
      return { hexOutput: '', logs: '', errors: ['No project files found.'] };
    }

    const getPath = (f: { path: string; name: string }) => f.path || f.name;
    const inoFile = currentProject.files.find(f => getPath(f).endsWith('.ino'));
    const fallbackFile = currentProject.files.find(f => f.id === selectedFile) ?? currentProject.files[0];
    const mainFile = inoFile ?? fallbackFile;
    const mainFilePath = mainFile ? getPath(mainFile) : undefined;

    if (!mainFilePath) {
      return { hexOutput: '', logs: '', errors: ['No main file selected.'] };
    }

    try {
      const result = await compileService.compile({
        compiler: 'arduino' as CompilerType,
        file_ids: currentProject.files.map(f => f.id),
        main_file: mainFilePath,
        project_id: currentProject.id,
      });
      return {
        hexOutput: result.hex_output ?? '',
        logs: result.output ?? '',
        errors: result.errors ?? [],
      };
    } catch (err: any) {
      return { hexOutput: '', logs: '', errors: [err?.message ?? 'Compilation failed'] };
    }
  };

  const handleDisconnectSerial = () => {
    if (serialSocketRef.current) {
      serialSocketRef.current.close();
      serialSocketRef.current = null;
    }
    setIsSerialConnected(false);
    setIsSerialConnecting(false);
  };

  const handleConnectSerial = () => {
    if (!currentProject) return;
    if (isSerialConnected || isSerialConnecting) return;

    setSerialError(null);
    setIsSerialConnecting(true);

    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
    const wsBase = apiBase.replace(/^http/, 'ws');
    const wsUrl = `${wsBase}/ws/serial?project_id=${currentProject.id}&port=${encodeURIComponent(
      serialPort,
    )}&baud=${encodeURIComponent(serialBaud)}`;

    const ws = new WebSocket(wsUrl);
    serialSocketRef.current = ws;

    ws.onopen = () => {
      setIsSerialConnected(true);
      setIsSerialConnecting(false);
      setSerialLogs('');
    };

    ws.onmessage = (event) => {
      setSerialLogs((prev) => `${prev}${prev ? '\n' : ''}${event.data}`);
    };

    ws.onerror = () => {
      setSerialError('Failed to connect to serial monitor.');
      setIsSerialConnecting(false);
    };

    ws.onclose = () => {
      setIsSerialConnected(false);
      setIsSerialConnecting(false);
    };
  };

  const handleCompile = async () => {
    if (!currentProject || currentProject.files.length === 0) {
      setCompileLogs('No project files found.');
      return;
    }

    const getPath = (f: { path: string; name: string }) => f.path || f.name;
    const mainFile = currentProject.files.find(f => f.id === selectedFile) ?? currentProject.files[0];
    const mainFilePath = mainFile ? getPath(mainFile) : undefined;

    if (!mainFilePath) {
      setCompileLogs('No main file selected.');
      return;
    }

    setIsCompiling(true);
    setCompileErrors([]);
    setCompileLogs('Starting compilation...\n');

    try {
      const result = await compileProject(
        mainFilePath,
        currentProject.files.map(f => f.id),
        selectedCompiler
      );
      setCompileLogs(prev => `${prev}${result.output || ''}`.trim());
      setCompileErrors(result.errors || []);
    } catch (err: any) {
      setCompileLogs(prev => `${prev}\nCompilation failed.`.trim());
      setCompileErrors([err?.message || 'Unknown error']);
    } finally {
      setIsCompiling(false);
    }
  };

  const handleExplainLogs = async () => {
    if (!currentProject) {
      setExplanation('No project loaded.');
      return;
    }
    if (!compileLogs && compileErrors.length === 0) {
      setExplanation('No logs to explain yet.');
      return;
    }

    setIsExplaining(true);
    setExplanation('');

    try {
      const response = await compileService.explainLogs({
        project_id: currentProject.id,
        compiler: selectedCompiler,
        logs: compileLogs,
        errors: compileErrors,
      });
      setExplanation(response.explanation || 'No explanation returned.');
    } catch (err: any) {
      setExplanation(err?.message || 'Failed to explain logs.');
    } finally {
      setIsExplaining(false);
    }
  };

  const currentFileContent = selectedFile ? fileContents[selectedFile] : null;
  const currentFileName = selectedFile
    ? currentProject?.files.find(f => f.id === selectedFile)?.name ?? null
    : null;

  // Load project files from backend on mount or when project changes
  useEffect(() => {
    if (currentProject?.files && currentProject.files.length > 0) {
      const contents: Record<string, string> = {};
      currentProject.files.forEach(file => {
        contents[file.id] = file.content;
      });
      setFileContents(contents);

      // On initial load, select first file or restore from localStorage
      if (!isInitialized) {
        // Restore last selected file from localStorage or select first file
        const savedFileId = localStorage.getItem(`cubot-ide-selected-file-${currentProject.id}`);
        const fileToSelect = savedFileId && currentProject.files.some(f => f.id === savedFileId)
          ? savedFileId
          : currentProject.files[0]?.id;

        if (fileToSelect) {
          setSelectedFile(fileToSelect);
          setEditedContent(contents[fileToSelect] || '');
        }

        // Load chat history
        loadChatHistory(currentProject.id);

        setIsInitialized(true);
        console.log('Loaded project files from MongoDB:', currentProject.files.length, 'files');
      } else if (!selectedFile && currentProject.files.length > 0) {
        // If no file is selected but files exist (e.g., after creating a new file), select the last file
        setSelectedFile(currentProject.files[currentProject.files.length - 1].id);
        setEditedContent(contents[currentProject.files[currentProject.files.length - 1].id] || '');
      }
    }
  }, [currentProject?.id, currentProject?.files]);
  
  const loadChatHistory = async (projectId: string) => {
    try {
      const history = await chatService.getHistory(projectId, 50);
      const formattedMessages = history.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
      }));
      setMessages(formattedMessages);
    } catch (error) {
      console.error('Failed to load chat history:', error);
      // Keep initial messages if loading fails
    }
  };

  // Update editedContent when selectedFile changes
  useEffect(() => {
    if (selectedFile && fileContents[selectedFile] !== undefined && !hasUnsavedChanges) {
      setEditedContent(fileContents[selectedFile]);
    }
  }, [selectedFile, fileContents, hasUnsavedChanges]);

  // Load project from URL or localStorage
  useEffect(() => {
    const initializeProject = async () => {
      if (isInitialized || hasLoadedProjectRef.current) return;
      hasLoadedProjectRef.current = true;
      
      // Try to get project ID from URL or localStorage
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('project') || localStorage.getItem('cubot-ide-last-project');
      
      if (projectId) {
        try {
          await loadProject(projectId);
          localStorage.setItem('cubot-ide-last-project', projectId);
          console.log('Project loaded from MongoDB:', projectId);
        } catch (err) {
          console.log('Failed to load project from MongoDB');
          setFileContents({});
          setSelectedFile(null);
          setEditedContent('');
          setIsInitialized(true);
        }
      } else {
        // No project ID
        console.log('No project ID');
        setFileContents({});
        setSelectedFile(null);
        setEditedContent('');
        setIsInitialized(true);
      }
    };
    
    initializeProject();
  }, [isInitialized, loadProject]);

  useEffect(() => {
    return () => {
      handleDisconnectSerial();
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-black text-foreground overflow-hidden">
      <TopBar
        projectId={currentProject?.id ?? null}
        isArduinoProject={currentProject?.target_compiler === 'arduino'}
        projectType={currentProject?.project_type ?? null}
        onOpenCompile={handleOpenCompileModal}
        onOpenSerial={handleOpenSerialModal}
        onOpenUpload={handleOpenUploadModal}
      />

      <CompileDialog
        open={isCompileModalOpen}
        onOpenChange={setIsCompileModalOpen}
        selectedCompiler={selectedCompiler}
        onSelectCompiler={(compiler) => setSelectedCompiler(compiler)}
        onCompile={handleCompile}
        onExplainLogs={handleExplainLogs}
        isCompiling={isCompiling}
        isExplaining={isExplaining}
        compileLogs={compileLogs}
        compileErrors={compileErrors}
        explanation={explanation}
      />

      <SerialDialog
        open={isSerialModalOpen}
        onOpenChange={setIsSerialModalOpen}
        serialPort={serialPort}
        onSerialPortChange={setSerialPort}
        serialBaud={serialBaud}
        onSerialBaudChange={setSerialBaud}
        isSerialConnected={isSerialConnected}
        isSerialConnecting={isSerialConnecting}
        serialError={serialError}
        serialLogs={serialLogs}
        onConnect={handleConnectSerial}
        onDisconnect={handleDisconnectSerial}
      />

      <UploadDialog
        open={isUploadModalOpen}
        onOpenChange={setIsUploadModalOpen}
        onCompile={handleCompileForUpload}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* File Sidebar */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
            <VscodeFileExplorer
              nodes={activeWorkspaceId ? unifiedFileTree : displayFileTree}
              selectedFile={selectedFile}
              onSelectFile={activeWorkspaceId ? handleUnifiedFileClick : handleFileSelect}
              onRenameFile={handleInlineRename}
              onDeleteFile={handleDeleteFile}
              onCreateFile={handleInlineCreate}
              isLoading={isLoading}
              isSandboxLoading={isSandboxLoading}
              isImportingFile={isImportingFile}
            />
          </ResizablePanel>

          <ResizableHandle withHandle className="w-px bg-white/[0.06] hover:bg-white/20 transition-colors" />

          <ResizablePanel defaultSize={55} minSize={30}>
            {currentProject?.project_type === 'ros' ? (
              <ResizablePanelGroup direction="vertical">
                {/* Editor */}
                <ResizablePanel defaultSize={65} minSize={30}>
                  <EditorPanel
                    currentFileName={currentFileName}
                    currentProjectName={currentProject?.name ?? null}
                    hasUnsavedChanges={hasUnsavedChanges}
                    isSaving={isSaving}
                    onSave={handleSaveFile}
                    currentFileContent={currentFileContent}
                    editedContent={editedContent}
                    onChange={handleContentChange}
                    getLanguageFromFileName={getLanguageFromFileName}
                    onAddSelectionToChat={handleAddSelectionToChat}
                  />
                </ResizablePanel>

                <ResizableHandle withHandle className="h-px bg-white/[0.06] hover:bg-white/20 transition-colors" />

                {/* Sandbox Terminal - ROS Projects Only */}
                <ResizablePanel defaultSize={35} minSize={20}>
                  <TerminalTabsManager
                    workspaceId={activeWorkspaceId ?? undefined}
                    onWorkspaceCreate={handleWorkspaceCreate}
                    onSyncComplete={handleSyncComplete}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              /* Non-ROS Projects - Editor Only */
              <EditorPanel
                currentFileName={currentFileName}
                currentProjectName={currentProject?.name ?? null}
                hasUnsavedChanges={hasUnsavedChanges}
                isSaving={isSaving}
                onSave={handleSaveFile}
                currentFileContent={currentFileContent}
                editedContent={editedContent}
                onChange={handleContentChange}
                getLanguageFromFileName={getLanguageFromFileName}
                onAddSelectionToChat={handleAddSelectionToChat}
              />
            )}
          </ResizablePanel>

          <ResizableHandle withHandle className="w-px bg-white/[0.06] hover:bg-white/20 transition-colors" />

          <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
            <RightSidebar
              messages={messages}
              chatInput={chatInput}
              onChatInputChange={setChatInput}
              onSendMessage={handleSendMessage}
              isLoading={isChatLoading}
              codeContexts={codeContexts}
              onRemoveContext={handleRemoveContext}
              chatMode={chatMode}
              onModeChange={setChatMode}
              onAcceptStep={handleAcceptStep}
              onAcceptAllSteps={handleAcceptAllSteps}
              onDiscardStep={handleDiscardStep}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}


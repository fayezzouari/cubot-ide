'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { sandboxApi, type SandboxFileEntry } from '@/lib/api/sandbox';
import { compileService, chatService, projectService, fileService } from '@/lib/api';
import type { CompilerType, ProjectWithFiles } from '@/lib/api/types';
import { useProject } from '@/contexts/project-context';
import { parsePlanSteps, type ChatMessage, type ChatMode, type FileChange, type ActivityItem } from '@/lib/mock-data';
import type { AgentEvent, FileOperation, FileResponse, ThreadSummary } from '@/lib/api/types';
import TopBar from '@/components/ide/top-bar';
import VscodeFileExplorer from '@/components/ide/vscode-file-explorer';
import EditorPanel, { type EditorSelection } from '@/components/ide/editor-panel';
import AgentPanel, { type CodeContext } from '@/components/ide/agent/agent-panel';
import TerminalTabsManager from '@/components/ide/terminal-tabs-manager';
import CompileDialog from '@/components/ide/compile-dialog';
import SerialDialog from '@/components/ide/serial-dialog';
import UploadDialog from '@/components/ide/upload-dialog';
import MissionPanel from '@/components/ide/mission-panel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { buildProjectFileTree, buildSandboxFileTree, buildUnifiedFileTree } from './helpers/fileTreeHelpers';
import { importSandboxFile, syncSandboxToProject } from './helpers/fileHandlers';
import { handleWorkspaceCreate as wsHandleWorkspaceCreate, handleSyncComplete as wsHandleSyncComplete } from './helpers/wsHandlers';

export default function IDEPage() {
  const { currentProject, setCurrentProject, updateFile, deleteFile, loadProject, createFile, compileProject, isLoading } = useProject();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [enableWebsearch, setEnableWebsearch] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>('build');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadRef = useRef<string | null>(null);
  activeThreadRef.current = activeThreadId;

  const [isChatLoading, setIsChatLoading] = useState(false);
  const [reverting, setReverting] = useState<{ messageId: string; index: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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
  const [codeContexts, setCodeContexts] = useState<CodeContext[]>([]);

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isMissionCollapsed, setIsMissionCollapsed] = useState(false);

  const hasLoadedProjectRef = useRef(false);
  const initializedProjectRef = useRef<string | null>(null);

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

  /** Full project-relative path of a file, whichever storage convention it uses. */
  const fullPathOf = (f: { path: string; name: string }) => {
    const raw = (f.path || '').replace(/^\/+|\/+$/g, '');
    if (!raw || raw === '.' || raw === f.name) return f.name;
    if (raw.endsWith('/' + f.name)) return raw;
    return `${raw}/${f.name}`;
  };

  const activeFile = selectedFile ? currentProject?.files.find(f => f.id === selectedFile) ?? null : null;
  const activeFilePath = activeFile ? fullPathOf(activeFile) : undefined;
  // ROS projects verify in the sandbox; the compile tool only makes sense for embedded targets.
  const agentCompiler = currentProject?.project_type === 'ros' ? undefined : currentProject?.target_compiler;

  /** Pull the latest file contents from the server after the agent changed files. */
  const refreshFilesFromServer = async (changed: FileOperation[] | FileChange[]) => {
    if (!currentProject) return;
    await loadProject(currentProject.id);
    const updatedProject = await projectService.getWithFiles(currentProject.id);
    const newContents: Record<string, string> = {};
    updatedProject.files.forEach((file: FileResponse) => {
      newContents[file.id] = file.content;
    });
    setFileContents(newContents);
    if (selectedFile && newContents[selectedFile] !== undefined) {
      setEditedContent(newContents[selectedFile]);
      setHasUnsavedChanges(false);
    }
    if (!selectedFile) {
      const created = changed.find(op => op.operation === 'create_file' && op.file_id && newContents[op.file_id] !== undefined);
      if (created?.file_id) {
        setSelectedFile(created.file_id);
        setEditedContent(newContents[created.file_id]);
      }
    }
  };

  /** Context the agent gets with every request: the open file (if included) plus pinned selections. */
  const buildFileContext = (contexts: CodeContext[]) => {
    const base = activeFile && currentFileContent !== null
      ? [{ path: activeFilePath!, content: editedContent || currentFileContent }]
      : [];
    const selections = contexts.map(ctx => ({
      path: `${ctx.fileName}:${ctx.startLine}-${ctx.endLine}`,
      content: ctx.content,
    }));
    const all = [...base, ...selections];
    return all.length > 0 ? all : undefined;
  };

  /** Execute a single plan step via the agent and update the step card with the result. */
  const handleAcceptStep = async (messageId: string, stepId: string) => {
    if (!currentProject) return;

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

    const finish = (result: import('@/lib/mock-data').PlanStepExecutionResult) =>
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.planSteps) return m;
          return {
            ...m,
            planSteps: m.planSteps.map((s) =>
              s.id === stepId ? { ...s, status: 'done' as const, executionResult: result } : s
            ),
          };
        })
      );

    try {
      const result = await chatService.executeStep(currentProject.id, {
        step_title: stepToRun.title,
        step_body: stepToRun.body,
        workspace_id: activeWorkspaceId ?? undefined,
        file_context: buildFileContext([]),
        active_file_path: activeFilePath,
        compiler: agentCompiler,
        enable_websearch: enableWebsearch,
      });
      finish({
        message: result.message,
        logs: result.execution_logs,
        fileOps: result.file_operations,
        success: result.success,
      });
      if (result.file_operations.length > 0) {
        await refreshFilesFromServer(result.file_operations);
      }
    } catch (err) {
      console.error('Step execution failed:', err);
      finish({ message: 'Execution failed. Please try again.', logs: [], fileOps: [], success: false });
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

  const threadStorageKey = (projectId: string) => `cubot-ide-thread-${projectId}`;

  const refreshThreads = async (projectId: string) => {
    try {
      const list = await chatService.listThreads(projectId);
      if (initializedProjectRef.current !== projectId) return [];
      setThreads(list);
      return list;
    } catch (err) {
      console.error('Failed to list threads:', err);
      return [];
    }
  };

  /** Start an empty conversation; the thread is created on the server with the first message. */
  const handleNewThread = () => {
    abortRef.current?.abort();
    setActiveThreadId(null);
    setMessages([]);
    setChatInput('');
    setCodeContexts([]);
    if (currentProject) localStorage.removeItem(threadStorageKey(currentProject.id));
  };

  const handleSelectThread = async (threadId: string) => {
    if (!currentProject || threadId === activeThreadId) return;
    abortRef.current?.abort();
    setActiveThreadId(threadId);
    localStorage.setItem(threadStorageKey(currentProject.id), threadId);
    await loadChatHistory(currentProject.id, threadId);
  };

  const handleDeleteThread = async (threadId: string) => {
    if (!currentProject) return;
    try {
      await chatService.deleteThread(currentProject.id, threadId);
    } catch (err) {
      console.error('Failed to delete thread:', err);
      return;
    }
    const remaining = threads.filter(t => t.id !== threadId);
    setThreads(remaining);
    if (threadId === activeThreadId) handleNewThread();
  };

  const handleRenameThread = async (threadId: string, title: string) => {
    if (!currentProject || !title.trim()) return;
    try {
      await chatService.renameThread(currentProject.id, threadId, title.trim());
      setThreads(prev => prev.map(t => (t.id === threadId ? { ...t, title: title.trim() } : t)));
    } catch (err) {
      console.error('Failed to rename thread:', err);
    }
  };

  /** Execute all remaining pending steps sequentially. */
  const handleAcceptAllSteps = async (messageId: string) => {
    if (!currentProject) return;

    let pendingStepIds: string[] = [];
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.planSteps) return m;
        pendingStepIds = m.planSteps.filter(s => s.status === 'pending').map(s => s.id);
        return m;
      })
    );

    for (const stepId of pendingStepIds) {
      await handleAcceptStep(messageId, stepId);
    }
  };

  /** Put one of the agent's file changes back: restore the old content, or delete a created file. */
  const handleRevertChange = async (messageId: string, index: number) => {
    const message = messages.find(m => m.id === messageId);
    const change = message?.fileOps?.[index];
    if (!change?.file_id || change.reverted || !currentProject) return;
    setReverting({ messageId, index });
    try {
      if (change.operation === 'create_file') {
        await deleteFile(change.file_id, true);
        if (selectedFile === change.file_id) {
          setSelectedFile(null);
          setEditedContent('');
        }
      } else if (typeof change.previous_content === 'string') {
        await updateFile(change.file_id, { content: change.previous_content });
      } else {
        return;
      }
      setMessages(prev =>
        prev.map(m =>
          m.id !== messageId || !m.fileOps
            ? m
            : { ...m, fileOps: m.fileOps.map((op, i) => (i === index ? { ...op, reverted: true } : op)) }
        )
      );
      await refreshFilesFromServer([]);
    } catch (err) {
      console.error('Revert failed:', err);
      alert('Could not revert this change.');
    } finally {
      setReverting(null);
    }
  };

  const handleOpenChangedFile = (change: FileChange) => {
    if (!change.file_id || !currentProject?.files.some(f => f.id === change.file_id)) return;
    handleFileSelect(change.file_id);
  };

  const handleStopAgent = () => {
    abortRef.current?.abort();
  };

  const handleSendMessage = async (override?: string, modeOverride?: ChatMode) => {
    const userMessage = (override ?? chatInput).trim();
    if (!userMessage || !currentProject || isChatLoading) return;

    setIsChatLoading(true);
    const contextSnapshot = [...codeContexts];
    const sendMode = modeOverride ?? chatMode;
    const isPlanMode = sendMode === 'plan';
    const attachments = [
      ...(activeFile ? [activeFile.name] : []),
      ...contextSnapshot.map(c => `${c.fileName}:${c.startLine}-${c.endLine}`),
    ];

    const newId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const newUserMessage: ChatMessage = { id: newId(), role: 'user', content: userMessage, attachments };
    const assistantId = newId();
    const placeholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      mode: sendMode,
      status: 'streaming',
      statusText: isPlanMode ? 'Planning' : 'Thinking',
      activity: [],
    };

    // Conversation history is what's on screen before this message.
    const conversationHistory = messages
      .filter(m => m.status !== 'error' && m.content)
      .map(m => ({ role: m.role, content: m.content }));

    setMessages([...messages, newUserMessage, placeholder]);
    setChatInput('');
    setCodeContexts([]);

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages(prev => prev.map(m => (m.id === assistantId ? fn(m) : m)));

    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;
    const threadAtSend = activeThreadId;

    const onEvent = (event: AgentEvent) => {
      switch (event.type) {
        case 'thread':
          if (event.thread_id !== threadAtSend) {
            setActiveThreadId(event.thread_id);
            localStorage.setItem(threadStorageKey(currentProject.id), event.thread_id);
          }
          break;
        case 'status':
          patchAssistant(m => ({ ...m, statusText: event.text }));
          break;
        case 'text_delta':
          patchAssistant(m => ({ ...m, content: m.content + event.text }));
          break;
        case 'tool_start': {
          const item: ActivityItem = { id: event.id, tool: event.tool, label: event.label, detail: event.detail, status: 'running' };
          patchAssistant(m => ({
            ...m,
            statusText: `${event.label}${event.detail ? ' ' + event.detail : ''}`,
            // Text the model wrote before calling a tool stays; the next text starts a new paragraph.
            content: m.content && !m.content.endsWith('\n\n') ? m.content.trimEnd() + '\n\n' : m.content,
            activity: [...(m.activity ?? []), item],
          }));
          break;
        }
        case 'tool_end':
          patchAssistant(m => ({
            ...m,
            activity: (m.activity ?? []).map(a =>
              a.id === event.id ? { ...a, status: event.ok ? 'done' : 'failed', summary: event.summary, log: event.log } : a
            ),
          }));
          if (event.file_op) {
            // Refresh the editor as soon as a file lands so the user watches the change happen.
            void refreshFilesFromServer([event.file_op]);
          }
          break;
        case 'done': {
          finished = true;
          const planSteps = isPlanMode ? parsePlanSteps(event.message) : undefined;
          const hasPlanSteps = !!planSteps && planSteps.length > 0;
          patchAssistant(m => ({
            ...m,
            status: 'done',
            statusText: undefined,
            content: hasPlanSteps ? '' : event.message,
            ...(hasPlanSteps && { planSteps }),
            fileOps: event.file_operations,
          }));
          if (event.file_operations.length > 0) {
            void refreshFilesFromServer(event.file_operations);
          }
          break;
        }
        case 'error':
          finished = true;
          patchAssistant(m => ({ ...m, status: 'error', statusText: undefined, content: event.message }));
          break;
        default:
          break;
      }
    };

    try {
      await chatService.stream(
        currentProject.id,
        {
          message: userMessage,
          file_context: buildFileContext(contextSnapshot),
          active_file_path: activeFilePath,
          compiler: agentCompiler,
          conversation_history: conversationHistory,
          plan_mode: isPlanMode,
          tutor_mode: sendMode === 'tutor',
          enable_websearch: enableWebsearch,
          workspace_id: activeWorkspaceId ?? undefined,
          thread_id: threadAtSend ?? undefined,
        },
        onEvent,
        controller.signal,
      );
      void refreshThreads(currentProject.id);
      if (!finished) {
        patchAssistant(m => ({ ...m, status: 'error', statusText: undefined, content: 'The connection closed before the agent finished.' }));
      }
    } catch (error: any) {
      if (controller.signal.aborted) {
        patchAssistant(m => ({
          ...m,
          status: 'done',
          statusText: undefined,
          content: m.content || 'Stopped.',
          activity: (m.activity ?? []).map(a => (a.status === 'running' ? { ...a, status: 'failed', summary: 'stopped' } : a)),
        }));
      } else {
        console.error('Chat error:', error);
        patchAssistant(m => ({ ...m, status: 'error', statusText: undefined, content: error?.message || 'Something went wrong. Please try again.' }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsChatLoading(false);
    }
  };

  /** Hand the compiler's errors to the agent and let it fix them. */
  const handleFixWithAgent = () => {
    const errorText = compileErrors.length > 0 ? compileErrors.join('\n') : compileLogs.trim().split('\n').slice(-30).join('\n');
    if (!errorText) return;
    setIsCompileModalOpen(false);
    setChatMode('build');
    const prompt = `The ${selectedCompiler} build failed. Fix the errors and make sure it compiles.\n\n\`\`\`\n${errorText}\n\`\`\``;
    // Build-mode state is set above; send on the next tick so the mode switch is applied first.
    setTimeout(() => void handleSendMessage(prompt, 'build'), 0);
  };

  const missionId = currentProject?.mission_id ?? null;

  useEffect(() => {
    if (missionId) setChatMode('tutor');
  }, [missionId]);

  const handleAskTutor = (prompt: string) => {
    setChatMode('tutor');
    setTimeout(() => void handleSendMessage(prompt, 'tutor'), 0);
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
    // If it's a sandbox folder (id like 'sandbox-folder:...'), call the sandbox API to delete the path.
    if (nodeId.startsWith('sandbox-folder:')) {
      const folderPath = nodeId.replace(/^sandbox-folder:/, '');
      if (!activeWorkspaceId) return;
      if (!window.confirm(`Delete sandbox folder "${folderPath}" and all its contents? This cannot be undone.`)) return;
      try {
        await sandboxApi.deletePath(activeWorkspaceId, folderPath);
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

  const handleOpenSerialModal = () => setIsSerialModalOpen(true);

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
    if (currentProject) {
      const contents: Record<string, string> = {};
      currentProject.files.forEach(file => {
        contents[file.id] = file.content;
      });
      setFileContents(contents);

      if (initializedProjectRef.current !== currentProject.id) {
        const projectId = currentProject.id;
        initializedProjectRef.current = projectId;

        const savedFileId = localStorage.getItem(`cubot-ide-selected-file-${projectId}`);
        const fileToSelect = savedFileId && currentProject.files.some(f => f.id === savedFileId)
          ? savedFileId
          : currentProject.files[0]?.id ?? null;

        setSelectedFile(fileToSelect);
        setEditedContent(fileToSelect ? contents[fileToSelect] || '' : '');
        setHasUnsavedChanges(false);
        setActiveWorkspaceId(null);
        setSandboxEntries([]);
        abortRef.current?.abort();
        setMessages([]);
        setThreads([]);
        setActiveThreadId(null);
        setCodeContexts([]);

        void (async () => {
          const list = await refreshThreads(projectId);
          if (initializedProjectRef.current !== projectId) return;
          const saved = localStorage.getItem(threadStorageKey(projectId));
          const initial = list.find(t => t.id === saved)?.id ?? list[0]?.id ?? null;
          setActiveThreadId(initial);
          if (initial) await loadChatHistory(projectId, initial);
        })();

        setIsInitialized(true);
        console.log('Loaded project files from MongoDB:', currentProject.files.length, 'files');
      } else if (!selectedFile && currentProject.files.length > 0) {
        // If no file is selected but files exist (e.g., after creating a new file), select the last file
        setSelectedFile(currentProject.files[currentProject.files.length - 1].id);
        setEditedContent(contents[currentProject.files[currentProject.files.length - 1].id] || '');
      }
    }
  }, [currentProject?.id, currentProject?.files]);
  
  const loadChatHistory = async (projectId: string, threadId: string) => {
    try {
      const history = await chatService.getHistory(projectId, 200, threadId);
      if (activeThreadRef.current !== threadId) return;
      const loaded: ChatMessage[] = [];
      history.forEach(msg => {
        const isPlan = msg.mode === 'plan';
        const historyMode: ChatMode = msg.mode === 'plan' || msg.mode === 'tutor' ? msg.mode : 'build';
        const planSteps = isPlan && msg.role === 'assistant' ? parsePlanSteps(msg.content) : undefined;
        const hasSteps = !!planSteps && planSteps.length > 0;
        const formatted: ChatMessage = {
          id: msg.id,
          role: msg.role as 'user' | 'assistant',
          content: hasSteps ? '' : msg.content,
          mode: historyMode,
          status: msg.role === 'assistant' ? 'done' : undefined,
          ...(hasSteps && { planSteps }),
          ...(msg.file_operations?.length ? { fileOps: msg.file_operations as FileChange[] } : {}),
          ...(msg.role === 'user' && msg.file_context?.length ? { attachments: msg.file_context.map(fc => fc.path) } : {}),
        };
        loaded.push(formatted);
      });
      setMessages(loaded);
    } catch (error) {
      console.error('Failed to load chat history:', error);
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
      
      // Try to get project ID from URL — URL always wins over localStorage
      const urlParams = new URLSearchParams(window.location.search);
      const urlProjectId = urlParams.get('project');
      const projectId = urlProjectId || localStorage.getItem('cubot-ide-last-project');
      
      if (projectId) {
        try {
          setCurrentProject(null); // clear stale project before fetching new one
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


  const quickPrompts = useMemo(() => {
    if (!currentProject) return [];
    const fileName = activeFile?.name;
    const list: Array<{ label: string; prompt: string; icon: 'fix' | 'explain' | 'improve' }> = [];
    if (fileName) {
      list.push({ label: `Explain ${fileName}`, prompt: `Explain what ${fileName} does, section by section, and point out anything fragile.`, icon: 'explain' });
      list.push({ label: `Review ${fileName} for bugs`, prompt: `Review ${fileName} for bugs, undefined behaviour and timing issues on this target. Fix what you find and verify the build.`, icon: 'fix' });
    }
    if (currentProject.project_type !== 'ros') {
      list.push({ label: 'Compile and fix errors', prompt: 'Compile the project. If it fails, fix the errors and compile again until it passes.', icon: 'improve' });
    } else {
      list.push({ label: 'Build the workspace', prompt: 'Build the ROS workspace in the sandbox and fix any errors you find.', icon: 'improve' });
    }
    return list;
  }, [currentProject, activeFile?.name]);

  const editorPanel = (
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
  );

  const missionPanel = missionId && currentProject ? (
    <MissionPanel
      missionId={missionId}
      projectId={currentProject.id}
      files={currentProject.files}
      hasUnsavedChanges={hasUnsavedChanges}
      onSave={handleSaveFile}
      onAskTutor={handleAskTutor}
      collapsed={isMissionCollapsed}
      onToggleCollapsed={() => setIsMissionCollapsed(v => !v)}
    />
  ) : null;

  const editorArea = missionPanel && isMissionCollapsed ? (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">{editorPanel}</div>
      <div className="h-10 shrink-0">{missionPanel}</div>
    </div>
  ) : missionPanel ? (
    <ResizablePanelGroup direction="vertical">
      <ResizablePanel defaultSize={58} minSize={25}>
        {editorPanel}
      </ResizablePanel>
      <ResizableHandle withHandle className="h-px bg-white/[0.06] hover:bg-white/20 transition-colors" />
      <ResizablePanel defaultSize={42} minSize={15}>
        {missionPanel}
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : editorPanel;

  return (
    <div className="h-screen flex flex-col bg-black text-foreground overflow-hidden">
      <TopBar
        projectId={currentProject?.id ?? null}
        isArduinoProject={currentProject?.target_compiler === 'arduino'}
        projectType={currentProject?.project_type ?? null}
        backHref={missionId ? '/dashboard/learn' : '/dashboard'}
        backLabel={missionId ? 'Missions' : 'Dashboard'}
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
        onFixWithAgent={handleFixWithAgent}
        isCompiling={isCompiling}
        isExplaining={isExplaining}
        compileLogs={compileLogs}
        compileErrors={compileErrors}
        explanation={explanation}
      />

      <SerialDialog
        open={isSerialModalOpen}
        onOpenChange={setIsSerialModalOpen}
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
                <ResizablePanel defaultSize={missionPanel ? 72 : 65} minSize={30}>
                  {editorArea}
                </ResizablePanel>

                <ResizableHandle withHandle className="h-px bg-white/[0.06] hover:bg-white/20 transition-colors" />

                {/* Sandbox Terminal - ROS Projects Only */}
                <ResizablePanel defaultSize={missionPanel ? 28 : 35} minSize={15}>
                  <TerminalTabsManager
                    workspaceId={activeWorkspaceId ?? undefined}
                    onWorkspaceCreate={handleWorkspaceCreate}
                    onSyncComplete={handleSyncComplete}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              editorArea
            )}
          </ResizablePanel>

          <ResizableHandle withHandle className="w-px bg-white/[0.06] hover:bg-white/20 transition-colors" />

          <ResizablePanel defaultSize={25} minSize={20} maxSize={45}>
            <AgentPanel
              messages={messages}
              mode={chatMode}
              onModeChange={setChatMode}
              busy={isChatLoading}
              input={chatInput}
              onInputChange={setChatInput}
              onSend={text => void handleSendMessage(text)}
              onStop={handleStopAgent}
              threads={threads}
              activeThreadId={activeThreadId}
              onNewThread={handleNewThread}
              onSelectThread={threadId => void handleSelectThread(threadId)}
              onDeleteThread={threadId => void handleDeleteThread(threadId)}
              onRenameThread={(threadId, title) => void handleRenameThread(threadId, title)}
              webSearch={enableWebsearch}
              onWebSearchChange={setEnableWebsearch}
              activeFileName={activeFile?.name ?? null}
              codeContexts={codeContexts}
              onRemoveContext={handleRemoveContext}
              onOpenFile={handleOpenChangedFile}
              onRevertChange={handleRevertChange}
              reverting={reverting}
              onRunStep={handleAcceptStep}
              onRunAllSteps={handleAcceptAllSteps}
              onDiscardStep={handleDiscardStep}
              quickPrompts={quickPrompts}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}


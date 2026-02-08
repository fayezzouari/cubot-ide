'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { compileService, chatService } from '@/lib/api';
import type { CompilerType } from '@/lib/api/types';
import { useProject } from '@/contexts/project-context';
import { mockMessages as initialMessages, type FileNode, type ChatMessage } from '@/lib/mock-data';
import TopBar from '@/components/ide/top-bar';
import FileTreeItem from '@/components/ide/file-tree-item';
import EditorPanel from '@/components/ide/editor-panel';
import ChatSidebar from '@/components/ide/chat-sidebar';
import CompileDialog from '@/components/ide/compile-dialog';
import SerialDialog from '@/components/ide/serial-dialog';
import CreateFileDialog from '@/components/ide/create-file-dialog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

export default function IDEPage() {
  const { currentProject, updateFile, deleteFile, loadProject, createFile, compileProject, isLoading, error } = useProject();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [editedContent, setEditedContent] = useState<string>('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
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
  const serialSocketRef = useRef<WebSocket | null>(null);
  const hasLoadedProjectRef = useRef(false);
  const [isCreateFileModalOpen, setIsCreateFileModalOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFilePath, setNewFilePath] = useState('');
  const [isRenamingFile, setIsRenamingFile] = useState(false);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [newFileNameInput, setNewFileNameInput] = useState('');

  // Convert project files to file tree structure
  const projectFileTree = useMemo((): FileNode[] => {
    if (!currentProject?.files || currentProject.files.length === 0) {
      return [];
    }
    
    // Group files by directory
    const tree: FileNode[] = [];
    const folders: Record<string, FileNode> = {};
    
    currentProject.files.forEach(file => {
      const pathParts = file.path.split('/');
      
      if (pathParts.length === 1) {
        // Root level file
        tree.push({
          id: file.id,
          name: file.name,
          type: 'file',
        });
      } else {
        // File in folder
        const folderName = pathParts[0];
        if (!folders[folderName]) {
          folders[folderName] = {
            id: `folder-${folderName}`,
            name: folderName,
            type: 'folder',
            children: [],
          };
          tree.push(folders[folderName]);
        }
        folders[folderName].children!.push({
          id: file.id,
          name: file.name,
          type: 'file',
        });
      }
    });
    
    return tree;
  }, [currentProject?.files]);

  // Use project files only
  const displayFileTree = useMemo(() => {
    if (currentProject?.files && currentProject.files.length > 0) {
      return projectFileTree;
    }
    return [];
  }, [currentProject?.files, projectFileTree]);

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !currentProject) return;
    
    setIsChatLoading(true);
    const userMessage = chatInput.trim();
    const newUserMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
    };
    
    setMessages([...messages, newUserMessage]);
    setChatInput('');
    
    // Add loading message
    const loadingMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '...',
    };
    setMessages((prev) => [...prev, loadingMessage]);
    
    try {
      // Prepare file context (current file if open)
      const fileContext = selectedFile && currentFileContent
        ? [{
            path: currentProject.files.find(f => f.id === selectedFile)?.path || '',
            content: editedContent || currentFileContent,
          }]
        : undefined;
      
      // Prepare conversation history
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));
      
      // Call chat API
      const response = await chatService.sendMessage(currentProject.id, {
        message: userMessage,
        file_context: fileContext,
        compiler: currentProject.target_compiler,
        conversation_history: conversationHistory,
      });
      
      // Remove loading message and add real response
      setMessages((prev) => {
        const withoutLoading = prev.filter(m => m.id !== loadingMessage.id);
        return [
          ...withoutLoading,
          {
            id: (Date.now() + 2).toString(),
            role: 'assistant',
            content: response.message,
          },
        ];
      });
      
      // If there are file operations, reload the project
      if (response.file_operations && response.file_operations.length > 0) {
        console.log('File operations performed:', response.file_operations);
        // Reload project to get updated files
        await loadProject(currentProject.id);
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

  const handleCreateNewFile = () => {
    setIsCreateFileModalOpen(true);
  };

  const handleCreateFileSubmit = async () => {
    if (!newFileName.trim() || !newFilePath.trim()) return;

    // Determine file type from extension
    const ext = newFileName.split('.').pop()?.toLowerCase() || '';
    const fileType = ext === 'c' ? 'c' : ext === 'cpp' ? 'cpp' : ext === 'h' ? 'h' : 'other';

    if (currentProject) {
      setIsCreatingFile(true);
      try {
        const newFile = await createFile(newFileName, newFilePath, '', fileType);
        console.log('File created in MongoDB:', newFile);
        // Select the new file
        setSelectedFile(newFile.id);
        setEditedContent('');
        setFileContents(prev => ({ ...prev, [newFile.id]: '' }));
        // Close modal and reset form
        setIsCreateFileModalOpen(false);
        setNewFileName('');
        setNewFilePath('');
      } catch (error) {
        console.error('Failed to create file:', error);
        alert('Failed to create file. Please try again.');
      } finally {
        setIsCreatingFile(false);
      }
    }
  };

  const handleRenameFile = (fileId: string) => {
    const file = currentProject?.files.find(f => f.id === fileId);
    if (file) {
      setRenamingFileId(fileId);
      setNewFileNameInput(file.name);
      setIsRenamingFile(true);
    }
  };

  const handleRenameFileSubmit = async () => {
    if (!renamingFileId || !newFileNameInput.trim()) return;

    try {
      await updateFile(renamingFileId, { name: newFileNameInput.trim() });
      setIsRenamingFile(false);
      setRenamingFileId(null);
      setNewFileNameInput('');
    } catch (error) {
      console.error('Failed to rename file:', error);
      alert('Failed to rename file. Please try again.');
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      await deleteFile(fileId);
      if (selectedFile === fileId) {
        setSelectedFile(null);
        setEditedContent('');
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      alert('Failed to delete file. Please try again.');
    }
  };

  const handleRenameFileCancel = () => {
    setIsRenamingFile(false);
    setRenamingFileId(null);
    setNewFileNameInput('');
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

    const mainFilePath =
      currentProject.files.find(f => f.id === selectedFile)?.path ||
      currentProject.files[0]?.path;

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
    if (currentProject?.files && currentProject.files.length > 0 && !isInitialized) {
      const contents: Record<string, string> = {};
      currentProject.files.forEach(file => {
        contents[file.id] = file.content;
      });
      setFileContents(contents);
      
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
    }
  }, [currentProject, isInitialized]);
  
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
    <div className="h-screen flex flex-col bg-background text-foreground relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.10),_transparent_45%)]" />
      <TopBar
        projectId={currentProject?.id ?? null}
        isArduinoProject={currentProject?.target_compiler === 'arduino'}
        onOpenCompile={handleOpenCompileModal}
        onOpenSerial={handleOpenSerialModal}
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

      <CreateFileDialog
        open={isCreateFileModalOpen}
        onOpenChange={setIsCreateFileModalOpen}
        newFileName={newFileName}
        newFilePath={newFilePath}
        onNewFileNameChange={setNewFileName}
        onNewFilePathChange={setNewFilePath}
        isCreatingFile={isCreatingFile}
        onCreate={handleCreateFileSubmit}
        onCancel={() => {
          setIsCreateFileModalOpen(false);
          setNewFileName('');
          setNewFilePath('');
        }}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        <ResizablePanelGroup direction="horizontal">
          {/* File Sidebar */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
            <aside className="w-full h-full border-r-4 border-foreground flex flex-col bg-background/80 backdrop-blur-sm">
              <div className="p-3 border-b-2 border-foreground flex items-center justify-between">
                <span className="font-black text-sm">
                  {currentProject ? 'PROJECT FILES' : 'EXPLORER'}
                </span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6"
                  onClick={handleCreateNewFile}
                  disabled={isCreatingFile}
                >
                  {isCreatingFile ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                </Button>
              </div>
              {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="animate-spin" size={24} />
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <div className="py-2">
                    {displayFileTree.length > 0 ? (
                      displayFileTree.map((node) => (
                        <FileTreeItem 
                          key={node.id} 
                          node={node}
                          selectedFile={selectedFile}
                          onSelectFile={handleFileSelect}
                          onRenameFile={handleRenameFile}
                          onDeleteFile={handleDeleteFile}
                        />
                      ))
                    ) : (
                      <div className="p-4 text-center text-muted-foreground text-sm font-bold">
                        Empty directory.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
              {isRenamingFile && (
                <div className="p-2 border-t border-border">
                  <div className="flex items-center gap-2">
                    <Input
                      value={newFileNameInput}
                      onChange={(e) => setNewFileNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleRenameFileSubmit();
                        } else if (e.key === 'Escape') {
                          handleRenameFileCancel();
                        }
                      }}
                      placeholder="New file name"
                      className="flex-1 h-8 text-sm"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={handleRenameFileSubmit}
                      className="h-8 px-2"
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRenameFileCancel}
                      className="h-8 px-2"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </aside>
          </ResizablePanel>

          <ResizableHandle withHandle className="w-1 bg-foreground hover:bg-primary transition-colors" />

          <ResizablePanel defaultSize={55} minSize={30}>
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
            />
          </ResizablePanel>

          <ResizableHandle withHandle className="w-1 bg-foreground hover:bg-primary transition-colors" />

          <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
            <ChatSidebar
              messages={messages}
              chatInput={chatInput}
              onChatInputChange={setChatInput}
              onSendMessage={handleSendMessage}
              isLoading={isChatLoading}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

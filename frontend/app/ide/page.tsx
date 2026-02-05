'use client';

import { useState, useEffect, useMemo } from 'react';
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
  Save,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import { compileService } from '@/lib/api';
import type { CompilerType } from '@/lib/api/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useProject } from '@/contexts/project-context';
import {
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
  const { currentProject, updateFile, loadProject, createFile, compileProject, isLoading, error } = useProject();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
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

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditedContent(e.target.value);
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
            await updateFile(file.id, editedContent);
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

  const handleCreateNewFile = async () => {
    const fileName = prompt('Enter file name (e.g., main.cpp):');
    if (!fileName) return;
    
    const filePath = prompt('Enter file path (e.g., src/main.cpp):', fileName);
    if (!filePath) return;
    
    // Determine file type from extension
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const fileType = ext === 'c' ? 'c' : ext === 'cpp' ? 'cpp' : ext === 'h' ? 'h' : 'other';
    
    if (currentProject) {
      setIsCreatingFile(true);
      try {
        const newFile = await createFile(fileName, filePath, '', fileType);
        console.log('File created in MongoDB:', newFile);
        // Select the new file
        setSelectedFile(newFile.id);
        setEditedContent('');
        setFileContents(prev => ({ ...prev, [newFile.id]: '' }));
      } catch (error) {
        console.error('Failed to create file:', error);
        alert('Failed to create file. Please try again.');
      } finally {
        setIsCreatingFile(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Tab key for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = target.value;

      if (e.shiftKey) {
        // Shift+Tab: Remove indentation
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const line = value.substring(lineStart, start);
        
        if (line.startsWith('  ')) {
          const newValue = value.substring(0, lineStart) + value.substring(lineStart + 2);
          setEditedContent(newValue);
          setHasUnsavedChanges(true);
          
          setTimeout(() => {
            target.selectionStart = start - 2;
            target.selectionEnd = end - 2;
          }, 0);
        }
      } else {
        // Tab: Add indentation (2 spaces)
        const newValue = value.substring(0, start) + '  ' + value.substring(end);
        setEditedContent(newValue);
        setHasUnsavedChanges(true);
        
        setTimeout(() => {
          target.selectionStart = start + 2;
          target.selectionEnd = start + 2;
        }, 0);
      }
    }
    
    // Ctrl+S or Cmd+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (hasUnsavedChanges) {
        handleSaveFile();
      }
    }
  };

  const handleOpenCompileModal = () => {
    setCompileLogs('');
    setCompileErrors([]);
    setExplanation('');
    setIsCompileModalOpen(true);
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
    ? currentProject?.files.find(f => f.id === selectedFile)?.name
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
      
      setIsInitialized(true);
      console.log('Loaded project files from MongoDB:', currentProject.files.length, 'files');
    }
  }, [currentProject, isInitialized]);

  // Update editedContent when selectedFile changes
  useEffect(() => {
    if (selectedFile && fileContents[selectedFile] !== undefined && !hasUnsavedChanges) {
      setEditedContent(fileContents[selectedFile]);
    }
  }, [selectedFile, fileContents, hasUnsavedChanges]);

  // Load project from URL or localStorage
  useEffect(() => {
    const initializeProject = async () => {
      if (isInitialized || isLoading) return;
      
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
  }, [isInitialized, isLoading, loadProject]);

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
          <Button
            variant="outline"
            size="sm"
            className="border-2 border-foreground font-black"
            onClick={handleOpenCompileModal}
          >
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

      <Dialog open={isCompileModalOpen} onOpenChange={setIsCompileModalOpen}>
        <DialogContent className="max-w-2xl border-4 border-foreground bg-background">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-foreground">
              COMPILE PROJECT
            </DialogTitle>
            <DialogDescription className="text-foreground/70 font-bold">
              Choose a compiler and view logs in real time
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black">COMPILER</label>
              <select
                value={selectedCompiler}
                onChange={(e) => setSelectedCompiler(e.target.value as CompilerType)}
                className="border-2 border-foreground px-3 py-2 font-bold bg-background"
                disabled={isCompiling}
              >
                <option value="arduino">Arduino</option>
                <option value="ti_arm">TI ARM</option>
                <option value="esp32">ESP32</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleCompile}
                className="px-4 py-2 bg-foreground text-background font-black text-sm hover:bg-muted hover:text-foreground transition-all"
                disabled={isCompiling}
              >
                {isCompiling ? (
                  <>
                    <Loader2 size={14} className="mr-2 animate-spin" />
                    COMPILING...
                  </>
                ) : (
                  'RUN COMPILE'
                )}
              </Button>
              <Button
                onClick={handleExplainLogs}
                className="px-4 py-2 bg-primary border-2 border-foreground text-primary-foreground font-black text-sm hover:bg-muted hover:text-black transition-all"
                disabled={isCompiling || isExplaining}
              >
                {isExplaining ? (
                  <>
                    <Loader2 size={14} className="mr-2 animate-spin" />
                    EXPLAINING...
                  </>
                ) : (
                  'EXPLAIN'
                )}
              </Button>
              <Button
                variant="outline"
                className="border-2 border-foreground font-black"
                onClick={() => setIsCompileModalOpen(false)}
                disabled={isCompiling}
              >
                CLOSE
              </Button>
            </div>

            <div className="border-2 border-foreground bg-muted p-3 min-h-[200px]">
              <ScrollArea className="h-48">
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {compileLogs || 'Logs will appear here...'}
                </pre>
              </ScrollArea>
            </div>

            {compileErrors.length > 0 && (
              <div className="border-2 border-red-600 bg-red-50 p-3">
                <p className="text-xs font-black text-red-700 mb-2">ERRORS</p>
                <ul className="text-xs font-mono text-red-700 list-disc pl-4 space-y-1">
                  {compileErrors.map((err, idx) => (
                    <li key={`${err}-${idx}`}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {explanation && (
              <div className="border-2 border-foreground bg-background p-3">
                <p className="text-xs font-black mb-2">AI EXPLANATION</p>
                <ScrollArea className="h-48">
                  <div className="prose prose-sm max-w-none text-foreground">
                    <ReactMarkdown>{explanation}</ReactMarkdown>
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Sidebar */}
        <aside className="w-64 border-r-4 border-foreground flex flex-col">
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
                    />
                  ))
                ) : (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    <p>No files yet.</p>
                    <p className="mt-1">Click + to create one.</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </aside>

        {/* Editor Area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          {currentFileName && (
            <div className="h-10 border-b-2 border-foreground flex items-center justify-between px-2">
              <div className="flex items-center gap-2 px-3 py-1 bg-muted border-2 border-foreground">
                <File size={12} />
                <span className="text-sm font-bold">
                  {currentFileName}
                  {hasUnsavedChanges && <span className="ml-1 text-amber-500">●</span>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {currentProject && (
                  <span className="text-xs text-muted-foreground font-bold">
                    {currentProject.name}
                  </span>
                )}
                <Button
                  onClick={handleSaveFile}
                  size="sm"
                  variant="outline"
                  className="border-2 border-foreground font-black h-7"
                  disabled={!hasUnsavedChanges || isSaving}
                >
                  <Save size={14} className="mr-1" />
                  {isSaving ? 'SAVING...' : 'SAVE'}
                </Button>
              </div>
            </div>
          )}
          
          {/* Code Editor / Logo Display */}
          <div className="flex-1 overflow-hidden">
            {currentFileContent ? (
              <textarea
                value={editedContent}
                onChange={handleContentChange}
                onKeyDown={handleKeyDown}
                className="w-full h-full p-4 font-mono text-sm bg-background text-foreground border-none outline-none resize-none"
                spellCheck={false}
                style={{
                  tabSize: 2,
                  lineHeight: '1.5',
                }}
                placeholder="Start typing..."
              />
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

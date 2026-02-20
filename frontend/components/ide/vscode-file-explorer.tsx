'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FilePlus,
  Loader2,
  ChevronsUpDown,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { FileNode } from '@/lib/mock-data';

// ─── File icon colour by extension ───────────────────────────────────────────
function getFileIconColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'c':
    case 'cpp':
    case 'cc':
    case 'ino':
      return 'text-blue-400';
    case 'h':
    case 'hpp':
      return 'text-purple-400';
    case 'json':
      return 'text-yellow-400';
    case 'md':
      return 'text-slate-300';
    case 'py':
      return 'text-emerald-400';
    case 'ts':
    case 'tsx':
      return 'text-sky-400';
    case 'js':
    case 'jsx':
      return 'text-yellow-300';
    default:
      return 'text-slate-500';
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface InlineEditState {
  type: 'rename' | 'create';
  nodeId?: string;      // only for rename
  parentPath?: string;  // only for create — '' = root
  value: string;
}

interface VscodeFileExplorerProps {
  nodes: FileNode[];
  selectedFile: string | null;
  onSelectFile: (id: string) => void;
  onRenameFile: (id: string, newName: string) => Promise<void>;
  onDeleteFile: (id: string) => void;
  onCreateFile: (folderPath: string, fileName: string) => Promise<void>;
  isLoading?: boolean;
  isSandboxLoading?: boolean;
  isImportingFile?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function VscodeFileExplorer({
  nodes,
  selectedFile,
  onSelectFile,
  onRenameFile,
  onDeleteFile,
  onCreateFile,
  isLoading,
  isSandboxLoading,
  isImportingFile,
}: VscodeFileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input whenever inline edit state changes
  useEffect(() => {
    if (inlineEdit) {
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [inlineEdit?.type, inlineEdit?.nodeId, inlineEdit?.parentPath]);

  const toggleFolder = useCallback((id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const startCreate = useCallback((parentPath = '') => {
    if (parentPath) {
      // Ensure parent folder is expanded so the inline input appears inside it
      const folderId = `folder-${parentPath}`;
      setExpandedFolders(prev => new Set([...prev, folderId]));
    }
    setInlineEdit({ type: 'create', parentPath, value: '' });
  }, []);

  const startRename = useCallback((node: FileNode) => {
    setInlineEdit({ type: 'rename', nodeId: node.id, value: node.name });
  }, []);

  const cancelEdit = useCallback(() => {
    if (!isSubmitting) setInlineEdit(null);
  }, [isSubmitting]);

  const submitEdit = useCallback(async () => {
    if (!inlineEdit || !inlineEdit.value.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (inlineEdit.type === 'rename' && inlineEdit.nodeId) {
        await onRenameFile(inlineEdit.nodeId, inlineEdit.value.trim());
      } else if (inlineEdit.type === 'create') {
        await onCreateFile(inlineEdit.parentPath ?? '', inlineEdit.value.trim());
      }
      setInlineEdit(null);
    } catch {
      // keep edit open on error
    } finally {
      setIsSubmitting(false);
    }
  }, [inlineEdit, isSubmitting, onRenameFile, onCreateFile]);

  // Inline input — rendered as plain JSX (not a sub-component) to avoid remounting
  const renderInlineInput = (depth: number) => (
    <div
      className="flex items-center gap-1.5 pr-2"
      style={{ paddingLeft: `${depth * 12 + 8 + 20}px`, paddingTop: 2, paddingBottom: 2 }}
    >
      <File size={14} className="shrink-0 text-slate-400" />
      <input
        ref={inputRef}
        className="flex-1 min-w-0 text-[13px] font-mono px-1 py-px bg-[#3c3c3c] text-[#d4d4d4] rounded-none focus:outline-none"
        style={{ boxShadow: '0 0 0 1px #007fd4' }}
        value={inlineEdit?.value ?? ''}
        spellCheck={false}
        onChange={e =>
          setInlineEdit(prev => (prev ? { ...prev, value: e.target.value } : null))
        }
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submitEdit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
        }}
        onBlur={() => setTimeout(cancelEdit, 120)}
      />
    </div>
  );

  // Recursive tree renderer — plain function, not a React component
  const renderNode = (node: FileNode, depth: number): React.ReactNode => {
    const isFolder = node.type === 'folder';
    const isSelected = selectedFile === node.id;
    const isExpanded = expandedFolders.has(node.id);
    const isSandbox = (node.source ?? 'ide') === 'sandbox';
    const isRenaming = inlineEdit?.type === 'rename' && inlineEdit.nodeId === node.id;

    // folderPath for create/delete operations (strips "folder-" prefix)
    const folderPath = isFolder ? node.id.replace(/^folder-/, '') : undefined;

    // Should we render a create-input as the first child of this folder?
    const showCreateInsideFolder =
      inlineEdit?.type === 'create' &&
      isFolder &&
      isExpanded &&
      inlineEdit.parentPath === folderPath;

    return (
      <div key={node.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              className={[
                'group relative w-full flex items-center gap-1.5 text-left text-[13px] pr-2',
                'transition-colors duration-75 cursor-pointer select-none',
                isSelected
                  ? 'bg-white/[0.08] text-[#d4d4d4]'
                  : 'text-[#cccccc] hover:bg-white/[0.05]',
                isSandbox ? 'opacity-75' : '',
              ].join(' ')}
              style={{
                paddingLeft: `${depth * 12 + 8}px`,
                paddingTop: 2,
                paddingBottom: 2,
              }}
              onClick={() => {
                if (isFolder) {
                  toggleFolder(node.id);
                } else {
                  onSelectFile(node.id);
                }
              }}
            >
              {/* Active-file left border */}
              {isSelected && (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#007fd4]" />
              )}

              {/* Expand chevron / spacer */}
              {isFolder ? (
                <ChevronRight
                  size={15}
                  className={[
                    'shrink-0 text-[#858585] transition-transform duration-100',
                    isExpanded ? 'rotate-90' : '',
                  ].join(' ')}
                />
              ) : (
                <span className="w-[15px] shrink-0" />
              )}

              {/* Folder / file icon */}
              {isFolder ? (
                isExpanded ? (
                  <FolderOpen
                    size={15}
                    className={`shrink-0 ${isSandbox ? 'text-amber-400' : 'text-[#dcb67a]'}`}
                  />
                ) : (
                  <Folder
                    size={15}
                    className={`shrink-0 ${isSandbox ? 'text-amber-400/70' : 'text-[#dcb67a]'}`}
                  />
                )
              ) : (
                <File
                  size={14}
                  className={`shrink-0 ${isSandbox ? 'text-amber-300/60' : getFileIconColor(node.name)}`}
                />
              )}

              {/* Label or inline rename input */}
              {isRenaming ? (
                <input
                  ref={inputRef}
                  className="flex-1 min-w-0 text-[13px] font-mono px-1 py-px bg-[#3c3c3c] text-[#d4d4d4] rounded-none focus:outline-none"
                  style={{ boxShadow: '0 0 0 1px #007fd4' }}
                  value={inlineEdit?.value ?? ''}
                  spellCheck={false}
                  onChange={e =>
                    setInlineEdit(prev =>
                      prev ? { ...prev, value: e.target.value } : null
                    )
                  }
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.stopPropagation(); submitEdit(); }
                    if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); }
                  }}
                  onBlur={() => setTimeout(cancelEdit, 120)}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="truncate">{node.name}</span>
              )}

              {/* Per-folder hover action: New File */}
              {isFolder && !isSandbox && !isRenaming && (
                <span
                  className="ml-auto shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 text-[#858585] hover:text-[#cccccc]"
                  title="New File"
                  onMouseDown={e => e.preventDefault()} // prevent blur on tree
                  onClick={e => {
                    e.stopPropagation();
                    if (!isExpanded) toggleFolder(node.id);
                    startCreate(folderPath);
                  }}
                >
                  <FilePlus size={13} />
                </span>
              )}
            </button>
          </ContextMenuTrigger>

          {/* Context menu — only for IDE-managed nodes */}
          {!isSandbox && (
            <ContextMenuContent className="w-44 bg-[#1e1e1e] border border-[#454545] text-[#cccccc] text-[13px] p-0.5 rounded-none shadow-xl">
              {!isFolder && (
                <ContextMenuItem
                  className="px-3 py-1 cursor-pointer rounded-none hover:bg-[#37373d] focus:bg-[#37373d]"
                  onClick={() => startRename(node)}
                >
                  Rename
                </ContextMenuItem>
              )}
              {isFolder && (
                <ContextMenuItem
                  className="px-3 py-1 cursor-pointer rounded-none hover:bg-[#37373d] focus:bg-[#37373d]"
                  onClick={() => {
                    if (!isExpanded) toggleFolder(node.id);
                    startCreate(folderPath);
                  }}
                >
                  New File
                </ContextMenuItem>
              )}
              <ContextMenuSeparator className="my-0.5 bg-[#454545]" />
              <ContextMenuItem
                className="px-3 py-1 cursor-pointer rounded-none hover:bg-[#37373d] focus:bg-[#37373d] text-red-400 focus:text-red-400"
                onClick={() => {
                  if (isFolder) {
                    if (window.confirm(`Delete folder "${node.name}" and all its contents? This cannot be undone.`)) {
                      onDeleteFile(node.id);
                    }
                  } else {
                    onDeleteFile(node.id);
                  }
                }}
              >
                {isFolder ? 'Delete Folder' : 'Delete'}
              </ContextMenuItem>
            </ContextMenuContent>
          )}
        </ContextMenu>

        {/* Children — shown when folder is expanded */}
        {isFolder && isExpanded && (
          <div className="relative">
            {/* Indentation guide line */}
            <span
              className="absolute top-0 bottom-0 w-px bg-white/[0.06] hover:bg-white/[0.14] transition-colors pointer-events-none"
              style={{ left: `${depth * 12 + 16}px` }}
            />

            {/* Inline create input inside folder */}
            {showCreateInsideFolder && renderInlineInput(depth + 1)}

            {node.children?.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <aside className="w-full h-full border-r border-white/[0.06] flex flex-col bg-black">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 border-b border-white/[0.06] shrink-0"
        style={{ height: 35 }}
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
      >
        <span className="text-[11px] uppercase tracking-[0.12em] text-white/25 font-mono font-medium select-none">
          Explorer
        </span>

        {/* Header action buttons — fade in on hover */}
        <div
          className={[
            'flex items-center gap-0.5 transition-opacity duration-150',
            headerHovered ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        >
          <button
            className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white/90 transition-colors cursor-pointer"
            title="New File"
            onMouseDown={e => e.preventDefault()}
            onClick={() => startCreate('')}
          >
            <FilePlus size={14} />
          </button>
          <button
            className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white/90 transition-colors cursor-pointer"
            title="Collapse All"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setExpandedFolders(new Set())}
          >
            <ChevronsUpDown size={14} />
          </button>
        </div>
      </div>

      {/* Tree body */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-white/30" size={18} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-0.5 [&::-webkit-scrollbar]:w-[6px] [&::-webkit-scrollbar-track]:transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/20">
          {isSandboxLoading ? (
            <div className="px-4 py-3 flex items-center gap-2 text-white/30 text-[12px] font-mono">
              <Loader2 size={11} className="animate-spin" />
              Syncing…
            </div>
          ) : (
            <>
              {/* Root-level inline create input */}
              {inlineEdit?.type === 'create' && inlineEdit.parentPath === '' && renderInlineInput(0)}

              {nodes.length === 0 ? (
                <div className="px-4 py-8 text-center text-white/20 text-[12px] font-mono">
                  No files
                </div>
              ) : (
                nodes.map(node => renderNode(node, 0))
              )}
            </>
          )}

          {/* Importing indicator */}
          {isImportingFile && (
            <div className="px-4 py-1 flex items-center gap-2 text-amber-500/60 text-[11px] font-mono">
              <Loader2 size={10} className="animate-spin" />
              Importing…
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

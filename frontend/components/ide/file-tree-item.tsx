'use client';

import { useState } from 'react';
import FolderActionButton from './folder-action-button';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { FileNode } from '@/lib/mock-data';

interface FileTreeItemProps {
  node: FileNode;
  depth?: number;
  selectedFile: string | null;
  onSelectFile: (id: string) => void;
  onRenameFile: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onCreateFile?: (folderPath: string) => void;
  source?: 'ide' | 'sandbox';
}

export default function FileTreeItem({
  node,
  depth = 0,
  selectedFile,
  onSelectFile,
  onRenameFile,
  onDeleteFile,
  onCreateFile,
  source = 'ide',
}: FileTreeItemProps) {
  // Folders start collapsed by default
  const [isOpen, setIsOpen] = useState(false);
  const isFolder = node.type === 'folder';
  const isSelected = selectedFile === node.id;
  const isSandbox = (node.source ?? source) === 'sandbox';

  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            className={`w-full flex items-center gap-2 px-2 py-1 text-left text-sm font-bold hover:bg-muted transition-colors cursor-pointer hover:bg-white/10 ${
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
                {isOpen ? (
                  <FolderOpen size={14} className={isSandbox ? 'text-amber-500/70' : ''} />
                ) : (
                  <Folder size={14} className={isSandbox ? 'text-amber-500/70' : ''} />
                )}
                <span className={`truncate ${isSandbox ? 'text-amber-100/70' : ''}`}>
                  {node.name}
                </span>
                {/* Add + button for creating files in this folder, visible only on hover */}
                {onCreateFile && hovered && (
                  <span className="ml-auto">
                    <FolderActionButton
                      onCreateFile={onCreateFile}
                      folderPath={node.id.replace(/^(sandbox-folder:|folder-)/, '')}
                    />
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="w-3.5" />
                <File size={14} className={isSandbox ? 'text-amber-500/60' : ''} />
                <span className={`truncate ${isSandbox ? 'text-amber-100/70' : ''}`}>
                  {node.name}
                </span>
              </>
            )}

          </button>
        </ContextMenuTrigger>
        {/* Only show context menu for IDE-managed files */}
        {!isFolder && !isSandbox && (
          <ContextMenuContent>
            <ContextMenuItem onClick={() => onRenameFile(node.id)}>
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => onDeleteFile(node.id)}
              className="text-destructive"
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
      {isFolder && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onRenameFile={onRenameFile}
              onDeleteFile={onDeleteFile}
              onCreateFile={onCreateFile}
              source={source}
            />
          ))}
        </div>
      )}
    </div>
  );
}

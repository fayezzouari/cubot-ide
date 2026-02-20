'use client';

import { useState } from 'react';
import FolderActionButton from './folder-action-button';
import { Minus } from 'lucide-react';
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

  // Only show + button for the hovered folder row, not parent
  const [rowHovered, setRowHovered] = useState(false);
  return (
    <div>
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
            onMouseEnter={() => setRowHovered(true)}
            onMouseLeave={() => setRowHovered(false)}
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
                {/* Add + and − buttons for creating and deleting folders, visible only on hover (IDE folders only) */}
                {rowHovered && (
                  <span className="ml-auto flex items-center gap-1">
                    {onCreateFile && (
                      <FolderActionButton
                        onCreateFile={onCreateFile}
                        folderPath={node.id.replace(/^(sandbox-folder:|folder-)/, '')}
                      />
                    )}
                    {/* Show dash for IDE folders only */}
                    { isFolder && (
                      <button
                        className="ml-1 p-0.5 rounded hover:bg-destructive/20 text-destructive cursor-pointer"
                        title="Delete folder"
                        onClick={e => {
                          e.stopPropagation();
                          if (window.confirm(`Delete folder \"${node.name}\" and all its contents? This cannot be undone.`)) {
                            onDeleteFile(node.id);
                          }
                        }}
                      >
                        <Minus size={14} />
                      </button>
                    )}

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
        {/* Context menu for IDE-managed files and folders */}
        {!isSandbox && (
          <ContextMenuContent>
            {!isFolder && (
              <ContextMenuItem onClick={() => onRenameFile(node.id)}>
                Rename
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onClick={() => onDeleteFile(node.id)}
              className="text-destructive"
            >
              Delete{isFolder ? ' Folder' : ''}
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

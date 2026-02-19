import { Plus } from 'lucide-react';
import React, { useState } from 'react';
import type { FileNode } from '@/lib/mock-data';

interface FolderActionButtonProps {
  onCreateFile: (folderPath: string) => void;
  folderPath: string;
}

export default function FolderActionButton({ onCreateFile, folderPath }: FolderActionButtonProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      className={`ml-1 p-0.5 rounded hover:bg-sidebar-accent transition-colors cursor-pointer ${hovered ? 'bg-sidebar-accent' : ''}`}
      title="Create file in this folder"
      onClick={e => {
        e.stopPropagation();
        onCreateFile(folderPath);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={-1}
      type="button"
    >
      <Plus size={13} />
    </button>
  );
}

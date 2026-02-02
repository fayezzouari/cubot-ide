'use client';

import { Code2, Blocks, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface WorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function WorkspaceModal({ open, onOpenChange }: WorkspaceModalProps) {
  const router = useRouter();

  const handleSelectWorkspace = (type: 'ide' | 'blocks') => {
    onOpenChange(false);
    if (type === 'ide') {
      router.push('/ide');
    } else {
      router.push('/blocks');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-4 border-foreground bg-background p-0 gap-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-2xl font-black text-foreground">
            CHOOSE YOUR WORKSPACE
          </DialogTitle>
          <DialogDescription className="text-foreground/70 font-bold">
            Select how you want to build your embedded project
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
          {/* IDE Option */}
          <button
            onClick={() => handleSelectWorkspace('ide')}
            className="group border-4 border-foreground p-6 text-left hover:bg-foreground hover:text-background transition-all"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 border-2 border-current flex items-center justify-center">
                <Code2 size={24} />
              </div>
              <h3 className="font-black text-lg">CODE IDE</h3>
            </div>
            <p className="text-sm font-bold mb-6 opacity-80">
              Write C/C++ code with AI assistance. Full-featured code editor with syntax highlighting, autocomplete, and integrated chat.
            </p>
            <div className="flex items-center gap-2 font-black text-sm">
              <span>OPEN IDE</span>
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Block Workspace Option */}
          <button
            onClick={() => handleSelectWorkspace('blocks')}
            className="group border-4 border-foreground p-6 text-left hover:bg-foreground hover:text-background transition-all"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 border-2 border-current flex items-center justify-center">
                <Blocks size={24} />
              </div>
              <h3 className="font-black text-lg">BLOCK WORKSPACE</h3>
            </div>
            <p className="text-sm font-bold mb-6 opacity-80">
              Visual no-code programming with drag-and-drop blocks. Perfect for beginners learning embedded concepts.
            </p>
            <div className="flex items-center gap-2 font-black text-sm">
              <span>OPEN BLOCKS</span>
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

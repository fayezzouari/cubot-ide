'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface CreateFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newFileName: string;
  newFilePath: string;
  onNewFileNameChange: (value: string) => void;
  onNewFilePathChange: (value: string) => void;
  isCreatingFile: boolean;
  onCreate: () => void;
  onCancel: () => void;
}

export default function CreateFileDialog({
  open,
  onOpenChange,
  newFileName,
  newFilePath,
  onNewFileNameChange,
  onNewFilePathChange,
  isCreatingFile,
  onCreate,
  onCancel,
}: CreateFileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-black">CREATE NEW FILE</DialogTitle>
          <DialogDescription>Add a new file to your project.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-black text-foreground mb-2 block">FILE NAME</label>
            <Input
              value={newFileName}
              onChange={(e) => onNewFileNameChange(e.target.value)}
              placeholder="e.g., main.cpp"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-black text-foreground mb-2 block">FILE PATH</label>
            <Input
              value={newFilePath}
              onChange={(e) => onNewFilePathChange(e.target.value)}
              placeholder="e.g., src/main.cpp"
              className="font-mono text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button
            variant="outline"
            onClick={onCancel}
            className="border-2 border-foreground font-black"
          >
            CANCEL
          </Button>
          <Button
            onClick={onCreate}
            disabled={isCreatingFile || !newFileName.trim() || !newFilePath.trim()}
            className="px-6 py-2 bg-primary border-2 border-foreground text-primary-foreground font-black hover:bg-muted hover:text-black transition-all"
          >
            {isCreatingFile ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" />
                CREATING...
              </>
            ) : (
              'CREATE FILE'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

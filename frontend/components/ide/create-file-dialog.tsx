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
      <DialogContent className="sm:max-w-md border border-border">
        <DialogHeader>
          <DialogTitle className="font-semibold text-xl">Create New File</DialogTitle>
          <DialogDescription className="text-muted-foreground">Add a new file to your project.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">File name</label>
            <Input
              value={newFileName}
              onChange={(e) => onNewFileNameChange(e.target.value)}
              placeholder="e.g., main.cpp"
              className="font-mono text-sm border border-input"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">File path</label>
            <Input
              value={newFilePath}
              onChange={(e) => onNewFilePathChange(e.target.value)}
              placeholder="e.g., src/main.cpp"
              className="font-mono text-sm border border-input"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            onClick={onCreate}
            disabled={isCreatingFile || !newFileName.trim() || !newFilePath.trim()}
          >
            {isCreatingFile ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create File'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

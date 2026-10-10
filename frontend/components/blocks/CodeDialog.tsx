'use client';

import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BLOCKS_THEME } from './theme';
import { Button } from '@/components/ui/button';

export interface CodeFile {
  id: string;
  label: string;
  filename: string;
  description: string;
  content: string;
}

export function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CodeDialog({
  open,
  onOpenChange,
  files,
  blocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: CodeFile[];
  blocked: string | null;
}) {
  const [active, setActive] = useState(files[0]?.id);
  const file = files.find((f) => f.id === active) ?? files[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-5xl flex-col overflow-hidden border-white/10 bg-[#0c0c0d] p-0 text-white" style={BLOCKS_THEME}>
        <DialogHeader className="border-b border-white/[0.08] px-6 pb-3 pt-5">
          <DialogTitle>Export program</DialogTitle>
          <DialogDescription className="text-white/50">
            Take the program off the simulator: run it from a PC with Python, flash the controller firmware onto an
            Arduino-based arm, or share the project file.
          </DialogDescription>
          <div className="flex gap-1 pt-3">
            {files.map((f) => (
              <button
                key={f.id}
                onClick={() => setActive(f.id)}
                className={`rounded-md px-3 py-1.5 text-xs ${file?.id === f.id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </DialogHeader>
        {file && (
          <>
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-6 py-2">
              <span className="text-[11px] text-white/45">{file.description}</span>
              <div className="ml-auto flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => navigator.clipboard.writeText(file.content).then(() => toast.success('Copied'))}
                >
                  <Copy size={12} /> Copy
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={() => downloadText(file.filename, file.content)}>
                  <Download size={12} /> {file.filename}
                </Button>
              </div>
            </div>
            {blocked && file.id === 'python' ? (
              <div className="p-6 text-sm text-red-300">{blocked}</div>
            ) : (
              <pre className="min-h-0 flex-1 overflow-auto px-6 py-4 font-mono text-[11.5px] leading-relaxed text-white/80">
                {file.content}
              </pre>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { Loader2, Usb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const COMMON_FQBNS = [
  { label: 'Arduino Uno', value: 'arduino:avr:uno' },
  { label: 'Arduino Nano', value: 'arduino:avr:nano' },
  { label: 'Arduino Mega 2560', value: 'arduino:avr:mega' },
  { label: 'Arduino Leonardo', value: 'arduino:avr:leonardo' },
  { label: 'Arduino Pro Mini (3.3V)', value: 'arduino:avr:pro' },
];

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  port: string;
  onPortChange: (value: string) => void;
  fqbn: string;
  onFqbnChange: (value: string) => void;
  isUploading: boolean;
  uploadSuccess: boolean | null;
  uploadLogs: string;
  uploadErrors: string[];
  onUpload: () => void;
}

export default function UploadDialog({
  open,
  onOpenChange,
  port,
  onPortChange,
  fqbn,
  onFqbnChange,
  isUploading,
  uploadSuccess,
  uploadLogs,
  uploadErrors,
  onUpload,
}: UploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-4 border-foreground bg-background">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black text-foreground flex items-center gap-2">
            <Usb size={20} />
            CONNECT &amp; UPLOAD
          </DialogTitle>
          <DialogDescription className="text-foreground/70 font-bold">
            Compile and flash your code to the connected Arduino board
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Port + Board */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black">PORT</label>
              <Input
                value={port}
                onChange={(e) => onPortChange(e.target.value)}
                className="border-2 border-foreground font-bold"
                placeholder="/dev/ttyACM0"
                disabled={isUploading}
              />
              <p className="text-xs text-foreground/40">
                Linux: /dev/ttyACM0 · macOS: /dev/cu.usbmodem…
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black">BOARD (FQBN)</label>
              <select
                value={fqbn}
                onChange={(e) => onFqbnChange(e.target.value)}
                className="border-2 border-foreground px-3 py-2 font-bold bg-background text-foreground"
                disabled={isUploading}
              >
                {COMMON_FQBNS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              onClick={onUpload}
              className="px-4 py-2 bg-foreground text-background font-black text-sm hover:bg-muted hover:text-foreground transition-all"
              disabled={isUploading || !port.trim()}
            >
              {isUploading ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  UPLOADING…
                </>
              ) : (
                <>
                  <Usb size={14} className="mr-2" />
                  CONNECT &amp; UPLOAD
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="border-2 border-foreground font-black"
              onClick={() => onOpenChange(false)}
              disabled={isUploading}
            >
              CLOSE
            </Button>
            {uploadSuccess !== null && !isUploading && (
              <span
                className={`text-sm font-black ${
                  uploadSuccess ? 'text-green-500' : 'text-destructive'
                }`}
              >
                {uploadSuccess ? '✓ UPLOADED SUCCESSFULLY' : '✗ UPLOAD FAILED'}
              </span>
            )}
          </div>

          {/* Logs */}
          <div className="border-2 border-foreground bg-muted p-3 min-h-[200px]">
            <ScrollArea className="h-48">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {uploadLogs || 'Output will appear here after upload…'}
              </pre>
            </ScrollArea>
          </div>

          {/* Errors */}
          {uploadErrors.length > 0 && (
            <div className="border-2 border-red-600 bg-red-50 p-3">
              <p className="text-xs font-black text-red-700 mb-2">ERRORS</p>
              <ul className="text-xs font-mono text-red-700 list-disc pl-4 space-y-1">
                {uploadErrors.map((err, idx) => (
                  <li key={`${err}-${idx}`}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

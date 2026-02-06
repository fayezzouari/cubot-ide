'use client';

import ReactMarkdown from 'react-markdown';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { CompilerType } from '@/lib/api/types';

interface CompileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCompiler: CompilerType;
  onSelectCompiler: (compiler: CompilerType) => void;
  onCompile: () => void;
  onExplainLogs: () => void;
  isCompiling: boolean;
  isExplaining: boolean;
  compileLogs: string;
  compileErrors: string[];
  explanation: string;
}

export default function CompileDialog({
  open,
  onOpenChange,
  selectedCompiler,
  onSelectCompiler,
  onCompile,
  onExplainLogs,
  isCompiling,
  isExplaining,
  compileLogs,
  compileErrors,
  explanation,
}: CompileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onChange={(e) => onSelectCompiler(e.target.value as CompilerType)}
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
              onClick={onCompile}
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
              onClick={onExplainLogs}
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
              onClick={() => onOpenChange(false)}
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
  );
}

'use client';

import ReactMarkdown from 'react-markdown';
import { Loader2, Play, Sparkles, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
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

const COMPILERS = [
  { value: 'arduino', label: 'Arduino' },
  { value: 'ti_arm',  label: 'TI ARM'  },
  { value: 'esp32',   label: 'ESP32'   },
];

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
  const hasLogs   = compileLogs.trim().length > 0;
  const hasErrors = compileErrors.length > 0;
  const isSuccess = hasLogs && !hasErrors && !isCompiling;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[#0e0e0e] border border-white/[0.08] rounded-xl p-0 gap-0 shadow-2xl overflow-hidden">

        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <Play size={13} className="text-white/70" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-white leading-none">
                Compile Project
              </DialogTitle>
              <DialogDescription className="text-xs text-white/40 mt-0.5">
                Build your project and inspect the output
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">

          {/* Compiler selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Compiler</label>
            <select
              value={selectedCompiler}
              onChange={e => onSelectCompiler(e.target.value as CompilerType)}
              disabled={isCompiling}
              className="w-full bg-[#161616] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 font-medium appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:border-blue-500/50 transition-colors"
            >
              {COMPILERS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Log terminal */}
          <div className="bg-black border border-white/[0.06] rounded-lg overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.04]">
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="ml-1 text-[11px] text-white/20 font-mono">output</span>
              {isSuccess && (
                <div className="ml-auto flex items-center gap-1 text-green-400 text-[11px] font-medium">
                  <CheckCircle2 size={11} />
                  Build passed
                </div>
              )}
              {hasErrors && !isCompiling && (
                <div className="ml-auto flex items-center gap-1 text-red-400 text-[11px] font-medium">
                  <XCircle size={11} />
                  Build failed
                </div>
              )}
            </div>
            <ScrollArea className="h-48">
              <pre className="px-3 py-2.5 text-[11px] font-mono leading-relaxed text-white/50 whitespace-pre-wrap">
                {compileLogs || <span className="text-white/20">Logs will appear here…</span>}
              </pre>
            </ScrollArea>
          </div>

          {/* Errors */}
          {hasErrors && (
            <div className="bg-red-950/20 border border-red-500/20 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
                <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">Errors</span>
              </div>
              <ul className="space-y-1 pl-1">
                {compileErrors.map((err, idx) => (
                  <li key={`${err}-${idx}`} className="text-[11px] font-mono text-red-300/80 leading-relaxed">{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* AI explanation */}
          {explanation && (
            <div className="bg-blue-950/10 border border-blue-500/15 rounded-lg overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-blue-500/10">
                <Sparkles size={11} className="text-blue-400" />
                <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider">AI Explanation</span>
              </div>
              <ScrollArea className="h-40">
                <div className="px-3 py-2.5 prose prose-sm prose-invert max-w-none text-white/60 text-xs leading-relaxed">
                  <ReactMarkdown>{explanation}</ReactMarkdown>
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onCompile}
              disabled={isCompiling}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-white/90 disabled:bg-white/20 text-black disabled:text-white/30 font-medium text-xs rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              {isCompiling ? (
                <><Loader2 size={12} className="animate-spin" />Compiling…</>
              ) : (
                <><Play size={12} />Compile</>
              )}
            </button>
            <button
              onClick={onExplainLogs}
              disabled={isCompiling || isExplaining || !hasLogs}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-30 border border-blue-500/20 hover:border-blue-500/30 text-blue-400 font-medium text-xs rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              {isExplaining ? (
                <><Loader2 size={12} className="animate-spin" />Explaining…</>
              ) : (
                <><Sparkles size={12} />Explain</>
              )}
            </button>
            <button
              onClick={() => onOpenChange(false)}
              disabled={isCompiling}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-30 text-white/50 hover:text-white font-medium text-xs rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              Close
            </button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

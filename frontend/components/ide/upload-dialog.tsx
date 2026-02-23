'use client';

import { useState } from 'react';
import { Loader2, Usb, Zap, ChevronRight, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { requestSerialPort, openPort, flashHex } from '@/lib/stk500';

const BOARDS = [
  { label: 'Arduino Uno',      value: 'arduino:avr:uno' },
  { label: 'Arduino Nano',     value: 'arduino:avr:nano' },
  { label: 'Arduino Pro Mini', value: 'arduino:avr:pro' },
];

const BAUD_RATES = [115200, 57600, 38400, 19200, 9600];

type Phase = 'idle' | 'compiling' | 'flashing' | 'done' | 'error';

const STEPS: { id: Phase; label: string }[] = [
  { id: 'compiling', label: 'Compile' },
  { id: 'flashing',  label: 'Flash'   },
  { id: 'done',      label: 'Done'    },
];

export interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompile: (fqbn: string) => Promise<{ hexOutput: string; logs: string; errors: string[] }>;
}

export default function UploadDialog({ open, onOpenChange, onCompile }: UploadDialogProps) {
  const [fqbn, setFqbn] = useState('arduino:avr:uno');
  const [baud, setBaud] = useState(115200);
  const [phase, setPhase] = useState<Phase>('idle');
  const [logs, setLogs] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const busy = phase === 'compiling' || phase === 'flashing';

  const appendLog = (msg: string) => setLogs(prev => prev + msg + '\n');

  const handleFlash = async () => {
    setLogs('');
    setErrors([]);
    setPhase('idle');

    let port: unknown;
    try {
      port = await requestSerialPort();
    } catch (err: any) {
      setErrors([err?.message ?? 'Port selection cancelled']);
      setPhase('error');
      return;
    }

    setPhase('compiling');
    appendLog('Compiling…');
    let hexOutput: string;
    try {
      const result = await onCompile(fqbn);
      appendLog(result.logs);
      if (result.errors.length > 0) {
        setErrors(result.errors);
        setPhase('error');
        return;
      }
      if (!result.hexOutput) {
        setErrors(['Compilation succeeded but no hex output was returned.']);
        setPhase('error');
        return;
      }
      hexOutput = result.hexOutput;
    } catch (err: any) {
      setErrors([err?.message ?? 'Compilation failed']);
      setPhase('error');
      return;
    }

    setPhase('flashing');
    try {
      await openPort(port, baud);
    } catch (err: any) {
      setErrors([err?.message ?? 'Failed to open port']);
      setPhase('error');
      return;
    }

    try {
      await flashHex(hexOutput, port, appendLog);
      setPhase('done');
    } catch (err: any) {
      setErrors([err?.message ?? 'Flash failed']);
      setPhase('error');
    }
  };

  const webSerialSupported = typeof window !== 'undefined' && 'serial' in navigator;

  const stepIndex = (p: Phase) => {
    if (p === 'idle')      return -1;
    if (p === 'compiling') return 0;
    if (p === 'flashing')  return 1;
    if (p === 'done')      return 2;
    return -1; // error — keep last active step highlighted
  };
  const currentStep = stepIndex(phase);

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-lg bg-[#0e0e0e] border border-white/[0.08] rounded-xl p-0 gap-0 shadow-2xl overflow-hidden">

        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Usb size={15} className="text-blue-400" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-white leading-none">
                Flash Firmware
              </DialogTitle>
              <DialogDescription className="text-xs text-white/40 mt-0.5">
                Compile and upload directly from the browser
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">

          {/* Board + Baud selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Board</label>
              <select
                value={fqbn}
                onChange={e => setFqbn(e.target.value)}
                disabled={busy}
                className="w-full bg-[#161616] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 font-medium appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:border-blue-500/50 transition-colors"
              >
                {BOARDS.map(b => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Baud rate</label>
              <select
                value={baud}
                onChange={e => setBaud(Number(e.target.value))}
                disabled={busy}
                className="w-full bg-[#161616] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 font-medium appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:border-blue-500/50 transition-colors"
              >
                {BAUD_RATES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Step progress */}
          {phase !== 'idle' && (
            <div className="flex items-center gap-1.5">
              {STEPS.map((step, i) => {
                const isActive  = phase !== 'error' ? currentStep === i : false;
                const isDone    = phase !== 'error' ? currentStep > i  : false;
                const isError   = phase === 'error' && i === Math.max(currentStep, 0);
                return (
                  <div key={step.id} className="flex items-center gap-1.5">
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      isError  ? 'bg-red-500/10  text-red-400'   :
                      isDone   ? 'bg-green-500/10 text-green-400' :
                      isActive ? 'bg-blue-500/10  text-blue-400'  :
                                 'text-white/20'
                    }`}>
                      {isError  ? <XCircle     size={11} /> :
                       isDone   ? <CheckCircle2 size={11} /> :
                       isActive ? <Loader2      size={11} className="animate-spin" /> :
                                  <span className="w-[11px] h-[11px] rounded-full border border-current opacity-40" />}
                      {step.label}
                    </div>
                    {i < STEPS.length - 1 && (
                      <ChevronRight size={11} className="text-white/[0.12]" />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Log terminal */}
          <div className="bg-black border border-white/[0.06] rounded-lg overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.04]">
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="ml-1 text-[11px] text-white/20 font-mono">output</span>
            </div>
            <ScrollArea className="h-36">
              <pre className="px-3 py-2.5 text-[11px] font-mono leading-relaxed text-white/50 whitespace-pre-wrap">
                {logs || <span className="text-white/20">Output will appear here…</span>}
              </pre>
            </ScrollArea>
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-red-950/20 border border-red-500/20 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
                <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">Error</span>
              </div>
              <ul className="space-y-1 pl-1">
                {errors.map((err, i) => (
                  <li key={i} className="text-[11px] font-mono text-red-300/80 leading-relaxed">{err}</li>
                ))}
              </ul>
            </div>
          )}

          {!webSerialSupported && (
            <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/5 border border-yellow-500/15 rounded-lg">
              <AlertCircle size={12} className="text-yellow-400/70 flex-shrink-0" />
              <p className="text-[11px] text-yellow-300/60">
                Web Serial requires Chrome or Edge
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleFlash}
              disabled={busy || !webSerialSupported}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-white/90 disabled:bg-white/20 text-black disabled:text-white/30 font-medium text-xs rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              {phase === 'compiling' ? (
                <><Loader2 size={12} className="animate-spin" />Compiling…</>
              ) : phase === 'flashing' ? (
                <><Loader2 size={12} className="animate-spin" />Flashing…</>
              ) : (
                <><Zap size={12} />Compile &amp; Flash</>
              )}
            </button>
            <button
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-30 text-white/50 hover:text-white font-medium text-xs rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              Close
            </button>
            {phase === 'done' && (
              <div className="ml-auto flex items-center gap-1.5 text-green-400 text-xs font-medium">
                <CheckCircle2 size={13} />
                Flashed successfully
              </div>
            )}
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

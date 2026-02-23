'use client';

import { useState } from 'react';
import { Loader2, Usb, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  { label: 'Arduino Uno',       value: 'arduino:avr:uno' },
  { label: 'Arduino Nano',      value: 'arduino:avr:nano' },
  { label: 'Arduino Pro Mini',  value: 'arduino:avr:pro' },
];

const BAUD_RATES = [115200, 57600, 38400, 19200, 9600];

type Phase = 'idle' | 'compiling' | 'flashing' | 'done' | 'error';

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

    // Step 1 — select port (requires user gesture, does NOT open it)
    let port: unknown;
    try {
      port = await requestSerialPort();
    } catch (err: any) {
      setErrors([err?.message ?? 'Port selection cancelled']);
      return;
    }

    // Step 2 — compile (port is not open, no stale buffer)
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

    // Step 3 — open port right before flashing (open() needs no gesture)
    setPhase('flashing');
    try {
      await openPort(port, baud);
    } catch (err: any) {
      setErrors([err?.message ?? 'Failed to open port']);
      setPhase('error');
      return;
    }

    // Step 4 — flash
    try {
      await flashHex(hexOutput, port, appendLog);
      setPhase('done');
    } catch (err: any) {
      setErrors([err?.message ?? 'Flash failed']);
      setPhase('error');
    }
  };

  const webSerialSupported = typeof window !== 'undefined' && 'serial' in navigator;

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl border-4 border-foreground bg-background">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black text-foreground flex items-center gap-2">
            <Usb size={20} />
            FLASH FIRMWARE
          </DialogTitle>
          <DialogDescription className="text-foreground/70 font-bold">
            Compile and flash directly to your Arduino from the browser
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black">BOARD</label>
              <select
                value={fqbn}
                onChange={e => setFqbn(e.target.value)}
                className="border-2 border-foreground px-3 py-2 font-bold bg-background text-foreground"
                disabled={busy}
              >
                {BOARDS.map(b => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black">BAUD RATE</label>
              <select
                value={baud}
                onChange={e => setBaud(Number(e.target.value))}
                className="border-2 border-foreground px-3 py-2 font-bold bg-background text-foreground"
                disabled={busy}
              >
                {BAUD_RATES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={handleFlash}
              className="px-4 py-2 bg-foreground text-background font-black text-sm hover:bg-muted hover:text-foreground transition-all"
              disabled={busy || !webSerialSupported}
            >
              {phase === 'compiling' ? (
                <><Loader2 size={14} className="mr-2 animate-spin" />COMPILING…</>
              ) : phase === 'flashing' ? (
                <><Loader2 size={14} className="mr-2 animate-spin" />FLASHING…</>
              ) : (
                <><Zap size={14} className="mr-2" />COMPILE &amp; FLASH</>
              )}
            </Button>
            <Button
              variant="outline"
              className="border-2 border-foreground font-black"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              CLOSE
            </Button>
            {phase === 'done' && (
              <span className="text-sm font-black text-green-500">✓ FLASHED</span>
            )}
            {phase === 'error' && (
              <span className="text-sm font-black text-destructive">✗ FAILED</span>
            )}
          </div>

          {!webSerialSupported && (
            <p className="text-xs text-yellow-500 font-bold">
              Web Serial is not supported in this browser. Use Chrome or Edge to flash firmware.
            </p>
          )}

          <div className="border-2 border-foreground bg-muted p-3 min-h-[160px]">
            <ScrollArea className="h-40">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {logs || 'Output will appear here…'}
              </pre>
            </ScrollArea>
          </div>

          {errors.length > 0 && (
            <div className="border-2 border-red-600 bg-red-50 p-3">
              <p className="text-xs font-black text-red-700 mb-2">ERRORS</p>
              <ul className="text-xs font-mono text-red-700 list-disc pl-4 space-y-1">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

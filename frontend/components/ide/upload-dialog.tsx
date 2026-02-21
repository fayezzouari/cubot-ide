'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Usb, RefreshCw, Cpu } from 'lucide-react';
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
import { compileService } from '@/lib/api';
import type { SerialPortInfo } from '@/lib/api/types';

const COMMON_FQBNS = [
  { label: 'Arduino Uno',          value: 'arduino:avr:uno' },
  { label: 'Arduino Nano',         value: 'arduino:avr:nano' },
  { label: 'Arduino Mega 2560',    value: 'arduino:avr:mega' },
  { label: 'Arduino Leonardo',     value: 'arduino:avr:leonardo' },
  { label: 'Arduino Pro Mini',     value: 'arduino:avr:pro' },
];

const FALLBACK_PORT = '/dev/ttyACM0';

export interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isUploading: boolean;
  uploadSuccess: boolean | null;
  uploadLogs: string;
  uploadErrors: string[];
  /** Called with the port + fqbn the user selected when they click Upload */
  onUpload: (port: string, fqbn: string) => void;
}

export default function UploadDialog({
  open,
  onOpenChange,
  isUploading,
  uploadSuccess,
  uploadLogs,
  uploadErrors,
  onUpload,
}: UploadDialogProps) {
  // All config state lives here — never touches the parent on every keystroke
  const [port, setPort]             = useState(FALLBACK_PORT);
  const [fqbn, setFqbn]             = useState('arduino:avr:uno');
  const [detectedPorts, setDetectedPorts] = useState<SerialPortInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [useCustomPort, setUseCustomPort] = useState(false);

  // Track whether we've scanned for this open session
  const scannedRef = useRef(false);

  const scanPorts = useCallback(async (autoSelect: boolean) => {
    setIsScanning(true);
    try {
      const result = await compileService.listPorts();
      setDetectedPorts(result.ports);
      if (autoSelect && result.suggested) {
        setPort(result.suggested);
        setUseCustomPort(false);
      }
    } catch {
      // keep current port value
    } finally {
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    if (open && !scannedRef.current) {
      scannedRef.current = true;
      // Wait for the dialog open animation to finish before scanning
      const timer = setTimeout(() => scanPorts(true), 300);
      return () => clearTimeout(timer);
    }
    if (!open) {
      scannedRef.current = false;
    }
  }, [open, scanPorts]);

  const selectedPortInfo = detectedPorts.find((p) => p.port === port);

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
          {/* ── Port ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-black">PORT</label>
              <button
                onClick={() => scanPorts(false)}
                disabled={isScanning || isUploading}
                className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors disabled:opacity-30"
              >
                <RefreshCw size={11} className={isScanning ? 'animate-spin' : ''} />
                {isScanning ? 'Scanning…' : 'Rescan'}
              </button>
            </div>

            {isScanning ? (
              <div className="flex items-center gap-2 border-2 border-foreground px-3 py-2 text-xs text-foreground/40">
                <Loader2 size={12} className="animate-spin" />
                Detecting connected boards…
              </div>
            ) : detectedPorts.length > 0 && !useCustomPort ? (
              <>
                <select
                  value={port}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setUseCustomPort(true);
                      setPort('');
                    } else {
                      setPort(e.target.value);
                    }
                  }}
                  className="w-full border-2 border-foreground px-3 py-2 font-bold bg-background text-foreground text-sm"
                  disabled={isUploading}
                >
                  {detectedPorts.map((p) => (
                    <option key={p.port} value={p.port}>
                      {p.port}
                      {p.hint ? ` — ${p.hint}` : ''}
                      {p.score === 2 ? ' ★' : ''}
                    </option>
                  ))}
                  <option value="__custom__">Enter manually…</option>
                </select>

                {selectedPortInfo?.score === 2 && (
                  <div className="flex items-center gap-1.5 text-xs text-green-500 font-bold">
                    <Cpu size={11} />
                    Arduino detected — {selectedPortInfo.hint}
                  </div>
                )}
                {selectedPortInfo?.score === 1 && (
                  <div className="text-xs text-yellow-500 font-bold">
                    Possible Arduino — {selectedPortInfo.description}
                  </div>
                )}
                {selectedPortInfo?.score === 0 && (
                  <div className="text-xs text-foreground/30">
                    No Arduino signature found on this port
                  </div>
                )}
              </>
            ) : (
              <>
                <Input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="border-2 border-foreground font-bold"
                  placeholder="/dev/ttyACM0"
                  disabled={isUploading}
                />
                {detectedPorts.length > 0 && (
                  <button
                    onClick={() => {
                      setUseCustomPort(false);
                      setPort(detectedPorts[0].port);
                    }}
                    className="text-xs text-foreground/40 hover:text-foreground transition-colors self-start"
                  >
                    ← Back to detected ports
                  </button>
                )}
                <p className="text-xs text-foreground/30">
                  Linux: /dev/ttyACM0 · macOS: /dev/cu.usbmodem… · Windows: COM3
                </p>
              </>
            )}
          </div>

          {/* ── Board ── */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-black">BOARD</label>
            <select
              value={fqbn}
              onChange={(e) => setFqbn(e.target.value)}
              className="border-2 border-foreground px-3 py-2 font-bold bg-background text-foreground"
              disabled={isUploading}
            >
              {COMMON_FQBNS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>

          {/* ── Actions ── */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={() => onUpload(port, fqbn)}
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
              <span className={`text-sm font-black ${uploadSuccess ? 'text-green-500' : 'text-destructive'}`}>
                {uploadSuccess ? '✓ UPLOADED' : '✗ FAILED'}
              </span>
            )}
          </div>

          {/* ── Logs ── */}
          <div className="border-2 border-foreground bg-muted p-3 min-h-[160px]">
            <ScrollArea className="h-40">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {uploadLogs || 'Output will appear here after upload…'}
              </pre>
            </ScrollArea>
          </div>

          {/* ── Errors ── */}
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

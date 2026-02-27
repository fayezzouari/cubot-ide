'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, TerminalSquare, Circle, AlertCircle, Usb, Trash2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000, 2000000];

interface SerialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SerialDialog({ open, onOpenChange }: SerialDialogProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [baudRate, setBaudRate] = useState(115200);
  const [portLabel, setPortLabel] = useState<string | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleDisconnect = useCallback(async () => {
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }
      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }
    } catch {
      // ignore errors on cleanup
    }
    setIsConnected(false);
    setIsConnecting(false);
    setPortLabel(null);
  }, []);

  // Disconnect when dialog closes
  useEffect(() => {
    if (!open) {
      handleDisconnect();
    }
  }, [open, handleDisconnect]);

  const handleConnect = async () => {
    if (!isSupported) return;
    setError(null);
    setIsConnecting(true);

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate });

      portRef.current = port;

      const info = port.getInfo();
      setPortLabel(
        info.usbVendorId
          ? `USB ${info.usbVendorId.toString(16).toUpperCase()}:${info.usbProductId?.toString(16).toUpperCase()}`
          : 'Serial Port',
      );

      setIsConnected(true);
      setIsConnecting(false);
      setLogs([]);

      // Read loop
      const decoder = new TextDecoder();
      let buffer = '';

      const reader = port.readable!.getReader();
      readerRef.current = reader;

      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            if (lines.length > 0) {
              setLogs((prev) => [...prev, ...lines]);
            }
          }
        } catch {
          // reader cancelled or port closed
        } finally {
          setIsConnected(false);
          setPortLabel(null);
          readerRef.current = null;
        }
      })();
    } catch (err: any) {
      // User cancelled the port picker — not an error
      if (err?.name !== 'NotFoundError') {
        setError(err?.message ?? 'Failed to open serial port.');
      }
      setIsConnecting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) handleDisconnect();
      }}
    >
      <DialogContent className="max-w-lg bg-[#0e0e0e] border border-white/[0.08] rounded-xl p-0 gap-0 shadow-2xl overflow-hidden">

        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <TerminalSquare size={14} className="text-white/70" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-white leading-none">
                Serial Monitor
              </DialogTitle>
              <DialogDescription className="text-xs text-white/40 mt-0.5">
                {portLabel ?? 'Connect to an Arduino or serial device'}
              </DialogDescription>
            </div>
            {/* Status badge */}
            <div className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              isConnected
                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                : isConnecting
                  ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                  : 'bg-white/[0.04] border-white/[0.08] text-white/30'
            }`}>
              <Circle size={6} className={`fill-current ${isConnecting ? 'animate-pulse' : ''}`} />
              {isConnected ? 'Connected' : isConnecting ? 'Connecting…' : 'Disconnected'}
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">

          {/* Baud rate selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Baud rate</label>
            <select
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              disabled={isConnected || isConnecting}
              className="w-full bg-[#161616] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 font-mono disabled:opacity-40 focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
            >
              {BAUD_RATES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Terminal */}
          <div className="bg-black border border-white/[0.06] rounded-lg overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.04]">
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="ml-1 text-[11px] text-white/20 font-mono">serial output</span>
              {logs.length > 0 && (
                <button
                  onClick={() => setLogs([])}
                  className="ml-auto text-white/20 hover:text-white/50 transition-colors"
                  title="Clear"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
            <div ref={scrollRef} className="h-52 overflow-y-auto">
              <pre className="px-3 py-2.5 text-[11px] font-mono leading-relaxed text-white/50 whitespace-pre-wrap">
                {logs.length > 0
                  ? logs.join('\n')
                  : <span className="text-white/20">No serial data yet…</span>
                }
              </pre>
            </div>
          </div>

          {/* Unsupported warning */}
          {!isSupported && (
            <div className="flex items-start gap-2 bg-yellow-950/20 border border-yellow-500/20 rounded-lg px-3 py-2.5">
              <AlertCircle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] font-mono text-yellow-300/80 leading-relaxed">
                Web Serial is not supported in this browser. Use Chrome or Edge.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-950/20 border border-red-500/20 rounded-lg px-3 py-2.5">
              <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] font-mono text-red-300/80 leading-relaxed">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting || !isSupported}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-white/90 disabled:bg-white/20 text-black disabled:text-white/30 font-medium text-xs rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                {isConnecting ? (
                  <><Loader2 size={12} className="animate-spin" />Connecting…</>
                ) : (
                  <><Usb size={12} />Select Port & Connect</>
                )}
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 text-red-400 font-medium text-xs rounded-lg transition-all cursor-pointer"
              >
                <Circle size={10} className="fill-current" />
                Disconnect
              </button>
            )}
            <button
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] text-white/50 hover:text-white font-medium text-xs rounded-lg transition-all cursor-pointer"
            >
              Close
            </button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { Loader2, TerminalSquare, Circle, AlertCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface SerialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serialPort: string;
  onSerialPortChange: (value: string) => void;
  serialBaud: string;
  onSerialBaudChange: (value: string) => void;
  isSerialConnected: boolean;
  isSerialConnecting: boolean;
  serialError: string | null;
  serialLogs: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function SerialDialog({
  open,
  onOpenChange,
  serialPort,
  onSerialPortChange,
  serialBaud,
  onSerialBaudChange,
  isSerialConnected,
  isSerialConnecting,
  serialError,
  serialLogs,
  onConnect,
  onDisconnect,
}: SerialDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        onOpenChange(nextOpen);
        if (!nextOpen) onDisconnect();
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
                Connect to the Arduino serial port and view output
              </DialogDescription>
            </div>
            {/* Connection status badge */}
            <div className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              isSerialConnected
                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                : isSerialConnecting
                  ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                  : 'bg-white/[0.04] border-white/[0.08] text-white/30'
            }`}>
              <Circle size={6} className={`fill-current ${isSerialConnecting ? 'animate-pulse' : ''}`} />
              {isSerialConnected ? 'Connected' : isSerialConnecting ? 'Connecting…' : 'Disconnected'}
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">

          {/* Port + Baud inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Port</label>
              <Input
                value={serialPort}
                onChange={e => onSerialPortChange(e.target.value)}
                placeholder="/dev/ttyACM0"
                disabled={isSerialConnected || isSerialConnecting}
                className="bg-[#161616] border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 font-mono placeholder:text-white/20 disabled:opacity-40 focus-visible:ring-0 focus-visible:border-blue-500/50 h-auto"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Baud rate</label>
              <Input
                value={serialBaud}
                onChange={e => onSerialBaudChange(e.target.value)}
                placeholder="115200"
                disabled={isSerialConnected || isSerialConnecting}
                className="bg-[#161616] border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 font-mono placeholder:text-white/20 disabled:opacity-40 focus-visible:ring-0 focus-visible:border-blue-500/50 h-auto"
              />
            </div>
          </div>

          {/* Serial terminal */}
          <div className="bg-black border border-white/[0.06] rounded-lg overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.04]">
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="w-2 h-2 rounded-full bg-white/10" />
              <span className="ml-1 text-[11px] text-white/20 font-mono">serial</span>
            </div>
            <ScrollArea className="h-52">
              <pre className="px-3 py-2.5 text-[11px] font-mono leading-relaxed text-white/50 whitespace-pre-wrap">
                {serialLogs || <span className="text-white/20">No serial data yet…</span>}
              </pre>
            </ScrollArea>
          </div>

          {/* Error */}
          {serialError && (
            <div className="flex items-start gap-2 bg-red-950/20 border border-red-500/20 rounded-lg px-3 py-2.5">
              <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] font-mono text-red-300/80 leading-relaxed">{serialError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {!isSerialConnected ? (
              <button
                onClick={onConnect}
                disabled={isSerialConnecting}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-white/90 disabled:bg-white/20 text-black disabled:text-white/30 font-medium text-xs rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                {isSerialConnecting ? (
                  <><Loader2 size={12} className="animate-spin" />Connecting…</>
                ) : (
                  <><Circle size={10} />Connect</>
                )}
              </button>
            ) : (
              <button
                onClick={onDisconnect}
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

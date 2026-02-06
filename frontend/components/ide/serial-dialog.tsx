'use client';

import { Loader2 } from 'lucide-react';
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
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          onDisconnect();
        }
      }}
    >
      <DialogContent className="max-w-2xl border-4 border-foreground bg-background">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black text-foreground">
            SERIAL MONITOR
          </DialogTitle>
          <DialogDescription className="text-foreground/70 font-bold">
            Connect to the Arduino serial port and view output
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black">PORT</label>
              <Input
                value={serialPort}
                onChange={(e) => onSerialPortChange(e.target.value)}
                className="border-2 border-foreground font-bold"
                placeholder="/dev/ttyACM0"
                disabled={isSerialConnected || isSerialConnecting}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black">BAUD</label>
              <Input
                value={serialBaud}
                onChange={(e) => onSerialBaudChange(e.target.value)}
                className="border-2 border-foreground font-bold"
                placeholder="115200"
                disabled={isSerialConnected || isSerialConnecting}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isSerialConnected ? (
              <Button
                onClick={onConnect}
                className="px-4 py-2 bg-foreground text-background font-black text-sm hover:bg-muted hover:text-foreground transition-all"
                disabled={isSerialConnecting}
              >
                {isSerialConnecting ? (
                  <>
                    <Loader2 size={14} className="mr-2 animate-spin" />
                    CONNECTING...
                  </>
                ) : (
                  'CONNECT'
                )}
              </Button>
            ) : (
              <Button
                onClick={onDisconnect}
                className="px-4 py-2 bg-destructive text-destructive-foreground font-black text-sm hover:bg-destructive/90"
              >
                DISCONNECT
              </Button>
            )}
            {serialError && (
              <span className="text-sm font-bold text-destructive">{serialError}</span>
            )}
          </div>

          <div className="border-2 border-foreground bg-muted p-3 h-64 overflow-hidden">
            <ScrollArea className="h-full">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {serialLogs || 'No serial data yet.'}
              </pre>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

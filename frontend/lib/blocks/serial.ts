// Web Serial link to a controller running the CuBot firmware (see codegen.ts).
// Commands are sent one at a time; each waits for an "ok" line.

import type { HardwareLink } from './workcell';

export class SerialLink implements HardwareLink {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer = '';
  private pending: { resolve: (line: string) => void; reject: (e: Error) => void } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  onLine: ((dir: 'tx' | 'rx', line: string) => void) | null = null;
  onClose: (() => void) | null = null;

  static supported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  async connect(baudRate = 115200) {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate });
    this.writer = this.port.writable!.getWriter();
    this.reader = this.port.readable!.getReader();
    void this.readLoop();
    // Most boards reset when the port opens.
    await new Promise((r) => setTimeout(r, 1800));
  }

  private async readLoop() {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await this.reader!.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, nl).trim();
          this.buffer = this.buffer.slice(nl + 1);
          if (!line) continue;
          this.onLine?.('rx', line);
          if (this.pending && (line.startsWith('ok') || line.startsWith('err'))) {
            const p = this.pending;
            this.pending = null;
            if (line.startsWith('ok')) p.resolve(line);
            else p.reject(new Error(`Controller: ${line}`));
          }
        }
      }
    } catch {
      // port closed or device unplugged
    } finally {
      this.pending?.reject(new Error('Serial connection closed'));
      this.pending = null;
      this.onClose?.();
    }
  }

  send(line: string): Promise<void> {
    const run = async () => {
      if (!this.writer) throw new Error('Not connected');
      const reply = new Promise<string>((resolve, reject) => {
        this.pending = { resolve, reject };
        setTimeout(() => {
          if (this.pending?.resolve === resolve) {
            this.pending = null;
            reject(new Error(`Controller did not answer "${line}" within 30 s`));
          }
        }, 30_000);
      });
      this.onLine?.('tx', line);
      await this.writer.write(new TextEncoder().encode(line + '\n'));
      await reply;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async disconnect() {
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      this.writer?.releaseLock();
      await this.port?.close();
    } finally {
      this.port = null;
      this.writer = null;
      this.reader = null;
    }
  }
}

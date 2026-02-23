const STK = {
  OK: 0x10,
  INSYNC: 0x14,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
} as const;

const PAGE_SIZE = 128;

// ── Utilities ─────────────────────────────────────────────────────────────────

function parseIntelHex(hex: string): Uint8Array {
  const buf = new Uint8Array(0x8000).fill(0xff);
  for (const line of hex.split('\n')) {
    const s = line.trim();
    if (!s.startsWith(':')) continue;
    const byteCount = parseInt(s.slice(1, 3), 16);
    const addr     = parseInt(s.slice(3, 7), 16);
    const type     = parseInt(s.slice(7, 9), 16);
    if (type !== 0x00) continue;
    for (let i = 0; i < byteCount; i++) {
      buf[addr + i] = parseInt(s.slice(9 + i * 2, 11 + i * 2), 16);
    }
  }
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0xff) end--;
  return buf.slice(0, Math.ceil(end / PAGE_SIZE) * PAGE_SIZE);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Serial pump ───────────────────────────────────────────────────────────────
// Maintains exactly one pending read() at a time and pushes bytes into a
// shared buffer. Avoids the orphaned-promise problem with Promise.race.

class SerialPump {
  private buf: number[] = [];
  private active = true;

  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.run();
  }

  private async run() {
    while (this.active) {
      try {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) for (const b of value) this.buf.push(b);
      } catch { break; }
    }
  }

  async read(n: number, timeoutMs: number): Promise<number[]> {
    const out: number[] = [];
    const deadline = Date.now() + timeoutMs;
    while (out.length < n) {
      if (Date.now() > deadline) throw new Error('Serial read timeout');
      if (this.buf.length > 0) {
        out.push(...this.buf.splice(0, n - out.length));
      } else {
        await sleep(5);
      }
    }
    return out;
  }

  /** Read until INSYNC+OK is found, scanning past garbage. Returns true on success. */
  async waitForInsync(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const seen: number[] = [];
    while (Date.now() < deadline) {
      if (this.buf.length > 0) {
        seen.push(...this.buf.splice(0));
        const idx = seen.indexOf(STK.INSYNC);
        if (idx !== -1 && seen.length > idx + 1) {
          return seen[idx + 1] === STK.OK;
        }
      } else {
        await sleep(5);
      }
    }
    return false;
  }

  stop() { this.active = false; }
}

// ── Protocol helpers ──────────────────────────────────────────────────────────

async function send(w: WritableStreamDefaultWriter<Uint8Array>, bytes: number[]) {
  await w.write(new Uint8Array(bytes));
}

async function expectInsync(pump: SerialPump) {
  const [a, b] = await pump.read(2, 3000);
  if (a !== STK.INSYNC || b !== STK.OK) {
    throw new Error(`Expected INSYNC+OK, got 0x${a.toString(16)} 0x${b.toString(16)}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Must be called inside a user-gesture handler. Does NOT open the port. */
export async function requestSerialPort(): Promise<unknown> {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial is not supported in this browser. Use Chrome or Edge.');
  }
  return (navigator as any).serial.requestPort();
}

/** Open the port. Call this after compilation, right before flashHex. */
export async function openPort(port: unknown, baudRate: number): Promise<void> {
  const p = port as any;

  if (p.readable !== null) {
    if (p.readable.locked) try { await p.readable.cancel(); } catch { /* ignore */ }
    if (p.writable?.locked) try { await p.writable.abort(); } catch { /* ignore */ }
    try { await p.close(); } catch { /* ignore */ }
    await sleep(100);
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    try { await p.open({ baudRate }); return; } catch { /* ignore */ }
    if (attempt < 5) await sleep(400);
  }
  throw new Error(
    'Could not open the serial port.\n' +
    'On Linux: sudo chmod a+rw /dev/ttyACM0\n' +
    'Make sure no other app (Arduino IDE) is using it.'
  );
}

/** Flash an Intel HEX string to an already-open serial port. */
export async function flashHex(
  hexString: string,
  port: unknown,
  onLog: (msg: string) => void,
): Promise<void> {
  const binary = parseIntelHex(hexString);
  const totalPages = binary.length / PAGE_SIZE;
  onLog(`Binary: ${binary.length} bytes, ${totalPages} pages`);

  const p = port as any;
  const writer: WritableStreamDefaultWriter<Uint8Array> = p.writable.getWriter();
  const reader: ReadableStreamDefaultReader<Uint8Array> = p.readable.getReader();
  const pump = new SerialPump(reader);

  try {
    // Ensure DTR starts HIGH so the falling edge reliably triggers reset
    onLog('Resetting board…');
    await p.setSignals({ dataTerminalReady: true });
    await sleep(50);
    await p.setSignals({ dataTerminalReady: false });
    await sleep(150);
    await p.setSignals({ dataTerminalReady: true });
    await sleep(200);

    onLog('Syncing with bootloader…');
    let synced = false;
    const syncDeadline = Date.now() + 6000;

    while (!synced && Date.now() < syncDeadline) {
      await send(writer, [STK.GET_SYNC, STK.CRC_EOP]);
      synced = await pump.waitForInsync(400);
      if (!synced) await sleep(80);
    }

    if (!synced) throw new Error(
      'Failed to sync with bootloader.\n' +
      'Try: different baud rate, replug the board, or hold Reset then click Flash.'
    );
    onLog('Sync OK');

    await send(writer, [STK.ENTER_PROGMODE, STK.CRC_EOP]);
    await expectInsync(pump);
    onLog('Programming…');

    for (let page = 0; page < totalPages; page++) {
      const wordAddr = (page * PAGE_SIZE) >> 1;
      await send(writer, [STK.LOAD_ADDRESS, wordAddr & 0xff, (wordAddr >> 8) & 0xff, STK.CRC_EOP]);
      await expectInsync(pump);

      const pageData = binary.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      await send(writer, [STK.PROG_PAGE, 0x00, PAGE_SIZE, 0x46, ...pageData, STK.CRC_EOP]);
      await expectInsync(pump);

      onLog(`Flashing… ${Math.round(((page + 1) / totalPages) * 100)}%`);
    }

    await send(writer, [STK.LEAVE_PROGMODE, STK.CRC_EOP]);
    await expectInsync(pump);
    onLog('Done! Board is running the new firmware.');
  } finally {
    pump.stop();
    reader.releaseLock();
    writer.releaseLock();
    try { await p.close(); } catch { /* ignore */ }
  }
}

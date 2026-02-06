import {
  CPU,
  avrInstruction,
  AVRIOPort,
  AVRUSART,
  portBConfig,
  portCConfig,
  portDConfig,
  AVRTimer,
  timer0Config,
  timer1Config,
  timer2Config,
} from 'avr8js';

const FLASH_SIZE = 32768; // 32KB for ATmega328p

export interface AVRRunnerCallbacks {
  onSerialWrite?: (value: number) => void;
  onPinChange?: (port: string, pin: number, value: boolean) => void;
}

export class AVRRunner {
  readonly cpu: CPU;
  readonly flash: Uint16Array;
  readonly portB: AVRIOPort;
  readonly portC: AVRIOPort;
  readonly portD: AVRIOPort;
  readonly usart: AVRUSART;
  readonly timer0: AVRTimer;
  readonly timer1: AVRTimer;
  readonly timer2: AVRTimer;

  private stopped = true;
  private callbacks: AVRRunnerCallbacks = {};
  private speed = 16000000; // 16MHz

  constructor(hex: string) {
    this.flash = new Uint16Array(FLASH_SIZE / 2);
    this.loadHex(hex);

    this.cpu = new CPU(this.flash);

    // Set up I/O ports
    this.portB = new AVRIOPort(this.cpu, portBConfig);
    this.portC = new AVRIOPort(this.cpu, portCConfig);
    this.portD = new AVRIOPort(this.cpu, portDConfig);

    // Set up USART for serial communication
    this.usart = new AVRUSART(this.cpu, {
      rxCompleteInterrupt: 0x24,
      dataRegisterEmptyInterrupt: 0x26,
      txCompleteInterrupt: 0x28,
      UCSRA: 0xc0,
      UCSRB: 0xc1,
      UCSRC: 0xc2,
      UBRRL: 0xc4,
      UBRRH: 0xc5,
      UDR: 0xc6,
    }, this.speed);

    // Set up timers
    this.timer0 = new AVRTimer(this.cpu, timer0Config);
    this.timer1 = new AVRTimer(this.cpu, timer1Config);
    this.timer2 = new AVRTimer(this.cpu, timer2Config);

    // Wire up USART output
    this.usart.onByteTransmit = (value: number) => {
      this.callbacks.onSerialWrite?.(value);
    };

    // Wire up port change listeners
    this.portB.addListener(() => {
      for (let i = 0; i < 8; i++) {
        const value = !!(this.portB.pinState(i) & 1);
        this.callbacks.onPinChange?.('B', i, value);
      }
    });

    this.portC.addListener(() => {
      for (let i = 0; i < 8; i++) {
        const value = !!(this.portC.pinState(i) & 1);
        this.callbacks.onPinChange?.('C', i, value);
      }
    });

    this.portD.addListener(() => {
      for (let i = 0; i < 8; i++) {
        const value = !!(this.portD.pinState(i) & 1);
        this.callbacks.onPinChange?.('D', i, value);
      }
    });
  }

  setCallbacks(callbacks: AVRRunnerCallbacks) {
    this.callbacks = callbacks;
  }

  private loadHex(hex: string) {
    for (const line of hex.split('\n')) {
      if (!line.startsWith(':') || line.length < 11) continue;

      const byteCount = parseInt(line.slice(1, 3), 16);
      const address = parseInt(line.slice(3, 7), 16);
      const recordType = parseInt(line.slice(7, 9), 16);

      if (recordType !== 0) continue; // Only data records

      for (let i = 0; i < byteCount; i += 2) {
        const offset = 9 + i * 2;
        const lowByte = parseInt(line.slice(offset, offset + 2), 16);
        const highByte = parseInt(line.slice(offset + 2, offset + 4), 16);
        const word = (highByte << 8) | lowByte;
        this.flash[(address + i) / 2] = word;
      }
    }
  }

  sendSerial(value: number) {
    this.usart.writeByte(value);
  }

  setPin(port: string, pin: number, value: boolean) {
    const portObj =
      port === 'B' ? this.portB : port === 'C' ? this.portC : this.portD;
    if (value) {
      portObj.setPin(pin, true);
    } else {
      portObj.setPin(pin, false);
    }
  }

  start() {
    this.stopped = false;
    this.run();
  }

  stop() {
    this.stopped = true;
  }

  private run() {
    if (this.stopped) return;

    const cyclesToRun = this.speed / 60; // ~60 FPS
    for (let i = 0; i < cyclesToRun; i++) {
      avrInstruction(this.cpu);
    }

    requestAnimationFrame(() => this.run());
  }
}

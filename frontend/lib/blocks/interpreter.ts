// Executes a compiled program against the simulated workcell.

import { interpolate, type CompiledProgram, type Stmt } from './compiler';
import { evaluate, truthy, type Ast, type Value } from './expression';
import type { Pose, Vec3 } from './types';
import { AbortError, FaultError, HOME, type World } from './workcell';

export interface LogEntry {
  id: number;
  time: number; // sim seconds
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  nodeId?: string;
}

export interface TelemetryEntry {
  id: number;
  time: number;
  topic: string;
  payload: string;
}

export interface RunHooks {
  onActive: (nodeId: string | null) => void;
  onLog: (entry: Omit<LogEntry, 'id'>) => void;
  onTelemetry: (entry: Omit<TelemetryEntry, 'id'>) => void;
  onVariables: (vars: Record<string, Value>) => void;
}

export type RunResult = { status: 'done' | 'stopped' | 'fault'; message?: string; nodeId?: string };

const MAX_LOOP_ITERATIONS = 100_000;

class EndSignal extends Error {}

export class Interpreter {
  private vars = new Map<string, Value>();
  private aborted = false;
  private stepGate: (() => void) | null = null;
  stepping = false;
  private currentNode: string | null = null;

  constructor(
    private world: World,
    private program: CompiledProgram,
    private poses: Pose[],
    private hooks: RunHooks,
  ) {}

  // ── Public control ───────────────────────────────────────────────────────
  stop() {
    this.aborted = true;
    this.world.abortAll();
    this.stepGate?.();
  }

  step() {
    const gate = this.stepGate;
    this.stepGate = null;
    gate?.();
  }

  setStepping(on: boolean) {
    this.stepping = on;
    if (!on) this.step();
  }

  async run(): Promise<RunResult> {
    this.world.stats.cycleStart = this.world.time;
    const startTime = this.world.time;
    this.vars.set('part_color', 'none');
    this.vars.set('part_defect', false);
    this.vars.set('part_ok', false);
    this.vars.set('pallet_dx', 0);
    this.vars.set('pallet_dy', 0);
    this.vars.set('pallet_dz', 0);
    this.publishVars();
    this.log('info', 'Program started');
    try {
      await this.block(this.program.body);
      this.log('success', `Program finished in ${(this.world.time - startTime).toFixed(1)} s`);
      return { status: 'done' };
    } catch (e) {
      if (e instanceof EndSignal) {
        this.log('success', `Reached End after ${(this.world.time - startTime).toFixed(1)} s`);
        return { status: 'done' };
      }
      if (e instanceof AbortError || this.aborted) {
        this.log('warn', 'Program stopped by operator');
        return { status: 'stopped' };
      }
      const message = (e as Error).message;
      this.world.outputs[3] = true;
      this.log('error', message, this.currentNode ?? undefined);
      return { status: 'fault', message, nodeId: this.currentNode ?? undefined };
    } finally {
      this.hooks.onActive(null);
    }
  }

  // ── Execution ────────────────────────────────────────────────────────────
  private scope = (name: string): Value | undefined => {
    const w = this.world;
    switch (name) {
      case 'time':
        return Math.round((w.time - w.stats.cycleStart) * 1000) / 1000;
      case 'tcp_x':
        return w.tcp.x;
      case 'tcp_y':
        return w.tcp.y;
      case 'tcp_z':
        return w.tcp.z;
      case 'holding':
        return !!w.held;
      case 'part_present':
      case 'di0':
        return w.inputs[0];
      case 'machine_done':
      case 'di1':
        return w.inputs[1];
      case 'di2':
        return w.inputs[2];
      case 'di3':
        return w.inputs[3];
    }
    return this.vars.get(name);
  };

  private num(ast: Ast | string, what: string): number {
    const v = evaluate(ast as Ast, this.scope);
    const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
    if (!Number.isFinite(n)) throw new FaultError(`${what} must be a number, got "${v}"`);
    return n;
  }

  private pose(name: string, f: Record<string, Ast | string>): Vec3 {
    const p = this.poses.find((x) => x.name === name);
    if (!p) throw new FaultError(`Pose "${name}" is not taught`);
    return {
      x: p.x + (f.dx !== undefined ? this.num(f.dx, 'Offset X') : 0),
      y: p.y + (f.dy !== undefined ? this.num(f.dy, 'Offset Y') : 0),
      z: p.z + (f.dz !== undefined ? this.num(f.dz, 'Offset Z') : 0),
    };
  }

  private log(level: LogEntry['level'], message: string, nodeId?: string) {
    this.hooks.onLog({ time: this.world.time - this.world.stats.cycleStart, level, message, nodeId });
  }

  private publishVars() {
    this.hooks.onVariables(Object.fromEntries(this.vars));
  }

  private async enter(nodeId: string) {
    if (this.aborted) throw new AbortError();
    this.currentNode = nodeId;
    this.hooks.onActive(nodeId);
    if (this.stepping) {
      await new Promise<void>((resolve) => (this.stepGate = resolve));
      if (this.aborted) throw new AbortError();
    }
  }

  private async block(stmts: Stmt[]) {
    for (const s of stmts) await this.stmt(s);
  }

  private async stmt(s: Stmt) {
    await this.enter(s.nodeId);
    switch (s.kind) {
      case 'end':
        throw new EndSignal();
      case 'if': {
        const branch = truthy(evaluate(s.cond, this.scope));
        await this.block(branch ? s.then : s.else);
        return;
      }
      case 'for': {
        const n = Math.floor(this.num(s.count, 'Repeat count'));
        for (let i = 0; i < n; i++) {
          this.vars.set(s.var, i);
          this.publishVars();
          await this.block(s.body);
          await this.enter(s.nodeId);
        }
        return;
      }
      case 'while': {
        let guard = 0;
        while (truthy(evaluate(s.cond, this.scope))) {
          if (++guard > MAX_LOOP_ITERATIONS) throw new FaultError('While loop exceeded 100 000 iterations');
          await this.block(s.body);
          // An empty body would spin without yielding; let the sim advance.
          if (s.body.length === 0) await this.world.sleep(0.05);
          await this.enter(s.nodeId);
        }
        return;
      }
      case 'block':
        await this.exec(s.type, s.f);
        this.publishVars();
    }
  }

  private async exec(type: string, f: Record<string, Ast | string>) {
    const w = this.world;
    const text = (k: string) => interpolate(f[k] as string, this.scope);
    const speed = () => (f.speed !== undefined ? this.num(f.speed, 'Speed') : 60);
    const mode = () => (f.mode === 'linear' ? 'linear' : 'joint');

    switch (type) {
      case 'delay':
        return w.sleep(this.num(f.seconds, 'Duration'));
      case 'wait_until': {
        const cond = f.condition as Ast;
        const timeout = this.num(f.timeout, 'Timeout');
        return w.waitFor(() => truthy(evaluate(cond, this.scope)), timeout, `Wait until: timed out after ${timeout} s`);
      }
      case 'alarm':
        throw new FaultError(`Alarm: ${text('message')}`);

      case 'move_pose':
        return w.moveTo(this.pose(f.pose as string, f), mode(), speed());
      case 'move_position':
        return w.moveTo({ x: this.num(f.x, 'X'), y: this.num(f.y, 'Y'), z: this.num(f.z, 'Z') }, mode(), speed());
      case 'move_relative': {
        const t = w.tcp;
        return w.moveTo(
          { x: t.x + this.num(f.dx, 'ΔX'), y: t.y + this.num(f.dy, 'ΔY'), z: t.z + this.num(f.dz, 'ΔZ') },
          'linear',
          speed(),
        );
      }
      case 'move_joint': {
        const target = [...w.joints];
        target[Number(f.joint) - 1] = this.num(f.angle, 'Angle');
        return w.moveJoints(target, speed());
      }
      case 'home':
        return w.moveJoints(HOME, speed());
      case 'get_position': {
        const t = w.tcp;
        this.vars.set(`${f.prefix}_x`, Math.round(t.x * 10) / 10);
        this.vars.set(`${f.prefix}_y`, Math.round(t.y * 10) / 10);
        this.vars.set(`${f.prefix}_z`, Math.round(t.z * 10) / 10);
        return;
      }

      case 'pick':
      case 'place': {
        const target = this.pose(f.pose as string, f);
        const up = this.num(f.approach, 'Approach height');
        const above = { ...target, y: target.y + up };
        const sp = speed();
        if (type === 'pick') await w.setGripper(false);
        await w.moveTo(above, 'joint', sp);
        await w.moveTo(target, 'linear', Math.min(sp, 40));
        const holding = await w.setGripper(type === 'pick');
        if (type === 'pick' && !holding) this.log('warn', 'Pick: no part under the gripper', this.currentNode ?? undefined);
        await w.moveTo(above, 'linear', Math.min(sp, 40));
        return;
      }
      case 'gripper':
        await w.setGripper(f.action === 'close');
        return;

      case 'conveyor':
        return w.setConveyor(f.action !== 'stop', this.num(f.speed, 'Belt speed'));
      case 'set_output':
        return w.setOutput(Number(f.channel), f.value !== 'off');
      case 'wait_input': {
        const ch = Number(f.channel);
        const want = f.value !== 'off';
        const timeout = this.num(f.timeout, 'Timeout');
        return w.waitFor(() => w.inputs[ch] === want, timeout, `Timed out after ${timeout} s waiting for DI${ch} = ${want ? 'on' : 'off'}`);
      }

      case 'inspect': {
        await w.sleep(0.3); // exposure + processing
        const r = w.inspect();
        this.vars.set('part_color', r.color);
        this.vars.set('part_defect', r.defect);
        this.vars.set('part_ok', r.color !== 'none' && !r.defect);
        this.log('info', r.color === 'none' ? 'Vision: no part' : `Vision: ${r.color}${r.defect ? ', DEFECT' : ', ok'}`);
        return;
      }
      case 'read_input':
        this.vars.set(f.var as string, w.inputs[Number(f.channel)]);
        return;

      case 'set_var':
        this.vars.set(f.var as string, evaluate(f.value as Ast, this.scope));
        return;
      case 'change_var': {
        const cur = this.vars.get(f.var as string) ?? 0;
        this.vars.set(f.var as string, Number(cur) + this.num(f.by, 'By'));
        return;
      }
      case 'pallet': {
        const i = Math.floor(this.num(f.index, 'Slot index'));
        const cols = Math.max(1, Math.floor(this.num(f.cols, 'Columns')));
        const rows = Math.max(1, Math.floor(this.num(f.rows, 'Rows')));
        this.vars.set('pallet_dx', (i % cols) * this.num(f.pitch_x, 'Pitch X'));
        this.vars.set('pallet_dz', (Math.floor(i / cols) % rows) * this.num(f.pitch_z, 'Pitch Z'));
        this.vars.set('pallet_dy', Math.floor(i / (cols * rows)) * this.num(f.layer_height, 'Layer height'));
        return;
      }
      case 'log':
        this.log('info', text('message'), this.currentNode ?? undefined);
        return;
      case 'mqtt_publish':
        this.hooks.onTelemetry({ time: w.time - w.stats.cycleStart, topic: text('topic'), payload: text('payload') });
        return;
    }
  }
}

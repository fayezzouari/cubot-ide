'use client';

// Teach pendant: jog the tool, teach named poses, move to them.

import { useState } from 'react';
import { Crosshair, Navigation, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { toolYaw, wrap180 } from '@/lib/blocks/kinematics';
import type { Pose } from '@/lib/blocks/types';
import type { World } from '@/lib/blocks/workcell';
import { useWorldVersion } from '@/lib/blocks/useWorld';

const numCls =
  'w-full rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-1 text-right font-mono text-[11px] text-white focus:border-white/25 focus:outline-none disabled:opacity-50';

export function PosesPanel({
  world,
  poses,
  disabled,
  onChange,
}: {
  world: World;
  poses: Pose[];
  disabled: boolean;
  onChange: (poses: Pose[]) => void;
}) {
  useWorldVersion(world, 6);
  const [step, setStep] = useState(20);
  const [newName, setNewName] = useState('');
  const tcp = world.tcp;
  const busy = disabled || world.moving;

  const move = (p: Pose | { x: number; y: number; z: number }, mode: 'joint' | 'linear' = 'joint') =>
    world.moveTo(p, mode, 50).catch((e: Error) => {
      if (e.name !== 'AbortError') toast.error(e.message);
    });

  const jog = (axis: 'x' | 'y' | 'z', dir: number) =>
    move({ x: tcp.x, y: tcp.y, z: tcp.z, [axis]: tcp[axis] + dir * step }, 'linear');

  const teach = (name: string) => {
    const here = { name, x: Math.round(tcp.x), y: Math.round(tcp.y), z: Math.round(tcp.z), rz: Math.round(wrap180(toolYaw(world.joints))) };
    const exists = poses.some((p) => p.name === name);
    onChange(exists ? poses.map((p) => (p.name === name ? here : p)) : [...poses, here]);
    toast.success(`Taught ${name} at (${here.x}, ${here.y}, ${here.z})`);
  };

  const addPose = () => {
    const name = newName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!name) return;
    if (poses.some((p) => p.name === name)) {
      toast.error(`Pose ${name} already exists`);
      return;
    }
    teach(name);
    setNewName('');
  };

  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Jog tool</span>
          <select
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            className="rounded border border-white/[0.08] bg-white/[0.03] px-1 py-0.5 text-[10px] text-white/70"
          >
            {[1, 5, 20, 50, 100].map((s) => (
              <option key={s} value={s} className="bg-[#111]">
                {s} mm
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="space-y-1">
              <div className="text-center font-mono text-[10px] text-white/40">
                {axis.toUpperCase()} {tcp[axis].toFixed(0)}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 flex-1 px-0 font-mono text-xs" disabled={busy} onClick={() => jog(axis, -1)}>
                  −
                </Button>
                <Button size="sm" variant="outline" className="h-7 flex-1 px-0 font-mono text-xs" disabled={busy} onClick={() => jog(axis, 1)}>
                  +
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">Taught poses (mm)</div>
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_48px_48px_48px_42px_56px] gap-1 px-1 text-[9px] uppercase text-white/30">
            <span>Name</span>
            <span className="text-right">X</span>
            <span className="text-right">Y</span>
            <span className="text-right">Z</span>
            <span className="text-right" title="Tool angle (°): the direction the fingers close. Blank keeps the current angle.">Rz°</span>
            <span />
          </div>
          {poses.map((p) => (
            <div key={p.name} className="grid grid-cols-[1fr_48px_48px_48px_42px_56px] items-center gap-1 rounded px-1 py-0.5 hover:bg-white/[0.03]">
              <span className="truncate font-mono text-[11px] text-white/80" title={p.name}>
                {p.name}
              </span>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <input
                  key={axis}
                  type="number"
                  value={p[axis]}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange(poses.map((q) => (q.name === p.name ? { ...q, [axis]: Number(e.target.value) || 0 } : q)))
                  }
                  className={numCls}
                />
              ))}
              <input
                type="number"
                value={typeof p.rz === 'number' ? p.rz : ''}
                placeholder="—"
                disabled={disabled}
                title="Tool angle (°): the direction the fingers close. Blank keeps the current angle."
                onChange={(e) =>
                  onChange(
                    poses.map((q) =>
                      q.name === p.name ? { ...q, rz: e.target.value === '' ? null : wrap180(Number(e.target.value) || 0) } : q,
                    ),
                  )
                }
                className={numCls}
              />
              <div className="flex justify-end gap-0.5">
                <button title="Move here" disabled={busy} onClick={() => move(p)} className="rounded p-1 text-white/40 hover:text-sky-300 disabled:opacity-30">
                  <Navigation size={12} />
                </button>
                <button title="Teach: set to current tool position" disabled={busy} onClick={() => teach(p.name)} className="rounded p-1 text-white/40 hover:text-emerald-300 disabled:opacity-30">
                  <Crosshair size={12} />
                </button>
                <button
                  title="Delete pose"
                  disabled={disabled}
                  onClick={() => onChange(poses.filter((q) => q.name !== p.name))}
                  className="rounded p-1 text-white/40 hover:text-red-300 disabled:opacity-30"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPose()}
            placeholder="NEW_POSE"
            disabled={busy}
            className="flex-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[11px] uppercase text-white placeholder:text-white/20 focus:border-white/25 focus:outline-none"
          />
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !newName.trim()} onClick={addPose}>
            <Plus size={12} /> Teach here
          </Button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-white/30">
          Jog the tool to a spot, then teach it as a named pose. Blocks reference poses by name, so re-teaching a
          pose updates every block that uses it — just like a real teach pendant.
        </p>
      </div>
    </div>
  );
}

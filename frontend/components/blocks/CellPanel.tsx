"use client";

// Live cell status: production KPIs, digital I/O, joint readouts and scene setup.

import { DIGITAL_INPUTS, DIGITAL_OUTPUTS } from "@/lib/blocks/registry";
import { JOINT_LIMITS } from "@/lib/blocks/kinematics";
import type { PartColor, SceneConfig } from "@/lib/blocks/types";
import { param } from "@/lib/blocks/layout";
import type { World } from "@/lib/blocks/workcell";
import { useWorldVersion } from "@/lib/blocks/useWorld";

const COLORS: { id: PartColor; hex: string }[] = [
  { id: "red", hex: "#ef4444" },
  { id: "green", hex: "#22c55e" },
  { id: "blue", hex: "#3b82f6" },
  { id: "yellow", hex: "#facc15" },
];

function Led({ on, color = "#22c55e" }: { on: boolean; color?: string }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{
        background: on ? color : "#27272a",
        boxShadow: on ? `0 0 6px ${color}` : undefined,
      }}
    />
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {title}
      </div>
      {children}
    </div>
  );
}

export function CellPanel({
  world,
  running,
  scene,
  onSceneChange,
}: {
  world: World;
  running: boolean;
  scene: SceneConfig;
  onSceneChange: (s: SceneConfig) => void;
}) {
  useWorldVersion(world, 6);
  const counts = world.binCounts();
  const bins = world.layout.stations.filter((s) => s.kind === "bin");
  const elapsed = Math.max(0, world.time - world.stats.cycleStart);
  const placed = world.stats.places;
  const throughput = elapsed > 5 ? (placed / elapsed) * 60 : 0;
  const tcp = world.tcp;

  return (
    <div className="space-y-5 p-3 text-xs">
      <Section title="Production">
        <div className="grid grid-cols-3 gap-1.5">
          {[
            ["Picks", world.stats.picks],
            ["Placed", placed],
            ["Parts/min", throughput.toFixed(1)],
            ["Runtime", `${elapsed.toFixed(0)} s`],
            ["On pallet", world.palletCount()],
            ["Spawned", world.spawned],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5"
            >
              <div className="text-[9px] uppercase tracking-wider text-white/35">
                {label}
              </div>
              <div className="font-mono text-sm text-white/85">{value}</div>
            </div>
          ))}
        </div>
        {bins.length > 0 && (
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {bins.map((b) => (
              <div
                key={b.id}
                className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1"
              >
                <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-white/35">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-sm"
                    style={{ background: param(b, "color") }}
                  />
                  <span className="truncate">{b.name}</span>
                </div>
                <div className="font-mono text-sm text-white/85">
                  {counts[b.id] ?? 0}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Digital I/O">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <div className="space-y-1">
            {DIGITAL_INPUTS.map((d, i) => {
              const on = world.inputs[i];
              const isButton = i === 3;
              return (
                <button
                  key={d.value}
                  disabled={!isButton}
                  onPointerDown={() =>
                    isButton && (world.operatorButton = true)
                  }
                  onPointerUp={() => isButton && (world.operatorButton = false)}
                  onPointerLeave={() =>
                    isButton && (world.operatorButton = false)
                  }
                  className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[10px] ${isButton ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-default"} text-white/60`}
                  title={
                    isButton ? "Hold to press the operator button" : undefined
                  }
                >
                  <Led on={on} />
                  {d.label}
                </button>
              );
            })}
          </div>
          <div className="space-y-1">
            {DIGITAL_OUTPUTS.map((d, i) => (
              <button
                key={d.value}
                disabled={running}
                onClick={() => world.setOutput(i, !world.outputs[i])}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[10px] text-white/60 hover:bg-white/[0.04] disabled:hover:bg-transparent"
                title={running ? undefined : "Click to toggle (manual mode)"}
              >
                <Led
                  on={world.outputs[i]}
                  color={i === 3 ? "#ef4444" : i === 1 ? "#f59e0b" : "#22c55e"}
                />
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Robot">
        <div className="mb-2 flex gap-3 font-mono text-[11px] text-white/70">
          <span>X {tcp.x.toFixed(1)}</span>
          <span>Y {tcp.y.toFixed(1)}</span>
          <span>Z {tcp.z.toFixed(1)}</span>
          <span className="ml-auto text-white/45">
            {world.held
              ? "holding part"
              : world.gripperClosed
                ? "closed"
                : "open"}
          </span>
        </div>
        <div className="space-y-1">
          {world.joints.map((q, i) => {
            const [lo, hi] = JOINT_LIMITS[i];
            const pct = ((q - lo) / (hi - lo)) * 100;
            const near = pct < 5 || pct > 95;
            return (
              <div
                key={i}
                className="flex items-center gap-2 font-mono text-[10px]"
              >
                <span className="w-5 text-white/40">J{i + 1}</span>
                <div className="relative h-1.5 flex-1 rounded bg-white/[0.05]">
                  <div
                    className={`absolute top-0 h-1.5 w-1 rounded ${near ? "bg-amber-400" : "bg-violet-400"}`}
                    style={{
                      left: `calc(${Math.max(0, Math.min(100, pct))}% - 2px)`,
                    }}
                  />
                </div>
                <span className="w-12 text-right text-white/70">
                  {q.toFixed(1)}°
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Scene">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-white/50">Part colours</span>
            {COLORS.map((c) => {
              const on = scene.colors.includes(c.id);
              return (
                <button
                  key={c.id}
                  disabled={running}
                  onClick={() =>
                    onSceneChange({
                      ...scene,
                      colors: on
                        ? scene.colors.filter((x) => x !== c.id)
                        : [...scene.colors, c.id],
                    })
                  }
                  className={`h-5 w-5 rounded border ${on ? "border-white/70" : "border-transparent opacity-30"}`}
                  style={{ background: c.hex }}
                  title={c.id}
                />
              );
            })}
          </div>
          <label className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-white/50">Defect rate</span>
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.05}
              value={scene.defectRate}
              disabled={running}
              onChange={(e) =>
                onSceneChange({ ...scene, defectRate: Number(e.target.value) })
              }
              className="flex-1 accent-violet-400"
            />
            <span className="w-8 text-right font-mono text-[10px] text-white/60">
              {Math.round(scene.defectRate * 100)}%
            </span>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-white/50">Part limit</span>
            <input
              type="number"
              min={0}
              value={scene.maxParts}
              disabled={running}
              onChange={(e) =>
                onSceneChange({
                  ...scene,
                  maxParts: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-16 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-right font-mono text-[11px] text-white"
            />
            <span className="text-[10px] text-white/30">0 = endless feed</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 text-[11px] text-white/50">Tool trail</span>
            <input
              type="checkbox"
              checked={world.trailEnabled}
              onChange={(e) => {
                world.trailEnabled = e.target.checked;
                if (!e.target.checked) world.trail = [];
              }}
              className="accent-cyan-400"
            />
          </label>
        </div>
      </Section>
    </div>
  );
}

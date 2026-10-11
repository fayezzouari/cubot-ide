'use client';

// Sensors: live camera feeds with the colour detection overlaid, the detection
// settings (OpenCV units), and live readings of every other sensor, like
// MuJoCo's sensordata.

import { useEffect, useRef, useState } from 'react';
import { Camera, Plus, RotateCcw, ScanEye, Trash2 } from 'lucide-react';
import { DIGITAL_INPUTS, DIGITAL_OUTPUTS } from '@/lib/blocks/registry';
import { FINGER } from '@/lib/blocks/kinematics';
import { useWorldVersion } from '@/lib/blocks/useWorld';
import { analyze, DEFAULT_VISION, hsvCv, type ColorClass, type Frame, type VisionConfig, type VisionResult } from '@/lib/blocks/vision';
import { fingerOffset, type World } from '@/lib/blocks/workcell';

const SCALE = 2; // feed pixels per camera pixel
const FEED_MS = 200;

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {title}
        <span className="ml-auto normal-case tracking-normal">{right}</span>
      </div>
      {children}
    </div>
  );
}

function Num({
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
  className = 'w-12',
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
      }}
      className={`${className} rounded border border-white/[0.08] bg-white/[0.03] px-1 py-0.5 text-right font-mono text-[10px] text-white disabled:opacity-50`}
    />
  );
}

function Led({ on, color = '#22c55e' }: { on: boolean; color?: string }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: on ? color : '#27272a', boxShadow: on ? `0 0 6px ${color}` : undefined }}
    />
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Draws the frame scaled up, with the mask tinted and the ROI, bounding box
// and centroid on top.
function drawFeed(canvas: HTMLCanvasElement, frame: Frame, result: VisionResult, cfg: VisionConfig, showMask: boolean) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = frame;
  canvas.width = w * SCALE;
  canvas.height = h * SCALE;
  const img = new ImageData(new Uint8ClampedArray(frame.data), w, h);
  if (showMask && result.mask) {
    const swatch = cfg.classes.find((c) => c.name === result.color)?.swatch ?? '#ffffff';
    const [r, g, b] = hexToRgb(swatch);
    for (let i = 0; i < w * h; i++) {
      if (!result.mask[i]) continue;
      img.data[i * 4] = (img.data[i * 4] + r * 2) / 3;
      img.data[i * 4 + 1] = (img.data[i * 4 + 1] + g * 2) / 3;
      img.data[i * 4 + 2] = (img.data[i * 4 + 2] + b * 2) / 3;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, w * SCALE, h * SCALE);

  const { roi, bbox } = result;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(roi.x * SCALE + 0.5, roi.y * SCALE + 0.5, roi.w * SCALE, roi.h * SCALE);
  ctx.setLineDash([]);
  if (bbox) {
    ctx.strokeStyle = result.defect ? '#f87171' : '#4ade80';
    ctx.lineWidth = 2;
    ctx.strokeRect(bbox.x * SCALE, bbox.y * SCALE, bbox.w * SCALE, bbox.h * SCALE);
    const px = (roi.x + ((result.cx + 1) / 2) * roi.w) * SCALE;
    const py = (roi.y + ((result.cy + 1) / 2) * roi.h) * SCALE;
    ctx.beginPath();
    ctx.moveTo(px - 6, py);
    ctx.lineTo(px + 6, py);
    ctx.moveTo(px, py - 6);
    ctx.lineTo(px, py + 6);
    ctx.stroke();
  }
  const label = result.color === 'none' ? 'no part' : `${result.color} ${result.area.toFixed(0)}%${result.defect ? ' · DEFECT' : ''}`;
  ctx.font = '11px ui-monospace, monospace';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(4, 4, tw + 10, 17);
  ctx.fillStyle = result.defect ? '#fca5a5' : '#ffffff';
  ctx.fillText(label, 9, 16);
}

export function SensorsPanel({
  world,
  vision,
  running,
  onVisionChange,
}: {
  world: World;
  vision: VisionConfig;
  running: boolean;
  onVisionChange: (v: VisionConfig) => void;
}) {
  useWorldVersion(world, 4);
  const cameras = world.cameraSpecs();
  const [cameraId, setCameraId] = useState<string>(() => cameras[0]?.id ?? 'wrist');
  const [showMask, setShowMask] = useState(true);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [probe, setProbe] = useState<{ x: number; y: number; hsv: [number, number, number]; rgb: [number, number, number] } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<Frame | null>(null);
  const visionRef = useRef(vision);
  visionRef.current = vision;
  const live = !!world.captureCamera;
  const active = cameras.find((c) => c.id === cameraId) ?? cameras[0];

  // Live feed: capture and analyse a few times a second.
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const spec = world.cameraSpecs().find((c) => c.id === active.id);
      const frame = spec && world.captureCamera?.(spec);
      if (!frame || !canvas.current) return;
      frameRef.current = frame;
      const r = analyze(frame, visionRef.current);
      setResult(r);
      drawFeed(canvas.current, frame, r, visionRef.current, showMask);
    };
    tick();
    const t = setInterval(tick, FEED_MS);
    return () => clearInterval(t);
  }, [world, active?.id, showMask]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const f = frameRef.current;
    const el = canvas.current;
    if (!f || !el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * f.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * f.height);
    if (x < 0 || y < 0 || x >= f.width || y >= f.height) return;
    const i = (y * f.width + x) * 4;
    const rgb: [number, number, number] = [f.data[i], f.data[i + 1], f.data[i + 2]];
    setProbe({ x, y, rgb, hsv: hsvCv(...rgb) });
  };

  const setClass = (k: number, patch: Partial<ColorClass>) =>
    onVisionChange({ ...vision, classes: vision.classes.map((c, i) => (i === k ? { ...c, ...patch } : c)) });

  const last = world.lastVision;
  const tcp = world.tcp;
  const opening = Math.max(0, 2 * fingerOffset(world.gripperWidth) - FINGER.thickness);

  return (
    <div className="space-y-5 p-3 text-xs">
      <Section
        title="Camera feed"
        right={
          <label className="flex items-center gap-1 text-[10px] text-white/45">
            <input type="checkbox" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} className="accent-violet-400" />
            mask
          </label>
        }
      >
        <div className="mb-2 flex flex-wrap gap-1">
          {cameras.map((c) => (
            <button
              key={c.id}
              onClick={() => setCameraId(c.id)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] ${c.id === active?.id ? 'bg-violet-500/20 text-white' : 'bg-white/[0.03] text-white/55 hover:text-white'}`}
            >
              <Camera size={11} /> {c.name}
            </button>
          ))}
        </div>
        {live ? (
          <>
            <canvas
              ref={canvas}
              onMouseMove={onMove}
              onMouseLeave={() => setProbe(null)}
              className="w-full rounded border border-white/[0.08] bg-black [image-rendering:pixelated]"
              style={{ aspectRatio: '4 / 3' }}
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-white/45">
              <span>
                {probe
                  ? `px ${probe.x},${probe.y}  H ${probe.hsv[0].toFixed(0)}  S ${probe.hsv[1].toFixed(0)}  V ${probe.hsv[2].toFixed(0)}`
                  : 'hover the image for HSV values'}
              </span>
              <span>160×120</span>
            </div>
          </>
        ) : (
          <div className="rounded border border-white/[0.08] p-3 text-[11px] text-white/45">
            Camera images need the 3D view. Without it, inspections use the simulation state (ground truth).
          </div>
        )}
        {result && (
          <div className="mt-2 space-y-1">
            {vision.classes.map((c) => {
              const v = result.scores[c.name] ?? 0;
              return (
                <div key={c.name} className="flex items-center gap-2 font-mono text-[10px]">
                  <span className="h-2 w-2 rounded-sm" style={{ background: c.swatch }} />
                  <span className="w-14 truncate text-white/60">{c.name}</span>
                  <div className="relative h-1.5 flex-1 rounded bg-white/[0.05]">
                    <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(100, v)}%`, background: c.swatch, opacity: 0.8 }} />
                    <div className="absolute inset-y-0 w-px bg-white/50" style={{ left: `${vision.minArea}%` }} title="minimum area" />
                  </div>
                  <span className="w-10 text-right text-white/60">{v.toFixed(1)}%</span>
                </div>
              );
            })}
            <div className="font-mono text-[10px] text-white/45">
              centroid {result.cx.toFixed(2)}, {result.cy.toFixed(2)} · dark marks {result.defectPixels}px
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Last inspection"
        right={
          <button
            disabled={running || !active}
            onClick={() => world.inspect(active!.id)}
            className="flex items-center gap-1 rounded border border-white/[0.08] px-2 py-0.5 text-[10px] text-white/65 hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
            title="Inspect with the selected camera now"
          >
            <ScanEye size={11} /> Inspect now
          </button>
        }
      >
        {last ? (
          <div className="space-y-0.5 font-mono text-[10px] text-white/60">
            <div>
              {last.cameraName} · t={last.time.toFixed(1)} s ·{' '}
              <span className={last.source === 'camera' ? 'text-emerald-300' : 'text-amber-300'}>{last.source}</span>
            </div>
            <div className="text-white/85">
              part_color={JSON.stringify(last.color)} part_defect={String(last.defect)} part_area={last.area.toFixed(1)} part_cx=
              {last.cx.toFixed(2)} part_cy={last.cy.toFixed(2)}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-white/35">No inspection yet. Run a program with a Vision inspect block, or press Inspect now.</div>
        )}
      </Section>

      <Section
        title="Detection (OpenCV units)"
        right={
          <button
            disabled={running}
            onClick={() => onVisionChange(structuredClone(DEFAULT_VISION))}
            className="flex items-center gap-1 text-[10px] text-white/45 hover:text-white disabled:opacity-40"
            title="Restore the default classes and thresholds"
          >
            <RotateCcw size={10} /> defaults
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-white/55">
          <label className="flex items-center justify-between gap-2" title="Centre crop of the image that is analysed">
            ROI size % <Num value={Math.round(vision.roi * 100)} min={10} max={100} disabled={running} onChange={(v) => onVisionChange({ ...vision, roi: v / 100 })} />
          </label>
          <label className="flex items-center justify-between gap-2" title="A colour must cover this much of the ROI to count as a part">
            Min area % <Num value={vision.minArea} min={0.5} max={90} step={0.5} disabled={running} onChange={(v) => onVisionChange({ ...vision, minArea: v })} />
          </label>
          <label className="flex items-center justify-between gap-2" title="Pixels darker than this inside a part count as defect marks">
            Defect V &lt; <Num value={vision.defectV} min={0} max={255} disabled={running} onChange={(v) => onVisionChange({ ...vision, defectV: v })} />
          </label>
          <label className="flex items-center justify-between gap-2" title="Share of the part that must be marks to flag a defect">
            Defect area % <Num value={vision.defectArea} min={0.1} max={50} step={0.5} disabled={running} onChange={(v) => onVisionChange({ ...vision, defectArea: v })} />
          </label>
        </div>
        <div className="mt-3 space-y-1">
          <div className="grid grid-cols-[18px_1fr_40px_40px_40px_40px_18px] gap-1 px-0.5 text-[9px] uppercase text-white/30">
            <span />
            <span>Class</span>
            <span className="text-right">H lo</span>
            <span className="text-right">H hi</span>
            <span className="text-right">S min</span>
            <span className="text-right">V min</span>
            <span />
          </div>
          {vision.classes.map((c, k) => (
            <div key={k} className="grid grid-cols-[18px_1fr_40px_40px_40px_40px_18px] items-center gap-1">
              <input
                type="color"
                value={c.swatch}
                disabled={running}
                onChange={(e) => setClass(k, { swatch: e.target.value })}
                className="h-4 w-4 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Overlay colour"
              />
              <input
                value={c.name}
                disabled={running}
                onChange={(e) => setClass(k, { name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
                className="min-w-0 rounded border border-white/[0.08] bg-white/[0.03] px-1 py-0.5 font-mono text-[10px] text-white"
                title="Value of part_color when this class wins"
              />
              <Num className="w-full" value={c.hLow} min={0} max={180} disabled={running} onChange={(v) => setClass(k, { hLow: v })} />
              <Num className="w-full" value={c.hHigh} min={0} max={180} disabled={running} onChange={(v) => setClass(k, { hHigh: v })} />
              <Num className="w-full" value={c.sMin} min={0} max={255} disabled={running} onChange={(v) => setClass(k, { sMin: v })} />
              <Num className="w-full" value={c.vMin} min={0} max={255} disabled={running} onChange={(v) => setClass(k, { vMin: v })} />
              <button
                disabled={running}
                onClick={() => onVisionChange({ ...vision, classes: vision.classes.filter((_, i) => i !== k) })}
                className="text-white/30 hover:text-red-400 disabled:opacity-30"
                title="Remove class"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <button
            disabled={running}
            onClick={() =>
              onVisionChange({
                ...vision,
                classes: [...vision.classes, { name: `class${vision.classes.length + 1}`, swatch: '#a855f7', hLow: 135, hHigh: 160, sMin: 90, vMin: 60 }],
              })
            }
            className="mt-1 flex items-center gap-1 text-[10px] text-white/50 hover:text-white disabled:opacity-40"
          >
            <Plus size={11} /> Add colour class
          </button>
          <p className="pt-1 text-[10px] leading-relaxed text-white/30">
            Hue runs 0–180 as in OpenCV; set H lo above H hi to wrap around red. The same settings are exported to the Python
            program&apos;s VISION config.
          </p>
        </div>
      </Section>

      <Section title="Sensor readings">
        <div className="space-y-1 font-mono text-[10px] text-white/65">
          {world.conveyors.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <Led on={world.conveyorHasPart(c)} /> photo-eye · {c.name}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Led on={!!world.held} color="#a78bfa" /> gripper · {world.held ? 'holding' : world.gripperClosed ? 'closed' : 'open'} · {opening.toFixed(0)} mm
          </div>
          {world.machine && (
            <div className="flex items-center gap-2">
              <Led on={world.machineRunning} color="#f59e0b" /> machine · {world.machineRunning ? 'cycling' : world.machineDone ? 'done' : 'idle'}
            </div>
          )}
          <div>
            tcp · {tcp.x.toFixed(1)}, {tcp.y.toFixed(1)}, {tcp.z.toFixed(1)} mm
          </div>
          <div>joints · {world.joints.map((q) => q.toFixed(1)).join(', ')}°</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {DIGITAL_INPUTS.map((d, i) => (
              <span key={d.value} className="flex items-center gap-1" title={d.label}>
                <Led on={world.inputs[i]} /> DI{i}
              </span>
            ))}
            {DIGITAL_OUTPUTS.map((d, i) => (
              <span key={d.value} className="flex items-center gap-1" title={d.label}>
                <Led on={world.outputs[i]} color="#f59e0b" /> DO{i}
              </span>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

'use client';

// Environment editor: build the cell around the robot. Stations can be added
// from a palette, edited numerically here, or dragged in the 3D view. Whole
// environments come from presets, the user's saved library, or a JSON file.

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Box,
  Boxes,
  Copy,
  Crosshair,
  Download,
  Factory,
  Fence,
  Grid3x3,
  Layers,
  RotateCcw,
  RotateCw,
  Save,
  Siren,
  Table,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  anchorPose,
  BIN_COLORS,
  cloneLayout,
  ENVIRONMENT_PRESETS,
  faceRobotRotation,
  modelDims,
  param,
  parseLayout,
  STATION_KINDS,
  UNIT_MM,
  type CellLayout,
  type ModelSource,
  type ModelUnit,
  type LayoutIssue,
  type Station,
  type StationKind,
} from '@/lib/blocks/layout';
import type { Pose } from '@/lib/blocks/types';
import { downloadText } from './CodeDialog';
import { MODEL_ACCEPT, readModelFile } from './ModelLoader';

const KIND_ICONS: Record<StationKind, typeof Factory> = {
  conveyor: ArrowRightLeft,
  bin: Archive,
  pallet: Layers,
  machine: Factory,
  tray: Grid3x3,
  table: Table,
  fence: Fence,
  beacon: Siren,
  model: Box,
};

const LIBRARY_KEY = 'cubot-blocks-environments';

interface SavedEnvironment {
  id: string;
  title: string;
  layout: CellLayout;
  savedAt: string;
}

function readLibrary(): SavedEnvironment[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.title === 'string' && parseLayout(e.layout)) : [];
  } catch {
    return [];
  }
}

function writeLibrary(items: SavedEnvironment[]): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

function modelSizeLabel(s: Station) {
  const { w, d, h } = modelDims(s);
  return `${Math.round(w)} × ${Math.round(d)} × ${Math.round(h)} mm`;
}

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

// Number input that keeps the raw text while typing and commits valid values.
function NumField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    const c = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
    if (c !== value) onCommit(c);
  };
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-white/50">{label}</span>
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          commit(text);
          setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-20 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-right font-mono text-[11px] text-white disabled:opacity-50"
      />
      {unit && <span className="text-[10px] text-white/30">{unit}</span>}
    </label>
  );
}

export function EnvironmentPanel({
  layout,
  poses,
  issues,
  selectedId,
  disabled,
  onSelect,
  onAdd,
  onChange,
  onDelete,
  onDuplicate,
  onApply,
  onResetPose,
  onImportModel,
}: {
  layout: CellLayout;
  poses: Pose[];
  issues: LayoutIssue[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (kind: StationKind) => void;
  onChange: (id: string, patch: Partial<Station>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onApply: (layout: CellLayout, title: string) => void;
  onResetPose: (id: string) => void;
  onImportModel: (model: ModelSource) => void;
}) {
  const [library, setLibrary] = useState<SavedEnvironment[]>([]);
  const [saveName, setSaveName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const importModel = async (file: File) => {
    setImporting(true);
    try {
      onImportModel(await readModelFile(file));
    } catch (e) {
      toast.error(`Could not import ${file.name}: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };
  useEffect(() => setLibrary(readLibrary()), []);

  const selected = layout.stations.find((s) => s.id === selectedId) ?? null;
  const issuesFor = (id: string) => issues.filter((i) => i.stationId === id);

  const saveToLibrary = () => {
    const title = saveName.trim();
    if (!title) return;
    const items = [
      { id: `${Date.now().toString(36)}`, title, layout: cloneLayout(layout), savedAt: new Date().toISOString() },
      ...library.filter((e) => e.title !== title),
    ];
    if (!writeLibrary(items)) {
      toast.error('This browser blocks local storage — use Export instead.');
      return;
    }
    setLibrary(items);
    setSaveName('');
    toast.success(`Saved “${title}” to your environments`);
  };

  const removeFromLibrary = (id: string) => {
    const items = library.filter((e) => e.id !== id);
    writeLibrary(items);
    setLibrary(items);
  };

  const importFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      // Accept a bare layout, an environment export or a whole project file.
      const layoutRaw = raw?.stations ? raw : (raw?.layout ?? raw?.settings?.layout);
      const parsed = parseLayout(layoutRaw);
      if (!parsed) throw new Error('no stations found');
      onApply(parsed, String(raw?.title ?? file.name.replace(/\.json$/, '')));
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
  };

  const linkedPose = selected?.pose ? poses.find((p) => p.name === selected.pose) : undefined;
  const anchor = selected ? anchorPose(selected) : null;
  const poseMoved = linkedPose && anchor && (linkedPose.x !== anchor.x || linkedPose.y !== anchor.y || linkedPose.z !== anchor.z);

  return (
    <div className="space-y-5 p-3 text-xs">
      {disabled && (
        <div className="rounded border border-amber-400/30 bg-amber-400/[0.06] px-2 py-1.5 text-[11px] text-amber-200/80">
          Stop the program to edit the environment.
        </div>
      )}

      <Section title="Environment">
        <div className="space-y-1.5">
          <select
            value=""
            disabled={disabled}
            onChange={(e) => {
              const [source, id] = e.target.value.split(':');
              const env =
                source === 'preset'
                  ? ENVIRONMENT_PRESETS.find((p) => p.id === id)
                  : library.find((l) => l.id === id);
              if (env) onApply(env.layout, env.title);
            }}
            className="w-full rounded border border-white/[0.08] bg-[#111] px-2 py-1 text-[11px] text-white/80"
          >
            <option value="">Load an environment…</option>
            <optgroup label="Presets">
              {ENVIRONMENT_PRESETS.map((p) => (
                <option key={p.id} value={`preset:${p.id}`}>
                  {p.title} — {p.description}
                </option>
              ))}
            </optgroup>
            {library.length > 0 && (
              <optgroup label="My environments">
                {library.map((l) => (
                  <option key={l.id} value={`saved:${l.id}`}>
                    {l.title} ({l.layout.stations.length} stations)
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <div className="flex gap-1.5">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveToLibrary()}
              placeholder="Name this environment…"
              className="min-w-0 flex-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-white placeholder:text-white/25"
            />
            <button
              onClick={saveToLibrary}
              disabled={!saveName.trim()}
              className="flex items-center gap-1 rounded border border-white/[0.08] px-2 text-[11px] text-white/70 hover:bg-white/[0.05] disabled:opacity-40"
              title="Save to My environments (this browser)"
            >
              <Save size={12} /> Save
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() =>
                downloadText(
                  'environment.cubot-env.json',
                  JSON.stringify({ title: saveName.trim() || 'My environment', ...cloneLayout(layout) }, null, 2),
                )
              }
              className="flex flex-1 items-center justify-center gap-1 rounded border border-white/[0.08] py-1 text-[11px] text-white/60 hover:bg-white/[0.05]"
            >
              <Download size={12} /> Export
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={disabled}
              className="flex flex-1 items-center justify-center gap-1 rounded border border-white/[0.08] py-1 text-[11px] text-white/60 hover:bg-white/[0.05] disabled:opacity-40"
            >
              <Upload size={12} /> Import
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
          </div>
          {library.length > 0 && (
            <div className="space-y-0.5 pt-1">
              {library.map((l) => (
                <div key={l.id} className="group flex items-center gap-2 rounded px-1 py-0.5 text-[11px] text-white/55 hover:bg-white/[0.03]">
                  <Boxes size={11} className="text-white/30" />
                  <button className="flex-1 truncate text-left hover:text-white" disabled={disabled} onClick={() => onApply(l.layout, l.title)}>
                    {l.title}
                  </button>
                  <button
                    onClick={() => removeFromLibrary(l.id)}
                    className="hidden text-white/30 hover:text-red-400 group-hover:block"
                    title="Remove from My environments"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Add station">
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(STATION_KINDS) as StationKind[]).filter((k) => k !== 'model').map((kind) => {
            const info = STATION_KINDS[kind];
            const Icon = KIND_ICONS[kind];
            const taken = info.unique && layout.stations.some((s) => s.kind === kind);
            return (
              <button
                key={kind}
                disabled={disabled || taken}
                onClick={() => onAdd(kind)}
                className="flex flex-col items-center gap-1 rounded border border-white/[0.06] bg-white/[0.02] px-1 py-2 text-[10px] text-white/65 hover:border-violet-400/40 hover:text-white disabled:opacity-30 disabled:hover:border-white/[0.06]"
                title={taken ? `${info.label}: only one per cell` : info.description}
              >
                <Icon size={15} />
                <span className="truncate">{info.label}</span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => modelInput.current?.click()}
          disabled={disabled || importing}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-white/15 py-2 text-[11px] text-white/65 hover:border-violet-400/50 hover:text-white disabled:opacity-40"
          title="Add your own equipment from a .glb, .gltf, .stl or .obj file (max 5 MB)"
        >
          <Upload size={12} /> {importing ? 'Reading model…' : 'Import 3D model (.glb .gltf .stl .obj)'}
        </button>
        <input
          ref={modelInput}
          type="file"
          accept={MODEL_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importModel(f);
            e.target.value = '';
          }}
        />
      </Section>

      <Section title={`Stations (${layout.stations.length})`}>
        {layout.stations.length === 0 ? (
          <div className="text-[11px] text-white/35">Empty floor. Add a station above or load a preset.</div>
        ) : (
          <div className="space-y-0.5">
            {layout.stations.map((s) => {
              const Icon = KIND_ICONS[s.kind];
              const list = issuesFor(s.id);
              const err = list.some((i) => i.severity === 'error');
              return (
                <button
                  key={s.id}
                  onClick={() => onSelect(s.id === selectedId ? null : s.id)}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] ${s.id === selectedId ? 'bg-violet-500/15 text-white' : 'text-white/65 hover:bg-white/[0.04]'}`}
                >
                  <Icon size={12} style={s.kind === 'bin' ? { color: param(s, 'color') } : undefined} className="shrink-0 text-white/40" />
                  <span className="flex-1 truncate">{s.name}</span>
                  {s.pose && <span className="font-mono text-[9px] text-white/30">{s.pose}</span>}
                  {list.length > 0 && <AlertTriangle size={11} className={err ? 'text-red-400' : 'text-amber-300'} />}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {selected && (
        <Section
          title={STATION_KINDS[selected.kind].label}
          right={
            <span className="flex gap-1">
              <button
                onClick={() => onDuplicate(selected.id)}
                disabled={disabled || STATION_KINDS[selected.kind].unique}
                className="rounded p-1 text-white/45 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                title="Duplicate"
              >
                <Copy size={12} />
              </button>
              <button
                onClick={() => onDelete(selected.id)}
                disabled={disabled}
                className="rounded p-1 text-white/45 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
                title="Remove station"
              >
                <Trash2 size={12} />
              </button>
            </span>
          }
        >
          <div className="space-y-2">
            <p className="text-[10px] leading-relaxed text-white/35">{STATION_KINDS[selected.kind].description}</p>
            <label className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] text-white/50">Name</span>
              <input
                value={selected.name}
                disabled={disabled}
                onChange={(e) => onChange(selected.id, { name: e.target.value })}
                className="min-w-0 flex-1 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-white"
              />
            </label>
            <NumField label="X" unit="mm" value={selected.x} step={10} min={-1300} max={1300} disabled={disabled} onCommit={(x) => onChange(selected.id, { x })} />
            <NumField label="Z" unit="mm" value={selected.z} step={10} min={-1100} max={1100} disabled={disabled} onCommit={(z) => onChange(selected.id, { z })} />
            <div className="flex items-center gap-2">
              <NumField label="Rotation" unit="°" value={selected.rot} step={15} min={-180} max={180} disabled={disabled} onCommit={(rot) => onChange(selected.id, { rot })} />
              <button
                disabled={disabled}
                onClick={() => onChange(selected.id, { rot: ((selected.rot + 195) % 360) - 180 })}
                className="rounded p-1 text-white/45 hover:bg-white/[0.06] hover:text-white"
                title="Rotate 15° (R)"
              >
                <RotateCcw size={12} />
              </button>
              <button
                disabled={disabled}
                onClick={() => onChange(selected.id, { rot: ((selected.rot + 165 + 360) % 360) - 180 })}
                className="rounded p-1 text-white/45 hover:bg-white/[0.06] hover:text-white"
                title="Rotate -15° (Shift+R)"
              >
                <RotateCw size={12} />
              </button>
            </div>
            {(selected.kind === 'conveyor' || selected.kind === 'machine') && (
              <button
                disabled={disabled}
                onClick={() => onChange(selected.id, { rot: faceRobotRotation(selected) })}
                className="ml-[88px] flex items-center gap-1 rounded border border-white/[0.08] px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/[0.05]"
                title={selected.kind === 'conveyor' ? 'Point the belt at the robot' : 'Turn the machine door towards the robot'}
              >
                <Crosshair size={11} /> Face the robot
              </button>
            )}

            {selected.kind === 'conveyor' && (
              <NumField label="Length" unit="mm" value={param(selected, 'length')} step={50} min={300} max={1600} disabled={disabled} onCommit={(length) => onChange(selected.id, { length })} />
            )}
            {selected.kind === 'conveyor' && (
              <label className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] text-white/50">Camera side</span>
                <select
                  value={selected.camSide === -1 ? '-1' : '1'}
                  disabled={disabled}
                  onChange={(e) => onChange(selected.id, { camSide: e.target.value === '-1' ? -1 : 1 })}
                  className="rounded border border-white/[0.08] bg-[#111] px-1.5 py-0.5 text-[11px] text-white/80"
                >
                  <option value="1">Left of the flow</option>
                  <option value="-1">Right of the flow</option>
                </select>
                <span className="text-[10px] text-white/30">keep it away from the robot</span>
              </label>
            )}
            {(selected.kind === 'bin' || selected.kind === 'pallet') && (
              <NumField
                label="Size"
                unit="mm"
                value={param(selected, 'size')}
                step={10}
                min={selected.kind === 'bin' ? 100 : 150}
                max={selected.kind === 'bin' ? 320 : 500}
                disabled={disabled}
                onCommit={(size) => onChange(selected.id, { size })}
              />
            )}
            {selected.kind === 'bin' && (
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] text-white/50">Colour</span>
                {BIN_COLORS.map((c) => (
                  <button
                    key={c}
                    disabled={disabled}
                    onClick={() => onChange(selected.id, { color: c })}
                    className={`h-4 w-4 rounded border ${param(selected, 'color') === c ? 'border-white' : 'border-transparent'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            )}
            {selected.kind === 'machine' && (
              <NumField label="Cycle time" unit="s" value={param(selected, 'cycle')} step={0.5} min={0.5} max={60} disabled={disabled} onCommit={(cycle) => onChange(selected.id, { cycle })} />
            )}
            {selected.kind === 'tray' && (
              <>
                <NumField label="Rows" value={param(selected, 'rows')} min={1} max={5} disabled={disabled} onCommit={(rows) => onChange(selected.id, { rows: Math.round(rows) })} />
                <NumField label="Columns" value={param(selected, 'cols')} min={1} max={6} disabled={disabled} onCommit={(cols) => onChange(selected.id, { cols: Math.round(cols) })} />
                <p className="text-[10px] text-white/35">Slots are 70 mm apart. Pick slot (row r, column c) with offsets from the {selected.pose ?? 'tray'} pose.</p>
              </>
            )}
            {selected.kind === 'table' && (
              <>
                <NumField label="Width" unit="mm" value={param(selected, 'w')} step={10} min={100} max={1500} disabled={disabled} onCommit={(w) => onChange(selected.id, { w })} />
                <NumField label="Depth" unit="mm" value={param(selected, 'd')} step={10} min={100} max={1000} disabled={disabled} onCommit={(d) => onChange(selected.id, { d })} />
                <NumField label="Height" unit="mm" value={param(selected, 'h')} step={10} min={20} max={500} disabled={disabled} onCommit={(h) => onChange(selected.id, { h })} />
              </>
            )}
            {selected.kind === 'fence' && (
              <>
                <NumField label="Length" unit="mm" value={param(selected, 'length')} step={50} min={100} max={2500} disabled={disabled} onCommit={(length) => onChange(selected.id, { length })} />
                <NumField label="Height" unit="mm" value={param(selected, 'h')} step={50} min={100} max={1500} disabled={disabled} onCommit={(h) => onChange(selected.id, { h })} />
              </>
            )}

            {selected.kind === 'model' && selected.model && (
              <>
                <div className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 font-mono text-[10px] text-white/50">
                  {selected.model.file} · {selected.model.format.toUpperCase()} · {(selected.model.bytes / 1024).toFixed(0)} KB
                </div>
                <label className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-white/50">File units</span>
                  <select
                    value={selected.model.unit}
                    disabled={disabled}
                    onChange={(e) => onChange(selected.id, { model: { ...selected.model!, unit: e.target.value as ModelUnit } })}
                    className="rounded border border-white/[0.08] bg-[#111] px-1.5 py-0.5 text-[11px] text-white/80"
                  >
                    {(Object.keys(UNIT_MM) as ModelUnit[]).map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-white/30">glTF is metres; CAD is usually mm</span>
                </label>
                <NumField label="Scale" unit="×" value={selected.scale ?? 1} step={0.1} min={0.01} max={100} disabled={disabled} onCommit={(scale) => onChange(selected.id, { scale })} />
                <label className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-white/50">Z-up file</span>
                  <input
                    type="checkbox"
                    checked={selected.model.zUp}
                    disabled={disabled}
                    onChange={(e) => onChange(selected.id, { model: { ...selected.model!, zUp: e.target.checked } })}
                    className="accent-violet-400"
                  />
                  <span className="text-[10px] text-white/30">tick if the model lies on its side</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-white/50">Solid</span>
                  <input
                    type="checkbox"
                    checked={selected.solid !== false}
                    disabled={disabled}
                    onChange={(e) => onChange(selected.id, { solid: e.target.checked })}
                    className="accent-violet-400"
                  />
                  <span className="text-[10px] text-white/30">collides and holds parts on top</span>
                </label>
                {(selected.model.format === 'stl' || selected.model.format === 'obj') && (
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-[11px] text-white/50">Colour</span>
                    {['#a1a1aa', '#e5e7eb', '#334155', '#f97316', '#2563eb', '#16a34a', '#eab308'].map((c) => (
                      <button
                        key={c}
                        disabled={disabled}
                        onClick={() => onChange(selected.id, { color: c })}
                        className={`h-4 w-4 rounded border ${param(selected, 'color') === c ? 'border-white' : 'border-transparent'}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-white/35">
                  Size {modelSizeLabel(selected)}. The bounding box is used for collisions and as the surface parts rest on.
                </p>
              </>
            )}

            {selected.pose && (
              <div className="mt-1 rounded border border-white/[0.06] bg-white/[0.02] p-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-white/50">Pose</span>
                  <span className="font-mono text-white/85">{selected.pose}</span>
                  {linkedPose ? (
                    <span className="ml-auto font-mono text-[10px] text-white/40">
                      {linkedPose.x}, {linkedPose.y}, {linkedPose.z}
                    </span>
                  ) : (
                    <span className="ml-auto text-[10px] text-amber-300">deleted</span>
                  )}
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                  Moves with the station. Use it in Pick / Place / Move blocks.
                </p>
                {(!linkedPose || poseMoved) && (
                  <button
                    disabled={disabled}
                    onClick={() => onResetPose(selected.id)}
                    className="mt-1.5 rounded border border-white/[0.08] px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/[0.05]"
                    title="Put the pose back at the station's reference point"
                  >
                    {linkedPose ? 'Reset pose to station' : 'Create pose'}
                  </button>
                )}
              </div>
            )}

            {issuesFor(selected.id).map((i, n) => (
              <div key={n} className={`flex items-start gap-1.5 text-[11px] ${i.severity === 'error' ? 'text-red-300' : 'text-amber-200/80'}`}>
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                {i.message}
              </div>
            ))}
          </div>
        </Section>
      )}

      {issues.length > 0 && !selected && (
        <Section title="Layout checks">
          <div className="space-y-1">
            {issues.map((i, n) => (
              <button
                key={n}
                onClick={() => onSelect(i.stationId)}
                className={`flex w-full items-start gap-1.5 text-left text-[11px] ${i.severity === 'error' ? 'text-red-300' : 'text-amber-200/80'}`}
              >
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                {i.message}
              </button>
            ))}
          </div>
        </Section>
      )}

      <p className="text-[10px] leading-relaxed text-white/30">
        Tip: open the <b>Top</b> view and drag stations. Every station that owns a pose carries it along, so programs keep working.
        The environment is saved with the program.
      </p>
    </div>
  );
}

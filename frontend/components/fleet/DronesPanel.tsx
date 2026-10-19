'use client';

import { Plane, Plus, Trash2, Waypoints } from 'lucide-react';
import type { Category, Drone, Task, Vec3 } from '@/lib/fleet/types';
import type { DroneUpdate } from '@/lib/api/fleet';
import { DRONE_STATUS_COLOR } from '@/lib/fleet/constants';
import { EmptyHint, PanelShell } from './PanelShell';
import { SequenceControls } from './SequenceControls';
import { LiveDot } from './LiveDot';
import { chipBtnCls, fieldCls, iconBtnCls } from './theme';

interface Props {
  drones: Drone[];
  categories: Category[];
  tasks: Task[];
  selectedId: string | null;
  placing: boolean;
  onSelect: (id: string | null) => void;
  onPlace: () => void;
  onEdit: (id: string, body: DroneUpdate) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReassign: () => Promise<void>;
  onStartSequence: (id: string) => Promise<void>;
  onAdvanceSequence: (id: string) => Promise<void>;
  onStopSequence: (id: string) => Promise<void>;
  liveConnectedIds?: Set<string>;
}

function commitNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const AXES: { axis: keyof Vec3; title: string; min?: number; max?: number }[] = [
  { axis: 'x', title: 'x position' },
  { axis: 'y', title: 'y position' },
  { axis: 'z', title: 'Cruise altitude, metres', min: 0, max: 50 },
];

export function DronesPanel({
  drones,
  categories,
  tasks,
  selectedId,
  placing,
  onSelect,
  onPlace,
  onEdit,
  onDelete,
  onReassign,
  onStartSequence,
  onAdvanceSequence,
  onStopSequence,
  liveConnectedIds,
}: Props) {
  const sequenceTotal = (droneId: string) =>
    tasks.filter((t) => t.assigned_drone_id === droneId && t.sequence_index !== null).length;

  return (
    <PanelShell
      title="Drones"
      icon={<Plane size={12} />}
      actions={
        <>
          <button onClick={() => void onReassign()} className={chipBtnCls} title="Assign open aerial tasks to the nearest eligible drone">
            <Waypoints size={11} /> <span className="@max-[260px]:hidden">Reassign</span>
          </button>
          <button
            onClick={onPlace}
            className={`${chipBtnCls} ${placing ? 'border-emerald-400/50 text-emerald-200' : ''}`}
            title="Place a drone on the map"
          >
            <Plus size={11} /> <span className="@max-[220px]:hidden">Place</span>
          </button>
        </>
      }
    >
      {drones.length === 0 ? (
        <EmptyHint>No drones yet. Click Place, then click the map.</EmptyHint>
      ) : (
        <ul>
          {drones.map((d) => {
            const selected = d.id === selectedId;
            return (
              <li
                key={d.id}
                className={`border-b border-white/[0.05] px-3 py-2.5 transition-colors last:border-0 ${
                  selected ? 'bg-white/[0.05]' : 'hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={d.color}
                    onChange={(e) => void onEdit(d.id, { color: e.target.value })}
                    className="h-4 w-4 cursor-pointer rounded-full border-0 bg-transparent p-0"
                    title="Colour"
                  />
                  <input
                    key={`${d.id}-${d.name}`}
                    defaultValue={d.name}
                    onClick={() => onSelect(selected ? null : d.id)}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== d.name) void onEdit(d.id, { name: v });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-white/85 outline-none"
                  />
                  <LiveDot
                    live={!!liveConnectedIds}
                    connected={!!liveConnectedIds?.has(d.id)}
                    color={DRONE_STATUS_COLOR[d.status]}
                    status={d.status}
                  />
                  <button onClick={() => void onDelete(d.id)} className={`${iconBtnCls} hover:text-red-400`} aria-label="Delete drone">
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6 text-[10px] text-white/40">
                  <span className="truncate font-mono text-white/60" title="uav serial">
                    {d.serial_number}
                  </span>
                  {selected &&
                    AXES.map(({ axis, title, min, max }) => (
                      <label key={axis} className="inline-flex items-center gap-1">
                        <span>{axis}</span>
                        <input
                          key={`${d.id}-${axis}-${d.position[axis]}`}
                          type="number"
                          step={0.5}
                          min={min}
                          max={max}
                          defaultValue={d.position[axis]}
                          onBlur={(e) => {
                            const n = commitNumber(e.target.value, d.position[axis]);
                            if (n !== d.position[axis]) void onEdit(d.id, { position: { ...d.position, [axis]: n } });
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          className={`${fieldCls} w-14 font-mono`}
                          title={title}
                        />
                      </label>
                    ))}
                  <span>speed</span>
                  <input
                    key={`${d.id}-speed-${d.speed}`}
                    type="number"
                    min={0.5}
                    max={20}
                    step={0.5}
                    defaultValue={d.speed}
                    onBlur={(e) => {
                      const n = commitNumber(e.target.value, d.speed);
                      if (n !== d.speed) void onEdit(d.id, { speed: n });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    className={`${fieldCls} w-14 font-mono`}
                  />
                  <span>category</span>
                  <select
                    value={d.category_id ?? ''}
                    onChange={(e) => void onEdit(d.id, { category_id: e.target.value || null })}
                    className={`${fieldCls} min-w-0 flex-1`}
                    title="This drone only works on tasks in this category"
                  >
                    <option value="" className="bg-[#111]">
                      any
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id} className="bg-[#111]">
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <SequenceControls
                  mode={d.sequence_mode}
                  status={d.sequence_status}
                  cursor={d.sequence_cursor}
                  total={sequenceTotal(d.id)}
                  noun="drone"
                  onMode={(m) => void onEdit(d.id, { sequence_mode: m })}
                  onStart={() => void onStartSequence(d.id)}
                  onAdvance={() => void onAdvanceSequence(d.id)}
                  onStop={() => void onStopSequence(d.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

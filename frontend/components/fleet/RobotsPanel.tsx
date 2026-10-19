'use client';

import { Cpu, Plus, Trash2 } from 'lucide-react';
import type { Category, Robot, Task } from '@/lib/fleet/types';
import type { RobotUpdate } from '@/lib/api/fleet';
import { ROBOT_STATUS_COLOR } from '@/lib/fleet/constants';
import { EmptyHint, PanelShell } from './PanelShell';
import { SequenceControls } from './SequenceControls';
import { LiveDot } from './LiveDot';
import { chipBtnCls, fieldCls, iconBtnCls } from './theme';

interface Props {
  robots: Robot[];
  categories: Category[];
  tasks: Task[];
  selectedId: string | null;
  placing: boolean;
  onSelect: (id: string | null) => void;
  onPlace: () => void;
  onEdit: (id: string, body: RobotUpdate) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onStartSequence: (id: string) => Promise<void>;
  onAdvanceSequence: (id: string) => Promise<void>;
  onStopSequence: (id: string) => Promise<void>;
  liveConnectedIds?: Set<string>;
}

function commitNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function RobotsPanel({
  robots,
  categories,
  tasks,
  selectedId,
  placing,
  onSelect,
  onPlace,
  onEdit,
  onDelete,
  onStartSequence,
  onAdvanceSequence,
  onStopSequence,
  liveConnectedIds,
}: Props) {
  const sequenceTotal = (robotId: string) =>
    tasks.filter((t) => t.assigned_robot_id === robotId && t.sequence_index !== null).length;

  return (
    <PanelShell
      title="Robots"
      icon={<Cpu size={12} />}
      actions={
        <button
          onClick={onPlace}
          className={`${chipBtnCls} ${placing ? 'border-emerald-400/50 text-emerald-200' : ''}`}
          title="Place a robot on the map"
        >
          <Plus size={11} /> <span className="@max-[220px]:hidden">Place</span>
        </button>
      }
    >
      {robots.length === 0 ? (
        <EmptyHint>No robots yet. Click Place, then click the map.</EmptyHint>
      ) : (
        <ul>
          {robots.map((r) => {
            const selected = r.id === selectedId;
            return (
              <li
                key={r.id}
                className={`border-b border-white/[0.05] px-3 py-2.5 transition-colors last:border-0 ${
                  selected ? 'bg-white/[0.05]' : 'hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={r.color}
                    onChange={(e) => void onEdit(r.id, { color: e.target.value })}
                    className="h-4 w-4 cursor-pointer rounded-full border-0 bg-transparent p-0"
                    title="Colour"
                  />
                  <input
                    key={`${r.id}-${r.name}`}
                    defaultValue={r.name}
                    onClick={() => onSelect(selected ? null : r.id)}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== r.name) void onEdit(r.id, { name: v });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-white/85 outline-none"
                  />
                  <LiveDot
                    live={!!liveConnectedIds}
                    connected={!!liveConnectedIds?.has(r.id)}
                    color={ROBOT_STATUS_COLOR[r.status]}
                    status={r.status}
                  />
                  <button onClick={() => void onDelete(r.id)} className={`${iconBtnCls} hover:text-red-400`} aria-label="Delete robot">
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2 pl-6 text-[10px] text-white/40">
                  <span className="truncate font-mono text-white/60" title="VDA 5050 serial">
                    {r.serial_number}
                  </span>
                  <span>speed</span>
                  <input
                    key={`${r.id}-speed-${r.speed}`}
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.5}
                    defaultValue={r.speed}
                    onBlur={(e) => {
                      const n = commitNumber(e.target.value, r.speed);
                      if (n !== r.speed) void onEdit(r.id, { speed: n });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    className={`${fieldCls} w-14 font-mono`}
                  />
                  <span>category</span>
                  <select
                    value={r.category_id ?? ''}
                    onChange={(e) => void onEdit(r.id, { category_id: e.target.value || null })}
                    className={`${fieldCls} min-w-0 flex-1`}
                    title="This robot only works on tasks in this category"
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
                  mode={r.sequence_mode}
                  status={r.sequence_status}
                  cursor={r.sequence_cursor}
                  total={sequenceTotal(r.id)}
                  noun="robot"
                  onMode={(m) => void onEdit(r.id, { sequence_mode: m })}
                  onStart={() => void onStartSequence(r.id)}
                  onAdvance={() => void onAdvanceSequence(r.id)}
                  onStop={() => void onStopSequence(r.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

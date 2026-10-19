'use client';

import { Plus, RotateCcw, Shuffle, Target, Trash2 } from 'lucide-react';
import type { Category, Robot, Task } from '@/lib/fleet/types';
import type { TaskUpdate } from '@/lib/api/fleet';
import { TASK_STATUS_COLOR } from '@/lib/fleet/constants';
import { EmptyHint, PanelShell } from './PanelShell';
import { chipBtnCls, fieldCls, iconBtnCls } from './theme';

interface Props {
  tasks: Task[];
  robots: Robot[];
  categories: Category[];
  placing: boolean;
  onPlace: () => void;
  onReassign: () => Promise<void>;
  onEdit: (id: string, body: TaskUpdate) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function robotEligible(robot: Robot, task: Task): boolean {
  if (!robot.category_id || task.category_ids.length === 0) return true;
  return task.category_ids.includes(robot.category_id);
}

export function TasksPanel({ tasks, robots, categories, placing, onPlace, onReassign, onEdit, onDelete }: Props) {
  const robotName = (id: string | null) => (id ? robots.find((r) => r.id === id)?.name : null) ?? 'unassigned';

  return (
    <PanelShell
      title="Tasks"
      icon={<Target size={12} />}
      actions={
        <>
          <button
            onClick={() => void onReassign()}
            className={chipBtnCls}
            title="Assign by priority and closest robot"
            disabled={tasks.length === 0 || robots.length === 0}
          >
            <Shuffle size={11} /> <span className="@max-[340px]:hidden">Reassign</span>
          </button>
          <button
            onClick={onPlace}
            className={`${chipBtnCls} ${placing ? 'border-emerald-400/50 text-emerald-200' : ''}`}
            title="Place a task on the map"
          >
            <Plus size={11} /> <span className="@max-[340px]:hidden">Place</span>
          </button>
        </>
      }
    >
      {tasks.length === 0 ? (
        <EmptyHint>No tasks yet. Click Place, then click the map.</EmptyHint>
      ) : (
        <ul>
          {tasks.map((t) => (
            <li key={t.id} className="border-b border-white/[0.05] px-3 py-2.5 last:border-0 hover:bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 shrink-0 rotate-45" style={{ background: TASK_STATUS_COLOR[t.status] }} title={t.status} />
                <input
                  key={`${t.id}-${t.name}`}
                  defaultValue={t.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== t.name) void onEdit(t.id, { name: v });
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-white/85 outline-none"
                />
                {t.vehicle_kind === 'aerial' && <span className="font-mono text-[9px] uppercase text-sky-300/70">air</span>}
                {t.status === 'done' && (
                  <button
                    onClick={() => void onEdit(t.id, { status: 'pending', assigned_robot_id: null })}
                    className={`${iconBtnCls} hover:text-emerald-300`}
                    aria-label="Redo task"
                    title="Redo: send a robot back to it"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
                <button onClick={() => void onDelete(t.id)} className={`${iconBtnCls} hover:text-red-400`} aria-label="Delete task">
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-4 text-[10px] text-white/40">
                <span>prio</span>
                <input
                  key={`${t.id}-prio-${t.priority}`}
                  type="number"
                  min={0}
                  max={10}
                  defaultValue={t.priority}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n !== t.priority) void onEdit(t.id, { priority: n });
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className={`${fieldCls} w-12 font-mono`}
                />
                <span>due</span>
                <input
                  key={`${t.id}-due-${t.deadline_s ?? ''}`}
                  type="number"
                  min={0}
                  placeholder="∞"
                  defaultValue={t.deadline_s ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const n = v === '' ? null : Number(v);
                    if (n === (t.deadline_s ?? null)) return;
                    if (n === null || Number.isFinite(n)) void onEdit(t.id, { deadline_s: n });
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className={`${fieldCls} w-12 font-mono`}
                />
                {t.eta_s != null && (
                  <span className="font-mono text-emerald-300/80" title="Estimated time to complete">
                    ~{t.eta_s.toFixed(0)}s
                  </span>
                )}
                <span>robot</span>
                <select
                  value={t.assigned_robot_id ?? ''}
                  onChange={(e) =>
                    void onEdit(t.id, {
                      assigned_robot_id: e.target.value || null,
                      status: e.target.value ? 'assigned' : 'pending',
                    })
                  }
                  className={`${fieldCls} min-w-0 flex-1`}
                  title={robotName(t.assigned_robot_id)}
                >
                  <option value="" className="bg-[#111]">
                    unassigned
                  </option>
                  {robots
                    .filter((r) => robotEligible(r, t) || r.id === t.assigned_robot_id)
                    .map((r) => (
                      <option key={r.id} value={r.id} className="bg-[#111]">
                        {r.name}
                      </option>
                    ))}
                </select>
              </div>
              {categories.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-4">
                  {categories.map((c) => {
                    const on = t.category_ids.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          const next = on ? t.category_ids.filter((id) => id !== c.id) : [...t.category_ids, c.id];
                          void onEdit(t.id, { category_ids: next });
                        }}
                        className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] transition-colors"
                        style={{
                          borderColor: on ? c.color : 'rgba(255,255,255,0.1)',
                          background: on ? `${c.color}26` : 'transparent',
                          color: on ? c.color : 'rgba(255,255,255,0.4)',
                        }}
                        title={on ? `Remove from ${c.name}` : `Add to ${c.name}`}
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

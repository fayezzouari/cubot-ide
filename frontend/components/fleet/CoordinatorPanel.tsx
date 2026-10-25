'use client';

import { useEffect, useState } from 'react';
import { BatteryMedium, Loader2, Pause, Play, Radio } from 'lucide-react';
import type { Broker, BrokerMode, Robot, Task } from '@/lib/fleet/types';
import type { BrokerStatus, LocMsg } from '@/lib/fleet/hooks/useBrokerTopics';
import type { Vehicle } from '@/lib/fleet/hooks/useUagvFlow';
import { FLEET_COLORS, STALE_MS, TASK_STATUS_COLOR } from '@/lib/fleet/constants';
import { resolveBrokerUrl } from '@/lib/fleet/mqtt';
import { PanelShell } from './PanelShell';
import { ModeToggle } from './ModeToggle';
import { BrokerConnection } from './BrokerConnection';
import { labelCls } from './theme';

interface Props {
  broker: Broker | null;
  connected: boolean;
  status: BrokerStatus | null;
  locs: Record<string, LocMsg>;
  robots: Robot[];
  tasks: Task[];
  creating: boolean;
  onCreate: () => void;
  onModeChange: (mode: BrokerMode) => void;
  onDispatchToggle: (active: boolean) => void;
  onAutoAssignChange: (auto: boolean) => void;
  vehicles: Record<string, Vehicle>;
}

const STATUS_RANK: Record<Task['status'], number> = { assigned: 0, pending: 1, done: 2 };

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function CoordinatorPanel({
  broker,
  connected,
  status,
  locs,
  robots,
  tasks,
  creating,
  onCreate,
  onModeChange,
  onDispatchToggle,
  onAutoAssignChange,
  vehicles,
}: Props) {
  const now = useNow(1000);
  const robotName = (id: string | null | undefined) => (id && robots.find((r) => r.id === id)?.name) || 'unassigned';
  const robotColor = (id: string) => robots.find((r) => r.id === id)?.color ?? FLEET_COLORS.dim;
  const sortedTasks = [...tasks].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

  return (
    <PanelShell
      title="Coordinator"
      icon={<Radio size={12} />}
      actions={
        broker && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-white/40">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-white/25'}`} />
            {connected ? 'connected' : 'offline'}
          </span>
        )
      }
    >
      {!broker ? (
        <div className="flex flex-col items-start gap-3 p-3">
          <p className="text-[11px] leading-relaxed text-white/50">
            Create an MQTT broker to stream per-robot localization and let the fleet coordinator dispatch tasks over topics.
          </p>
          <button
            onClick={onCreate}
            disabled={creating}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />}
            {creating ? 'Creating…' : 'Create broker'}
          </button>
        </div>
      ) : (
        <div className="space-y-4 p-3 text-[11px]">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-white/35">
            <span className="truncate" title={resolveBrokerUrl(broker.ws_url)}>
              {resolveBrokerUrl(broker.ws_url)}
            </span>
            {status && (
              <span className="shrink-0">
                {status.robots}r · {status.open_tasks}t
              </span>
            )}
          </div>

          <BrokerConnection broker={broker} />

          <div className="flex items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.02] p-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-white/60">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${broker.dispatch_active ? 'animate-pulse bg-emerald-400' : 'bg-white/25'}`} />
              {broker.dispatch_active ? 'Dispatching' : 'Dispatch stopped'}
            </span>
            <button
              onClick={() => onDispatchToggle(!broker.dispatch_active)}
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] ${
                broker.dispatch_active
                  ? 'border border-white/[0.1] text-white/70 hover:bg-white/[0.06]'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
              title={broker.dispatch_active ? 'Stop dispatch' : broker.auto_assign ? 'Start dispatch' : 'Send the assigned tasks to the robots'}
            >
              {broker.dispatch_active ? <Pause size={12} /> : <Play size={12} />}
              {broker.dispatch_active ? 'Stop' : broker.auto_assign ? 'Start' : 'Execute'}
            </button>
          </div>

          <div>
            <div className={`${labelCls} mb-1.5`}>Assignment</div>
            <div className="inline-flex rounded-md border border-white/[0.08] p-0.5">
              {([true, false] as const).map((auto) => (
                <button
                  key={String(auto)}
                  onClick={() => auto !== broker.auto_assign && onAutoAssignChange(auto)}
                  title={auto ? 'The coordinator assigns open tasks to the nearest eligible robot' : 'Robots run only the tasks you assign'}
                  className={`rounded px-2 py-1 text-[11px] transition-colors ${
                    broker.auto_assign === auto ? 'bg-white/[0.08] text-white' : 'text-white/45 hover:text-white/75'
                  }`}
                >
                  {auto ? 'Auto' : 'Manual'}
                </button>
              ))}
            </div>
            {!broker.auto_assign && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-white/45">
                Assign tasks in the Tasks panel, then press Execute. Each robot runs its tasks by priority.
              </p>
            )}
          </div>

          <div>
            <div className={`${labelCls} mb-1.5`}>Mode</div>
            <ModeToggle mode={broker.mode} onChange={onModeChange} />
            {broker.mode === 'live' && (
              <div className="mt-2 space-y-1 rounded-md border border-orange-400/25 bg-orange-400/[0.05] p-2 text-[10px] leading-relaxed text-white/55">
                <p>
                  Robots that report <code className="font-mono text-white/80">mapId</code>{' '}
                  <code className="font-mono text-white/80">{broker.project_id}</code> are added on first connection.
                </p>
                <p>Expected serials:</p>
                <ul className="space-y-0.5">
                  {robots.map((r) => (
                    <li key={r.id} className="font-mono text-white/80">
                      {r.manufacturer}/{r.serial_number}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {broker.mode === 'live' ? (
            <div>
              <div className={`${labelCls} mb-1.5`}>Vehicle telemetry</div>
              {robots.length === 0 ? (
                <p className="text-[10px] text-white/30">No robots yet</p>
              ) : (
                <ul className="space-y-1.5">
                  {robots.map((r) => {
                    const v = vehicles[r.serial_number];
                    const fresh = !!v && now - v.lastSeen < STALE_MS;
                    return (
                      <li key={r.id} className="space-y-0.5">
                        <div className="flex items-center gap-2 font-mono">
                          <span className={`inline-block h-2 w-2 rounded-full ${fresh ? 'bg-emerald-400' : 'bg-white/25'}`} />
                          <span className="text-white/85">{r.name}</span>
                          <span className="truncate text-white/35">{r.serial_number}</span>
                          {v && <span className={`ml-auto ${v.driving ? 'text-emerald-300' : 'text-white/35'}`}>{v.driving ? 'driving' : 'idle'}</span>}
                        </div>
                        {v ? (
                          <div className="flex items-center gap-2 pl-4 font-mono text-[10px] text-white/40">
                            {v.position && (
                              <span>
                                {v.position.x.toFixed(1)}, {v.position.y.toFixed(1)}m
                              </span>
                            )}
                            {v.battery != null && (
                              <span className="inline-flex items-center gap-0.5">
                                <BatteryMedium size={11} /> {v.battery.toFixed(0)}%
                              </span>
                            )}
                            {v.orderId && (
                              <span className="truncate" title={v.orderId}>
                                order {v.orderId.slice(-8)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <p className="pl-4 text-[10px] text-white/30">never seen</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div>
              <div className={`${labelCls} mb-1.5`}>robots/+/loc</div>
              {Object.keys(locs).length === 0 ? (
                <p className="text-[10px] text-white/30">No telemetry yet</p>
              ) : (
                <ul className="space-y-0.5">
                  {Object.values(locs).map((l) => (
                    <li key={l.robotId} className="flex items-center gap-2 font-mono">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: robotColor(l.robotId) }} />
                      <span className="text-white/85">{robotName(l.robotId)}</span>
                      <span className="ml-auto text-white/35">
                        {Number(l.x).toFixed(1)}, {Number(l.y).toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <div className={`${labelCls} mb-1.5`}>Tasks</div>
            {sortedTasks.length === 0 ? (
              <p className="text-[10px] text-white/30">No tasks yet</p>
            ) : (
              <ul className="space-y-1">
                {sortedTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TASK_STATUS_COLOR[t.status] }} />
                    <span className="truncate text-white/80">{t.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-white/40">
                      {t.status === 'done'
                        ? 'done'
                        : t.status === 'assigned'
                          ? `→ ${robotName(t.assigned_robot_id)}${t.eta_s != null ? ` · ${t.eta_s.toFixed(0)}s` : ''}`
                          : 'pending'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
}

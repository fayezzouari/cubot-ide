'use client';

import { useMemo } from 'react';
import type { Broker, Drone, Robot } from '@/lib/fleet/types';
import { useUagvFlow } from '@/lib/fleet/hooks/useUagvFlow';
import { TYPE_META, VDA_TYPE_ORDER } from '@/lib/fleet/constants';
import { resolveBrokerUrl } from '@/lib/fleet/mqtt';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { FlowDiagram, type RobotInfo } from './FlowDiagram';
import { labelCls } from './theme';

export function FlowView({ broker, robots, drones }: { broker: Broker | null; robots: Robot[]; drones: Drone[] }) {
  const { connected, vehicles, log, counts, activityRef } = useUagvFlow(broker);

  const info = useMemo(() => {
    const m: Record<string, RobotInfo> = {};
    for (const v of [...robots, ...drones]) {
      m[v.id] = { name: v.name, color: v.color };
      if (v.serial_number) m[v.serial_number] = { name: v.name, color: v.color };
    }
    return m;
  }, [robots, drones]);

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={70} minSize={35}>
        <div className="relative h-full">
          <FlowDiagram vehicles={vehicles} activityRef={activityRef} robots={info} />
          <div className="pointer-events-none absolute left-3 top-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'animate-pulse bg-emerald-400' : 'bg-white/30'}`} />
            VDA 5050 flow · {connected ? 'live' : broker ? 'connecting' : 'no broker'}
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle className="w-px bg-white/[0.06]" />
      <ResizablePanel defaultSize={30} minSize={18}>
        <div className="flex h-full flex-col gap-4 overflow-hidden border-l border-white/[0.04] bg-[#0a0a0a] p-3">
          {broker && <div className="truncate font-mono text-[10px] text-white/30">{resolveBrokerUrl(broker.ws_url)}</div>}
          <section>
            <div className={`${labelCls} mb-2`}>Message types</div>
            <div className="space-y-1.5">
              {VDA_TYPE_ORDER.map((t) => {
                const meta = TYPE_META[t];
                return (
                  <div key={t} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-2 text-white/80">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                      {meta.label}
                      <span className="text-white/30">{meta.dir === 'down' ? '→ vehicle' : '→ master'}</span>
                    </span>
                    <span className="font-mono tabular-nums text-white/45">{counts[t]}</span>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="flex min-h-0 flex-1 flex-col">
            <div className={`${labelCls} mb-2`}>Event log</div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {log.length === 0 && (
                <p className="text-[11px] text-white/30">No orders or connections yet. Start the fleet coordinator and a vehicle.</p>
              )}
              {log.map((e) => (
                <div key={e.id} className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[11px] animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium text-white/80">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_META[e.type].color }} />
                      {TYPE_META[e.type].label}
                    </span>
                    <span className="font-mono tabular-nums text-white/30">{new Date(e.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] text-white/45">
                    <span className="truncate">{info[e.serial]?.name ?? e.serial}</span>
                    <span className="truncate pl-2 text-right">{e.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

'use client';

import { useEffect, useMemo, useState, type CSSProperties, type MutableRefObject } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Activity, Vehicle } from '@/lib/fleet/hooks/useUagvFlow';
import { EDGE_ACTIVE_MS, FLEET_COLORS, TYPE_META } from '@/lib/fleet/constants';

export interface RobotInfo {
  name: string;
  color: string;
}

interface Props {
  vehicles: Record<string, Vehicle>;
  activityRef: MutableRefObject<Activity>;
  robots: Record<string, RobotInfo>;
}

const CX = 420;
const CY = 320;
const RADIUS = 270;

const HANDLE: CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  left: '50%',
  top: '50%',
  border: 'none',
  background: 'transparent',
  transform: 'translate(-50%, -50%)',
};

type MasterData = { count: number };
type VehicleData = {
  name: string;
  color: string;
  online: boolean;
  battery: number | null;
  orderId: string | null;
  driving: boolean;
};

type MasterNodeType = Node<MasterData, 'master'>;
type VehicleNodeType = Node<VehicleData, 'vehicle'>;

function shortId(s: string): string {
  return s.length > 10 ? `…${s.slice(-7)}` : s;
}

function MasterNode({ data }: NodeProps<MasterNodeType>) {
  return (
    <div className="relative">
      <div className="rounded-lg border border-sky-400/50 bg-[#0d0d10] px-4 py-2.5 text-center shadow-lg shadow-black/40">
        <div className="text-[12px] font-semibold tracking-wide text-sky-300">Master control</div>
        <div className="font-mono text-[10px] text-white/45">fleet coordinator · VDA 5050</div>
        <div className="font-mono text-[10px] text-white/30">
          {data.count} vehicle{data.count === 1 ? '' : 's'}
        </div>
      </div>
      <Handle type="target" position={Position.Top} style={HANDLE} />
      <Handle type="source" position={Position.Top} style={HANDLE} />
    </div>
  );
}

function VehicleNode({ data }: NodeProps<VehicleNodeType>) {
  const { name, color, online, battery, orderId, driving } = data;
  return (
    <div className="relative">
      {driving && <span className="pointer-events-none absolute inset-0 animate-ping rounded-lg border" style={{ borderColor: color }} />}
      <div
        className="min-w-[148px] rounded-lg border bg-[#0d0d10] px-3 py-2 shadow-lg shadow-black/40"
        style={{ borderColor: online ? color : 'rgba(255,255,255,0.12)', opacity: online ? 1 : 0.6 }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12px] font-medium text-white/85">{name}</span>
          <span className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-400' : 'bg-white/25'}`} />
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-white/45">
          <span className="tabular-nums">{battery != null ? `${Math.round(battery)}%` : 'n/a'}</span>
          <span>{driving ? 'driving' : online ? 'idle' : 'offline'}</span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-white/30">{orderId ? `order ${shortId(orderId)}` : 'no order'}</div>
      </div>
      <Handle type="target" position={Position.Top} style={HANDLE} />
      <Handle type="source" position={Position.Top} style={HANDLE} />
    </div>
  );
}

const nodeTypes = { master: MasterNode, vehicle: VehicleNode };

export function FlowDiagram({ vehicles, activityRef, robots }: Props) {
  const serials = useMemo(() => Object.keys(vehicles).sort((a, b) => a.localeCompare(b)), [vehicles]);

  const nodes = useMemo<(MasterNodeType | VehicleNodeType)[]>(() => {
    const n = serials.length;
    const list: (MasterNodeType | VehicleNodeType)[] = [
      {
        id: 'master',
        type: 'master',
        position: { x: CX - 90, y: CY - 40 },
        data: { count: n },
        draggable: false,
        selectable: false,
      },
    ];
    serials.forEach((s, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
      const v = vehicles[s];
      const info = robots[s];
      list.push({
        id: s,
        type: 'vehicle',
        position: { x: CX + RADIUS * Math.cos(ang) - 74, y: CY + RADIUS * Math.sin(ang) - 40 },
        data: {
          name: info?.name ?? s,
          color: info?.color ?? FLEET_COLORS.ok,
          online: v?.online ?? false,
          battery: v?.battery ?? null,
          orderId: v?.orderId ?? null,
          driving: v?.driving ?? false,
        },
        draggable: false,
        selectable: false,
      });
    });
    return list;
  }, [serials, vehicles, robots]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(id);
  }, []);

  const edges = useMemo<Edge[]>(() => {
    const activity = activityRef.current;
    return serials.map((s) => {
      const a = activity[s] ?? { down: 0, up: 0 };
      const recentDown = now - a.down < EDGE_ACTIVE_MS;
      const recentUp = now - a.up < EDGE_ACTIVE_MS;
      let down = false;
      let color: string = 'rgba(255,255,255,0.14)';
      let active = false;
      if (recentDown && a.down >= a.up) {
        down = true;
        color = TYPE_META.order.color;
        active = true;
      } else if (recentUp) {
        color = TYPE_META.state.color;
        active = true;
      }
      return {
        id: `e:${s}`,
        source: down ? 'master' : s,
        target: down ? s : 'master',
        animated: active,
        style: { stroke: color, strokeWidth: active ? 2.2 : 1.2, opacity: active ? 1 : 0.6 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      };
    });
  }, [serials, now, activityRef]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      colorMode="dark"
      style={{ background: 'transparent' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.3} color="#ffffff" style={{ opacity: 0.1 }} />
      <Controls showInteractive={false} className="!border-white/10 !bg-[#0a0a0a]" />
      {serials.length === 0 && (
        <Panel position="top-center">
          <span className="rounded-md border border-white/10 bg-[#0d0d10]/90 px-3 py-1.5 font-mono text-[11px] text-white/40">
            Waiting for vehicles to announce on uagv/#…
          </span>
        </Panel>
      )}
    </ReactFlow>
  );
}

'use client';

import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { WiringGuideDTO } from '@/lib/api/types';

/* ------------------------------------------------------------------ */
/*  Color helpers                                                      */
/* ------------------------------------------------------------------ */

const WIRE_COLORS: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  brown: '#92400e',
  black: '#1e1e1e',
  white: '#e5e5e5',
  gray: '#6b7280',
  grey: '#6b7280',
  pink: '#ec4899',
};

function resolveColor(raw: string): string {
  const key = raw.toLowerCase().trim();
  return WIRE_COLORS[key] ?? '#6b7280';
}

/* ------------------------------------------------------------------ */
/*  Custom node components                                             */
/* ------------------------------------------------------------------ */

function ArduinoNode({ data }: { data: { label: string; pins: string[] } }) {
  return (
    <div className="bg-blue-900 border-[3px] border-blue-400 rounded-lg px-4 py-3 min-w-[180px] shadow-lg">
      <div className="text-white font-black text-sm text-center mb-2 tracking-wide">
        {data.label}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {data.pins.map((pin, i) => (
          <div
            key={pin}
            className="flex items-center gap-1 text-[10px] text-blue-200 font-mono relative"
          >
            <Handle
              type="source"
              position={i % 2 === 0 ? Position.Left : Position.Right}
              id={pin}
              className="!w-2 !h-2 !bg-blue-300 !border-blue-500"
              style={{ top: 'auto', position: 'relative' }}
              isConnectable={false}
            />
            {pin}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComponentNode({
  data,
}: {
  data: { label: string; type: string; notes: string[]; pins: string[] };
}) {
  const bgColor =
    data.type === 'sensor'
      ? 'bg-emerald-800 border-emerald-400'
      : data.type === 'actuator' || data.type === 'motor'
        ? 'bg-amber-800 border-amber-400'
        : data.type === 'led' || data.type === 'LED'
          ? 'bg-yellow-700 border-yellow-400'
          : data.type === 'display'
            ? 'bg-purple-800 border-purple-400'
            : 'bg-gray-800 border-gray-400';

  return (
    <div
      className={`${bgColor} border-[3px] rounded-lg px-3 py-2 min-w-[140px] shadow-lg`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-white !border-gray-400"
        isConnectable={false}
      />
      <div className="text-white font-black text-xs text-center mb-1">
        {data.label}
      </div>
      <div className="text-[10px] text-white/70 text-center">{data.type}</div>
      {data.pins.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 justify-center">
          {data.pins.map((pin) => (
            <span
              key={pin}
              className="bg-white/20 text-white text-[9px] px-1.5 py-0.5 rounded font-mono"
            >
              {pin}
            </span>
          ))}
        </div>
      )}
      {data.notes.length > 0 && (
        <div className="mt-1 text-[9px] text-white/50 text-center leading-tight">
          {data.notes[0]}
        </div>
      )}
      <Handle
        type="target"
        position={Position.Right}
        id="right"
        className="!w-2.5 !h-2.5 !bg-white !border-gray-400"
        isConnectable={false}
      />
    </div>
  );
}

function PowerNode({ data }: { data: { label: string } }) {
  return (
    <div className="bg-red-900 border-[3px] border-red-400 rounded-lg px-3 py-2 min-w-[100px] shadow-lg">
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-red-300 !border-red-500"
        isConnectable={false}
      />
      <div className="text-white font-black text-xs text-center">
        ⚡ {data.label}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-red-300 !border-red-500"
        isConnectable={false}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Build React Flow graph from WiringGuideDTO                         */
/* ------------------------------------------------------------------ */

function buildGraph(guide: WiringGuideDTO) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Collect all Arduino pins referenced in the guide
  const arduinoPins = new Set<string>();
  for (const comp of guide.components) {
    for (const conn of comp.connections) {
      if (/^(A\d|D?\d+|PIN|GND|5V|3\.3V|VIN|AREF)/i.test(conn.from))
        arduinoPins.add(conn.from);
      if (/^(A\d|D?\d+|PIN|GND|5V|3\.3V|VIN|AREF)/i.test(conn.to))
        arduinoPins.add(conn.to);
    }
    for (const pin of comp.pins) {
      if (/^(A\d|D?\d+|PIN|GND|5V|3\.3V|VIN|AREF)/i.test(pin))
        arduinoPins.add(pin);
    }
  }
  for (const conn of guide.power) {
    if (/^(A\d|D?\d+|PIN|GND|5V|3\.3V|VIN|AREF)/i.test(conn.from))
      arduinoPins.add(conn.from);
    if (/^(A\d|D?\d+|PIN|GND|5V|3\.3V|VIN|AREF)/i.test(conn.to))
      arduinoPins.add(conn.to);
  }

  // Add default pins if none detected
  if (arduinoPins.size === 0) {
    ['D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'A0', 'A1', 'A2', '5V', 'GND'].forEach(
      (p) => arduinoPins.add(p),
    );
  }

  // Arduino board node — center
  nodes.push({
    id: 'arduino',
    type: 'arduino',
    position: { x: 300, y: 150 },
    data: {
      label: 'ARDUINO UNO',
      pins: Array.from(arduinoPins).sort(),
    },
  });

  // Component nodes
  const angleStep = (2 * Math.PI) / Math.max(guide.components.length, 1);
  const radius = 300;
  guide.components.forEach((comp, i) => {
    const angle = angleStep * i - Math.PI / 2;
    const cx = 300 + radius * Math.cos(angle);
    const cy = 150 + radius * Math.sin(angle);

    const nodeId = `comp-${i}`;
    nodes.push({
      id: nodeId,
      type: 'component',
      position: { x: cx, y: cy },
      data: {
        label: comp.name,
        type: comp.type,
        notes: comp.notes,
        pins: comp.pins,
      },
    });

    // Edges from component connections
    comp.connections.forEach((conn, ci) => {
      edges.push({
        id: `e-${nodeId}-${ci}`,
        source: 'arduino',
        sourceHandle: conn.from,
        target: nodeId,
        label: conn.note || `${conn.from} → ${conn.to}`,
        style: { stroke: resolveColor(conn.color), strokeWidth: 2.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: resolveColor(conn.color) },
        animated: false,
      });
    });
  });

  // Power edges
  guide.power.forEach((conn, pi) => {
    // Find source/target nodes
    let sourceId = 'arduino';
    let targetId = 'arduino';

    // Check if "from" matches a component name
    const fromComp = guide.components.findIndex(
      (c) => c.name.toLowerCase() === conn.from.toLowerCase(),
    );
    if (fromComp >= 0) sourceId = `comp-${fromComp}`;

    const toComp = guide.components.findIndex(
      (c) => c.name.toLowerCase() === conn.to.toLowerCase(),
    );
    if (toComp >= 0) targetId = `comp-${toComp}`;

    // Avoid self-loops
    if (sourceId === targetId) {
      targetId = sourceId === 'arduino' ? `comp-0` : 'arduino';
    }

    // Only add if both nodes exist
    const nodeIds = new Set(nodes.map((n) => n.id));
    if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
      edges.push({
        id: `e-power-${pi}`,
        source: sourceId,
        target: targetId,
        label: `⚡ ${conn.note || 'Power'}`,
        style: { stroke: resolveColor(conn.color || 'red'), strokeWidth: 3 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: resolveColor(conn.color || 'red'),
        },
        animated: true,
      });
    }
  });

  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/*  Exported component                                                 */
/* ------------------------------------------------------------------ */

const nodeTypes: NodeTypes = {
  arduino: ArduinoNode as any,
  component: ComponentNode as any,
  power: PowerNode as any,
};

interface WiringDiagramProps {
  guide: WiringGuideDTO | null;
  loading?: boolean;
  error?: string;
}

export default function WiringDiagram({ guide, loading, error }: WiringDiagramProps) {
  const { nodes, edges } = useMemo(() => {
    if (!guide || guide.components.length === 0) return { nodes: [], edges: [] };
    return buildGraph(guide);
  }, [guide]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm font-bold">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Generating wiring diagram…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive text-sm font-bold px-4 text-center">
        {error}
      </div>
    );
  }

  if (!guide || nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm font-bold px-4 text-center">
        Compile your project to generate a wiring diagram.
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {/* Summary bar */}
      {guide.summary && (
        <div className="absolute bottom-0 left-0 right-0 bg-background/90 border-t-2 border-foreground px-3 py-1.5">
          <p className="text-xs font-bold truncate">{guide.summary}</p>
        </div>
      )}
    </div>
  );
}

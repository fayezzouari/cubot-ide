'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Broker, FlowDir, Vda5050Type } from '../types';
import { LOGGED_VDA_TYPES, TYPE_META, UAGV_ROOT, VDA_LOG_LIMIT } from '../constants';
import { connectFleetMqtt, parsePayload } from '../mqtt';

const TYPES = Object.keys(TYPE_META) as Vda5050Type[];
const isType = (s: string): s is Vda5050Type => (TYPES as string[]).includes(s);

export interface Vehicle {
  serial: string;
  manufacturer: string;
  online: boolean;
  lastType: Vda5050Type | null;
  battery: number | null;
  position: { x: number; y: number; theta?: number } | null;
  orderId: string | null;
  lastNodeId: string | null;
  driving: boolean;
  hasFactsheet: boolean;
  counts: Record<string, number>;
  lastSeen: number;
}

export interface LogEntry {
  id: number;
  serial: string;
  type: Vda5050Type;
  dir: FlowDir;
  ts: number;
  detail: string;
}

export type Activity = Record<string, { down: number; up: number }>;

export interface UagvFlow {
  connected: boolean;
  vehicles: Record<string, Vehicle>;
  log: LogEntry[];
  counts: Record<Vda5050Type, number>;
  activityRef: MutableRefObject<Activity>;
}

const emptyCounts = () => TYPES.reduce((acc, t) => ({ ...acc, [t]: 0 }), {} as Record<Vda5050Type, number>);

const blankVehicle = (serial: string, manufacturer: string): Vehicle => ({
  serial,
  manufacturer,
  online: false,
  lastType: null,
  battery: null,
  position: null,
  orderId: null,
  lastNodeId: null,
  driving: false,
  hasFactsheet: false,
  counts: {},
  lastSeen: 0,
});

export function useUagvFlow(broker: Broker | null): UagvFlow {
  const [connected, setConnected] = useState(false);
  const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [counts, setCounts] = useState<Record<Vda5050Type, number>>(emptyCounts);

  const activityRef = useRef<Activity>({});
  const logId = useRef(0);
  const wsUrl = broker?.ws_url;
  const hasBroker = broker !== null;

  useEffect(() => {
    if (!hasBroker) {
      setConnected(false);
      return;
    }
    const dispose = connectFleetMqtt(wsUrl, (client) => {
      client.on('connect', () => {
        setConnected(true);
        client.subscribe(`${UAGV_ROOT}/#`);
      });
      client.on('reconnect', () => setConnected(false));
      client.on('close', () => setConnected(false));
      client.on('message', (topic, raw) => {
        const parts = topic.split('/');
        if (parts.length < 5 || parts[0] !== UAGV_ROOT) return;
        const manufacturer = parts[2];
        const serial = parts[3];
        const type = parts[parts.length - 1];
        if (!isType(type)) return;
        const p = parsePayload(raw);
        if (!p) return;

        const meta = TYPE_META[type];
        const now = Date.now();

        const a = activityRef.current[serial] ?? { down: 0, up: 0 };
        if (meta.dir === 'down') a.down = now;
        else a.up = now;
        activityRef.current[serial] = a;

        setCounts((c) => ({ ...c, [type]: c[type] + 1 }));

        setVehicles((prev) => {
          const v: Vehicle = { ...(prev[serial] ?? blankVehicle(serial, manufacturer)) };
          v.manufacturer = manufacturer;
          v.lastType = type;
          v.lastSeen = now;
          v.counts = { ...v.counts, [type]: (v.counts[type] ?? 0) + 1 };

          if (type === 'connection') {
            v.online = p.connectionState === 'ONLINE';
          } else if (type === 'state') {
            const s = p as {
              batteryState?: { batteryCharge?: number };
              agvPosition?: { x: number; y: number; theta?: number };
              orderId?: string;
              lastNodeId?: string;
              driving?: boolean;
            };
            v.online = true;
            v.battery = s.batteryState?.batteryCharge ?? v.battery;
            v.position = s.agvPosition ?? v.position;
            v.orderId = s.orderId || null;
            v.lastNodeId = s.lastNodeId || null;
            v.driving = !!s.driving;
          } else if (type === 'visualization') {
            const s = p as { agvPosition?: { x: number; y: number; theta?: number } };
            v.position = s.agvPosition ?? v.position;
            v.online = true;
          } else if (type === 'order') {
            v.orderId = typeof p.orderId === 'string' && p.orderId ? p.orderId : v.orderId;
          } else if (type === 'factsheet') {
            v.hasFactsheet = true;
          }
          return { ...prev, [serial]: v };
        });

        if (LOGGED_VDA_TYPES.includes(type)) {
          const entry: LogEntry = { id: logId.current++, serial, type, dir: meta.dir, ts: now, detail: describe(type, p) };
          setLog((l) => [entry, ...l].slice(0, VDA_LOG_LIMIT));
        }
      });
    });

    return () => {
      dispose();
      setConnected(false);
    };
  }, [hasBroker, wsUrl]);

  return { connected, vehicles, log, counts, activityRef };
}

function describe(type: Vda5050Type, p: Record<string, unknown>): string {
  if (type === 'order') {
    const nodes = Array.isArray(p.nodes) ? p.nodes.length : 0;
    return `${String(p.orderId ?? '?')} · upd ${String(p.orderUpdateId ?? 0)} · ${nodes} nodes`;
  }
  if (type === 'connection') return String(p.connectionState ?? '');
  if (type === 'instantActions') {
    const a = Array.isArray(p.actions) ? (p.actions as { actionType?: string }[]) : [];
    return a.map((x) => x.actionType).join(', ') || 'no actions';
  }
  if (type === 'factsheet') {
    const spd = (p.physicalParameters as { speedMax?: number } | undefined)?.speedMax;
    return spd ? `vmax ${spd} m/s` : 'capabilities';
  }
  return '';
}

'use client';

import { useEffect, useRef, useState } from 'react';
import type { Broker, Robot } from '../types';
import { CELL_SIZE_M, TELEMETRY_FLUSH_MS, UAGV_ROOT, VDA_MAJOR } from '../constants';
import { connectFleetMqtt, parsePayload } from '../mqtt';
import { useFreshIds } from './useFreshIds';

export interface LiveRobotState {
  x: number;
  y: number;
  heading: number;
  status: Robot['status'];
  lastSeen: number;
}

export function useLiveTelemetry(broker: Broker | null, enabled: boolean) {
  const [byId, setById] = useState<Record<string, LiveRobotState>>({});
  const pendingRef = useRef<Record<string, LiveRobotState>>({});
  const wsUrl = broker?.ws_url;
  const active = broker !== null && enabled;

  useEffect(() => {
    setById({});
    if (!active) return;
    const topic = `${UAGV_ROOT}/v${VDA_MAJOR}/+/+/state`;
    const dispose = connectFleetMqtt(wsUrl, (client) => {
      client.on('connect', () => client.subscribe(topic));
      client.on('message', (_topic, payload) => {
        const d = parsePayload(payload);
        if (!d) return;
        const serial = d.serialNumber;
        const pos = d.agvPosition as { x?: number; y?: number; theta?: number } | undefined;
        if (typeof serial !== 'string' || !pos) return;
        pendingRef.current[serial] = {
          x: (pos.x ?? 0) / CELL_SIZE_M,
          y: (pos.y ?? 0) / CELL_SIZE_M,
          heading: pos.theta ?? 0,
          status: d.driving ? 'moving' : 'idle',
          lastSeen: Date.now(),
        };
      });
    });
    const flush = setInterval(() => {
      const batch = pendingRef.current;
      if (!Object.keys(batch).length) return;
      pendingRef.current = {};
      setById((prev) => ({ ...prev, ...batch }));
    }, TELEMETRY_FLUSH_MS);
    return () => {
      clearInterval(flush);
      pendingRef.current = {};
      dispose();
      setById({});
    };
  }, [active, wsUrl]);

  const connectedIds = useFreshIds(byId, enabled);
  return { liveById: byId, connectedIds };
}

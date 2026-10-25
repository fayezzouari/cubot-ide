'use client';

import { useEffect, useRef, useState } from 'react';
import type { Broker, Drone } from '../types';
import { TELEMETRY_FLUSH_MS, UAV_MAJOR, UAV_ROOT } from '../constants';
import { connectFleetMqtt, parsePayload } from '../mqtt';
import { useFreshIds } from './useFreshIds';

export interface LiveDroneState {
  x: number;
  y: number;
  z: number;
  status: Drone['status'];
  lastSeen: number;
}

function flightStatus(value: unknown): Drone['status'] {
  if (value === 'CRUISE' || value === 'TAKEOFF' || value === 'LANDING') return 'flying';
  if (value === 'HOVER') return 'hovering';
  return 'idle';
}

export function useUavFlow(broker: Broker | null, enabled: boolean) {
  const [byId, setById] = useState<Record<string, LiveDroneState>>({});
  const pendingRef = useRef<Record<string, LiveDroneState>>({});
  const wsUrl = broker?.ws_url;
  const active = broker !== null && enabled;

  useEffect(() => {
    setById({});
    if (!active) return;
    const topic = `${UAV_ROOT}/v${UAV_MAJOR}/+/+/state`;
    const dispose = connectFleetMqtt(wsUrl, (client) => {
      client.on('connect', () => client.subscribe(topic));
      client.on('message', (_topic, payload) => {
        const d = parsePayload(payload);
        if (!d) return;
        const serial = d.serialNumber;
        const pos = d.agvPosition as { x?: number; y?: number; z?: number } | undefined;
        if (typeof serial !== 'string' || !pos) return;
        pendingRef.current[serial] = {
          x: pos.x ?? 0,
          y: pos.y ?? 0,
          z: pos.z ?? 0,
          status: flightStatus(d.flightStatus),
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

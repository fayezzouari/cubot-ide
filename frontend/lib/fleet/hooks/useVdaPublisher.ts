'use client';

import { useEffect, useRef } from 'react';
import type { MqttClient } from 'mqtt';
import type { Broker, Robot } from '../types';
import { CELL_SIZE_M, UAGV_ROOT, VDA_MAJOR, VDA_MANUFACTURER, VDA_PUBLISH_MS, VDA_VERSION } from '../constants';
import { connectFleetMqtt } from '../mqtt';

const topic = (serial: string, type: string) => `${UAGV_ROOT}/v${VDA_MAJOR}/${VDA_MANUFACTURER}/${serial}/${type}`;

const nowIso = () => new Date().toISOString();

export function useVdaPublisher(broker: Broker | null, robots: Robot[], running: boolean, mapId: string) {
  const clientRef = useRef<MqttClient | null>(null);
  const robotsRef = useRef(robots);
  robotsRef.current = robots;
  const header = useRef<Record<string, number>>({});
  const battery = useRef<Record<string, number>>({});
  const wsUrl = broker?.ws_url;
  const hasBroker = broker !== null;

  useEffect(() => {
    if (!hasBroker) return;
    const dispose = connectFleetMqtt(wsUrl, (client) => {
      clientRef.current = client;
    });
    return () => {
      dispose();
      clientRef.current = null;
    };
  }, [hasBroker, wsUrl]);

  useEffect(() => {
    if (!hasBroker || !running) return;
    const serials = robotsRef.current.map((r) => r.id);
    const headers = header.current;
    const charge = battery.current;

    const head = (serial: string, type: string) => {
      const k = `${serial}/${type}`;
      headers[k] = (headers[k] ?? 0) + 1;
      return headers[k];
    };
    const base = (serial: string, type: string) => ({
      headerId: head(serial, type),
      timestamp: nowIso(),
      version: VDA_VERSION,
      manufacturer: VDA_MANUFACTURER,
      serialNumber: serial,
    });
    const connection = (serial: string, state: string) => {
      const c = clientRef.current;
      if (!c) return;
      c.publish(topic(serial, 'connection'), JSON.stringify({ ...base(serial, 'connection'), connectionState: state }), {
        retain: true,
      });
    };

    for (const s of serials) connection(s, 'ONLINE');

    const timer = setInterval(() => {
      const c = clientRef.current;
      if (!c || !c.connected) return;
      for (const r of robotsRef.current) {
        const b = (charge[r.id] ?? 100) - 0.2;
        charge[r.id] = b < 20 ? 100 : b;
        c.publish(
          topic(r.id, 'state'),
          JSON.stringify({
            ...base(r.id, 'state'),
            orderId: '',
            orderUpdateId: 0,
            lastNodeId: '',
            lastNodeSequenceId: 0,
            driving: r.status === 'moving',
            paused: false,
            operatingMode: 'AUTOMATIC',
            agvPosition: {
              x: r.position.x * CELL_SIZE_M,
              y: r.position.y * CELL_SIZE_M,
              theta: r.heading,
              mapId,
              positionInitialized: true,
            },
            batteryState: { batteryCharge: Math.round(charge[r.id]), charging: false },
            actionStates: [],
            errors: [],
          }),
        );
      }
    }, VDA_PUBLISH_MS);

    return () => {
      clearInterval(timer);
      for (const s of serials) connection(s, 'OFFLINE');
    };
  }, [hasBroker, running, mapId, wsUrl]);
}

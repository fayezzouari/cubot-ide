'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MqttClient } from 'mqtt';
import type { Broker } from '../types';
import { FEED_LIMIT } from '../constants';
import { connectFleetMqtt, parsePayload } from '../mqtt';

export interface LocMsg {
  robotId: string;
  x: number;
  y: number;
  z: number;
  heading?: number;
  status?: string;
  ts: number;
}

export interface PriorityMsg {
  task_id: string;
  name: string;
  priority: number;
  deadline_s: number | null;
  action: string;
  ts: number;
}

export interface AssignmentMsg {
  task_id: string;
  robot_id: string | null;
  eta_s: number | null;
  due_in_s: number | null;
  reason: string;
  ts: number;
}

export interface BrokerStatus {
  online: boolean;
  robots: number;
  open_tasks: number;
  ts: number;
}

export function useBrokerTopics(broker: Broker | null, onAssignment?: (m: AssignmentMsg) => void) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [locs, setLocs] = useState<Record<string, LocMsg>>({});
  const [priority, setPriority] = useState<PriorityMsg[]>([]);
  const [assignments, setAssignments] = useState<AssignmentMsg[]>([]);

  const clientRef = useRef<MqttClient | null>(null);
  const prefixRef = useRef('');
  const onAssignmentRef = useRef(onAssignment);
  onAssignmentRef.current = onAssignment;

  const wsUrl = broker?.ws_url;
  const prefix = broker?.topic_prefix;
  const hasBroker = broker !== null;

  useEffect(() => {
    if (!hasBroker || !prefix) {
      setConnected(false);
      return;
    }
    prefixRef.current = prefix;
    setLocs({});
    setPriority([]);
    setAssignments([]);

    const dispose = connectFleetMqtt(wsUrl, (client) => {
      clientRef.current = client;
      client.on('connect', () => {
        setConnected(true);
        client.subscribe(`${prefix}/#`);
      });
      client.on('reconnect', () => setConnected(false));
      client.on('close', () => setConnected(false));
      client.on('message', (topic, payload) => {
        const d = parsePayload(payload);
        if (!d) return;
        if (topic.endsWith('/loc')) {
          const rid = topic.split('/')[3];
          setLocs((p) => ({ ...p, [rid]: { ...(d as unknown as LocMsg), robotId: rid } }));
        } else if (topic.endsWith('/tasks/priority')) {
          setPriority((p) => [d as unknown as PriorityMsg, ...p].slice(0, FEED_LIMIT));
        } else if (topic.endsWith('/tasks/assignments')) {
          const m = d as unknown as AssignmentMsg;
          setAssignments((p) => [m, ...p].slice(0, FEED_LIMIT));
          onAssignmentRef.current?.(m);
        } else if (topic.endsWith('/status')) {
          setStatus(d as unknown as BrokerStatus);
        }
      });
    });

    return () => {
      dispose();
      clientRef.current = null;
      setConnected(false);
    };
  }, [hasBroker, wsUrl, prefix]);

  const publishLoc = useCallback(
    (robotId: string, pos: { x: number; y: number; z: number; heading?: number; status?: string }) => {
      const c = clientRef.current;
      if (!c || !c.connected) return;
      c.publish(
        `${prefixRef.current}/robots/${robotId}/loc`,
        JSON.stringify({
          x: pos.x,
          y: pos.y,
          z: pos.z,
          heading: pos.heading ?? 0,
          status: pos.status ?? 'moving',
          ts: Date.now() / 1000,
        }),
      );
    },
    [],
  );

  return { connected, status, locs, priority, assignments, publishLoc };
}

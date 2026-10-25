import type { MqttClient } from 'mqtt';
import { FLEET_MQTT_URL } from './constants';

export function resolveBrokerUrl(wsUrl: string | null | undefined): string {
  const raw = (wsUrl || FLEET_MQTT_URL).trim();
  if (raw.startsWith('/') && typeof window !== 'undefined') {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${window.location.host}${raw}`;
  }
  return raw;
}

export function connectFleetMqtt(wsUrl: string | null | undefined, setup: (client: MqttClient) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let client: MqttClient | null = null;
  let disposed = false;
  void import('mqtt')
    .then((mod) => {
      if (disposed) return;
      const connect = mod.connect ?? (mod.default as unknown as typeof mod).connect;
      client = connect(resolveBrokerUrl(wsUrl), { reconnectPeriod: 2000 });
      client.on('error', () => {});
      setup(client);
    })
    .catch(() => {});
  return () => {
    disposed = true;
    client?.end(true);
    client = null;
  };
}

export function parsePayload(payload: Uint8Array | string): Record<string, unknown> | null {
  try {
    const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    const data: unknown = JSON.parse(text);
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

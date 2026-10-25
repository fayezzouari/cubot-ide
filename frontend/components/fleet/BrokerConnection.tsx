'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Broker } from '@/lib/fleet/types';
import { UAGV_ROOT, UAV_MAJOR, UAV_ROOT, VDA_MAJOR, VDA_VERSION } from '@/lib/fleet/constants';
import { resolveBrokerHost, resolveBrokerUrl } from '@/lib/fleet/mqtt';
import { iconBtnCls, labelCls } from './theme';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  return (
    <div className="flex items-center gap-2">
      <span className="w-[72px] shrink-0 text-white/40">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-white/80" title={value}>
        {value}
      </code>
      <button onClick={copy} className={`${iconBtnCls} shrink-0`} title={`Copy ${label.toLowerCase()}`}>
        {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
      </button>
    </div>
  );
}

export function BrokerConnection({ broker }: { broker: Broker }) {
  const host = resolveBrokerHost(broker.mqtt_host);
  const manufacturer = broker.manufacturer || 'cubot';
  return (
    <div>
      <div className={`${labelCls} mb-1.5`}>Robot connection</div>
      <div className="space-y-1 rounded-md border border-white/[0.08] bg-white/[0.02] p-2 text-[10px]">
        <CopyRow label="Host" value={host} />
        <CopyRow label="Port (TCP)" value={String(broker.mqtt_port)} />
        <CopyRow label="WebSocket" value={resolveBrokerUrl(broker.ws_url)} />
        <CopyRow label="Auth" value="anonymous" />
        <CopyRow label="Map ID" value={broker.project_id} />
        <CopyRow label="Manufacturer" value={manufacturer} />
        <CopyRow label="AGV topics" value={`${UAGV_ROOT}/v${VDA_MAJOR}/${manufacturer}/<serial>/#`} />
        <CopyRow label="Drone topics" value={`${UAV_ROOT}/v${UAV_MAJOR}/${manufacturer}/<serial>/#`} />
        <p className="pt-1 leading-relaxed text-white/40">
          Connect over plain MQTT on the TCP port, speak VDA 5050 {VDA_VERSION}, and report the Map ID as{' '}
          <code className="font-mono text-white/70">agvPosition.mapId</code>.
        </p>
      </div>
    </div>
  );
}

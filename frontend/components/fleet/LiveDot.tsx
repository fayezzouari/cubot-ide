'use client';

import { FLEET_COLORS } from '@/lib/fleet/constants';

export function LiveDot({ live, connected, color, status }: { live: boolean; connected: boolean; color: string; status: string }) {
  const background = live ? (connected ? FLEET_COLORS.ok : FLEET_COLORS.error) : color;
  const title = live ? (connected ? 'Live telemetry connected' : 'No live telemetry') : status;
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background }} title={title} />;
}

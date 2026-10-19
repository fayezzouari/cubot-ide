'use client';

import { useEffect, useState } from 'react';
import { STALE_MS } from '../constants';

export function useFreshIds<T extends { lastSeen: number }>(byId: Record<string, T>, enabled: boolean): Set<string> {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  const reference = Math.max(now, ...Object.values(byId).map((s) => s.lastSeen));
  return new Set(
    Object.entries(byId)
      .filter(([, s]) => reference - s.lastSeen < STALE_MS)
      .map(([id]) => id),
  );
}

import { useEffect, useState } from 'react';
import type { World } from './workcell';

// Drives the simulation on a timer rather than requestAnimationFrame, so a
// program keeps running (throttled) while the tab is in the background. The
// 3D view renders on its own animation frames.
export function useWorldLoop(world: World) {
  useEffect(() => {
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      world.tick((now - last) / 1000);
      last = now;
    }, 16);
    return () => clearInterval(timer);
  }, [world]);
}

// Re-renders the caller at most `hz` times per second while the world changes.
// The 3D view reads the world directly every frame; panels use this.
export function useWorldVersion(world: World, hz = 8): number {
  const [version, setVersion] = useState(world.version);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = world.subscribe(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setVersion(world.version);
      }, 1000 / hz);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [world, hz]);
  return version;
}

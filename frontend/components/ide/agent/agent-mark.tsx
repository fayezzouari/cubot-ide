'use client';

import { Flame } from 'lucide-react';

interface AgentMarkProps {
  /** Tile size in px. */
  size?: number;
  /** Pulses while the agent is working. */
  active?: boolean;
  className?: string;
}

/** The Forge mark: an amber tile with a flame. Used wherever the agent speaks. */
export default function AgentMark({ size = 24, active = false, className = '' }: AgentMarkProps) {
  const icon = Math.round(size * 0.55);
  return (
    <div
      className={`relative flex items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-orange-600 text-black shadow-[0_0_0_1px_rgba(251,191,36,0.25)] flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Flame size={icon} strokeWidth={2.4} />
      {active && (
        <span className="absolute -inset-1 rounded-lg border border-amber-400/50 animate-ping [animation-duration:1.6s]" />
      )}
    </div>
  );
}

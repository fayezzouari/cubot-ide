'use client';

interface AgentMarkProps {
  /** Tile size in px; the flame is drawn on a 12×12 pixel grid. */
  size?: number;
  /** Flickers while the agent is working. */
  active?: boolean;
  className?: string;
}

// 12×12 sprite. '.' empty, 'r' ember, 'o' orange, 'y' amber, 'w' hot core.
const FLAME = [
  '......y.....',
  '.....yy.....',
  '.....yo.....',
  '....yoo.y...',
  '....yooyy...',
  '...yooooyy..',
  '...yoorroy..',
  '..yoorwrroy.',
  '..yoorwwroy.',
  '..yoorrrroy.',
  '...yooooooy.',
  '....yyyyyy..',
];
const COLORS: Record<string, string> = { y: '#ffb000', o: '#ff5a1f', r: '#d8321e', w: '#fff1b8' };

/** The Forge mark: an 8-bit flame on a dark tile with a notched pixel border. */
export default function AgentMark({ size = 24, active = false, className = '' }: AgentMarkProps) {
  const cells: React.ReactNode[] = [];
  FLAME.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLORS[ch]} />);
    });
  });
  return (
    <div
      className={`pixel-border flex flex-shrink-0 items-center justify-center bg-black ${className}`}
      style={{ width: size, height: size, ['--pb' as string]: active ? '#ffb000' : '#3a2f22' }}
      aria-hidden
    >
      <svg
        viewBox="0 0 12 12"
        width={size * 0.8}
        height={size * 0.8}
        shapeRendering="crispEdges"
        className={active ? 'animate-pixel-flame' : ''}
      >
        {cells}
      </svg>
    </div>
  );
}

/** Three squares that light up in sequence: the pixel-art loading indicator. */
export function PixelSpinner({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[2px] ${className}`} aria-label="Working">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="block h-[6px] w-[6px] bg-current animate-pixel-blink"
          style={{ animationDelay: `${i * 0.33}s` }}
        />
      ))}
    </span>
  );
}

/** Pixel glyphs for row status. */
export function PixelCheck({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 7 7" width={11} height={11} shapeRendering="crispEdges" className={className} aria-hidden>
      <path fill="currentColor" d="M0 3h1v1H0zM1 4h1v1H1zM2 5h1v1H2zM3 4h1v1H3zM4 3h1v1H4zM5 2h1v1H5zM6 1h1v1H6z" />
    </svg>
  );
}

export function PixelCross({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 7 7" width={11} height={11} shapeRendering="crispEdges" className={className} aria-hidden>
      <path fill="currentColor" d="M0 0h1v1H0zM6 0h1v1H6zM1 1h1v1H1zM5 1h1v1H5zM2 2h1v1H2zM4 2h1v1H4zM3 3h1v1H3zM2 4h1v1H2zM4 4h1v1H4zM1 5h1v1H1zM5 5h1v1H5zM0 6h1v1H0zM6 6h1v1H6z" />
    </svg>
  );
}

export function PixelArrow({ className = '', dir = 'right' }: { className?: string; dir?: 'right' | 'down' | 'up' }) {
  const rot = dir === 'down' ? 90 : dir === 'up' ? -90 : 0;
  return (
    <svg viewBox="0 0 5 7" width={8} height={10} shapeRendering="crispEdges" className={className} style={{ transform: `rotate(${rot}deg)` }} aria-hidden>
      <path fill="currentColor" d="M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z" />
    </svg>
  );
}

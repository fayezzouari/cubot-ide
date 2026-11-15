import { cn } from '@/lib/utils';

/**
 * Shows one region of a workspace screenshot, zoomed to fill the box.
 * `zoom` is how many times wider the image is than the box; `x` and `y`
 * place the region (0–100, like background-position).
 */
export default function ShotCrop({
  src,
  zoom,
  x,
  y,
  className,
}: {
  src: string;
  zoom: number;
  x: number;
  y: number;
  className?: string;
}) {
  return (
    <div
      role="presentation"
      className={cn('bg-well bg-no-repeat', className)}
      style={{
        backgroundImage: `url(${src})`,
        backgroundSize: `${zoom * 100}% auto`,
        backgroundPosition: `${x}% ${y}%`,
      }}
    />
  );
}

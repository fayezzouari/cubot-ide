'use client';

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Robot } from '@/lib/fleet/types';
import { FLEET_COLORS, getBackgroundPreset, TASK_MARKER_COLOR, WALL_THICKNESS, type BackgroundPresetDef } from '@/lib/fleet/constants';
import type { EnvironmentViewProps } from './types';

interface RobotDrag {
  id: string;
  x: number;
  y: number;
}

const LABEL = 'rgba(255, 255, 255, 0.78)';
const LABEL_DIM = 'rgba(255, 255, 255, 0.55)';
const RING = 'rgba(255, 255, 255, 0.9)';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function TexturePattern({
  id,
  texture,
  surface,
  accent,
}: {
  id: string;
  texture: BackgroundPresetDef['texture'];
  surface: string;
  accent: string;
}) {
  if (texture === 'crosshatch') {
    return (
      <pattern id={id} width={1} height={1} patternUnits="userSpaceOnUse">
        <rect width={1} height={1} fill={surface} />
        <path d="M0,1 L1,0" stroke={accent} strokeWidth={0.04} opacity={0.5} />
      </pattern>
    );
  }
  if (texture === 'speckle') {
    return (
      <pattern id={id} width={2} height={2} patternUnits="userSpaceOnUse">
        <rect width={2} height={2} fill={surface} />
        <circle cx={0.4} cy={0.5} r={0.05} fill={accent} opacity={0.5} />
        <circle cx={1.3} cy={0.9} r={0.04} fill={accent} opacity={0.4} />
        <circle cx={0.9} cy={1.6} r={0.06} fill={accent} opacity={0.35} />
        <circle cx={1.7} cy={0.3} r={0.03} fill={accent} opacity={0.45} />
      </pattern>
    );
  }
  if (texture === 'stripes') {
    return (
      <pattern id={id} width={1.2} height={1.2} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={1.2} height={1.2} fill={surface} />
        <rect width={0.5} height={1.2} fill={accent} opacity={0.12} />
      </pattern>
    );
  }
  if (texture === 'grain') {
    return (
      <pattern id={id} width={1.5} height={1.5} patternUnits="userSpaceOnUse">
        <rect width={1.5} height={1.5} fill={surface} />
        <circle cx={0.3} cy={0.4} r={0.04} fill={accent} opacity={0.3} />
        <circle cx={1.1} cy={0.9} r={0.03} fill={accent} opacity={0.25} />
        <circle cx={0.7} cy={1.2} r={0.05} fill={accent} opacity={0.2} />
      </pattern>
    );
  }
  return null;
}

export function Environment2D(props: EnvironmentViewProps) {
  const {
    environment,
    robots,
    drones = [],
    tasks,
    paths,
    taskColors,
    selectedRobotId,
    selectedDroneId,
    onPick,
    onRobotSelect,
    onRobotMove,
    onDroneSelect,
  } = props;

  const uid = useId().replace(/:/g, '');
  const floorId = `fleet-floor-${uid}`;
  const wallId = `fleet-wall-${uid}`;

  const robotColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const robot of robots) map.set(robot.id, robot.color);
    return map;
  }, [robots]);

  const width = Math.max(0, Math.floor(environment.width) || 0);
  const height = Math.max(0, Math.floor(environment.height) || 0);
  const hasArea = width > 0 && height > 0;

  const preset = getBackgroundPreset(environment.background);
  const surfaceFill = preset.texture === 'none' ? preset.surface : `url(#${floorId})`;
  const wallFill = preset.texture === 'none' ? preset.wall : `url(#${wallId})`;

  const svgRef = useRef<SVGSVGElement | null>(null);

  const obstacleCells = useMemo<{ x: number; y: number }[]>(() => {
    if (!hasArea || !Array.isArray(environment.obstacles)) return [];
    const cells: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y += 1) {
      const row = environment.obstacles[y];
      if (!Array.isArray(row)) continue;
      for (let x = 0; x < width; x += 1) {
        if (row[x] === 1) cells.push({ x, y });
      }
    }
    return cells;
  }, [environment.obstacles, width, height, hasArea]);

  const gridLines = useMemo(() => {
    const vertical: number[] = [];
    const horizontal: number[] = [];
    for (let x = 1; x < width; x += 1) vertical.push(x);
    for (let y = 1; y < height; y += 1) horizontal.push(y);
    return { vertical, horizontal };
  }, [width, height]);

  const pointToGrid = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg || !hasArea) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const totalWidth = width + WALL_THICKNESS * 2;
      const totalHeight = height + WALL_THICKNESS * 2;
      const scale = Math.min(rect.width / totalWidth, rect.height / totalHeight);
      const offsetX = (rect.width - totalWidth * scale) / 2;
      const offsetY = (rect.height - totalHeight * scale) / 2;
      return {
        x: (clientX - rect.left - offsetX) / scale - WALL_THICKNESS,
        y: (clientY - rect.top - offsetY) / scale - WALL_THICKNESS,
      };
    },
    [hasArea, width, height],
  );

  const toCell = useCallback(
    (g: { x: number; y: number }) => ({
      x: clamp(Math.floor(g.x), 0, width - 1),
      y: clamp(Math.floor(g.y), 0, height - 1),
    }),
    [width, height],
  );

  const [drag, setDrag] = useState<RobotDrag | null>(null);
  const suppressClick = useRef(false);
  const dragMoved = useRef(false);

  const blockedCells = useMemo(() => new Set(obstacleCells.map((c) => `${c.x},${c.y}`)), [obstacleCells]);

  const startRobotDrag = useCallback(
    (robot: Robot) => (event: ReactPointerEvent<SVGGElement>) => {
      if (!onRobotSelect && !onRobotMove) return;
      event.stopPropagation();
      if (robot.id !== selectedRobotId) {
        onRobotSelect?.(robot.id);
        return;
      }
      if (!onRobotMove) return;
      svgRef.current?.setPointerCapture(event.pointerId);
      dragMoved.current = false;
      setDrag({ id: robot.id, x: robot.position.x + 0.5, y: robot.position.y + 0.5 });
    },
    [onRobotSelect, onRobotMove, selectedRobotId],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!drag) return;
      const g = pointToGrid(event.clientX, event.clientY);
      if (!g) return;
      dragMoved.current = true;
      setDrag({ id: drag.id, x: clamp(g.x, 0, width), y: clamp(g.y, 0, height) });
    },
    [drag, pointToGrid, width, height],
  );

  const endRobotDrag = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!drag) return;
      const svg = svgRef.current;
      if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      suppressClick.current = true;
      if (dragMoved.current) onRobotMove?.(drag.id, toCell(drag));
      dragMoved.current = false;
      setDrag(null);
    },
    [drag, onRobotMove, toCell],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      const g = pointToGrid(event.clientX, event.clientY);
      if (!g) return;
      if (!onPick) {
        onRobotSelect?.(null);
        return;
      }
      onPick(toCell(g));
    },
    [onPick, onRobotSelect, pointToGrid, toCell],
  );

  if (!hasArea) {
    return <div className="flex h-full w-full items-center justify-center text-xs text-white/30">No environment to display</div>;
  }

  const showLabels = width <= 40 && height <= 40;

  return (
    <div className="h-full w-full p-3">
      <svg
        ref={svgRef}
        viewBox={`${-WALL_THICKNESS} ${-WALL_THICKNESS} ${width + WALL_THICKNESS * 2} ${height + WALL_THICKNESS * 2}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ background: 'transparent', touchAction: drag ? 'none' : undefined, cursor: onPick ? 'crosshair' : undefined }}
        onClick={handleClick}
        onPointerDown={() => {
          suppressClick.current = false;
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={endRobotDrag}
        onPointerCancel={endRobotDrag}
      >
        <defs>
          <TexturePattern id={floorId} texture={preset.texture} surface={preset.surface} accent={preset.accent} />
          <TexturePattern id={wallId} texture={preset.texture} surface={preset.wall} accent={preset.accent} />
        </defs>

        <rect
          x={-WALL_THICKNESS}
          y={-WALL_THICKNESS}
          width={width + WALL_THICKNESS * 2}
          height={height + WALL_THICKNESS * 2}
          fill={wallFill}
        />
        <rect x={0} y={0} width={width} height={height} fill={surfaceFill} />

        <g stroke={preset.grid} strokeWidth={1} vectorEffect="non-scaling-stroke">
          {gridLines.vertical.map((x) => (
            <line key={`v-${x}`} x1={x} y1={0} x2={x} y2={height} />
          ))}
          {gridLines.horizontal.map((y) => (
            <line key={`h-${y}`} x1={0} y1={y} x2={width} y2={y} />
          ))}
        </g>

        <rect x={0} y={0} width={width} height={height} fill="none" stroke={preset.border} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

        <g fill={preset.obstacle}>
          {obstacleCells.map((cell) => (
            <rect key={`o-${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={1} height={1} />
          ))}
        </g>

        {paths
          ? Object.entries(paths).map(([robotId, polyline]) => {
              if (!Array.isArray(polyline) || polyline.length < 2) return null;
              const stroke = robotColorById.get(robotId) ?? '#737373';
              const points = polyline.map((p) => `${p.x + 0.5},${p.y + 0.5}`).join(' ');
              return (
                <polyline
                  key={`p-${robotId}`}
                  points={points}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={0.55}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })
          : null}

        {tasks.map((task) => {
          const cx = task.position.x + 0.5;
          const cy = task.position.y + 0.5;
          const priority = Number.isFinite(task.priority) ? task.priority : 1;
          const size = clamp(0.22 + priority * 0.04, 0.22, 0.42);
          const assignedColor = task.assigned_robot_id ? robotColorById.get(task.assigned_robot_id) : undefined;
          const color = taskColors?.[task.id] ?? assignedColor ?? TASK_MARKER_COLOR[task.status];
          const pulsing = task.status === 'pending' || task.status === 'assigned';
          const done = task.status === 'done';
          const markerSize = done ? size * 0.6 : size;
          return (
            <g key={`t-${task.id}`} transform={`translate(${cx} ${cy})`}>
              <g transform="rotate(45)">
                <rect
                  x={-markerSize}
                  y={-markerSize}
                  width={markerSize * 2}
                  height={markerSize * 2}
                  fill={color}
                  opacity={done ? 0.35 : 1}
                  className={pulsing ? 'animate-pulse' : undefined}
                />
                {showLabels ? (
                  <text
                    x={0}
                    y={0}
                    transform="rotate(-45)"
                    fill={FLEET_COLORS.ink}
                    fontSize={size * 0.9}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {priority}
                  </text>
                ) : null}
              </g>
              <text
                x={0}
                y={-(markerSize + 0.12)}
                fill={LABEL}
                fontSize={0.24}
                opacity={done ? 0.4 : 0.85}
                textAnchor="middle"
                dominantBaseline="text-after-edge"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {task.name}
              </text>
            </g>
          );
        })}

        {drag
          ? (() => {
              const cell = toCell(drag);
              const blocked = blockedCells.has(`${cell.x},${cell.y}`);
              const tone = blocked ? FLEET_COLORS.error : '#ffffff';
              return (
                <rect
                  x={cell.x}
                  y={cell.y}
                  width={1}
                  height={1}
                  fill={tone}
                  fillOpacity={0.12}
                  stroke={tone}
                  strokeOpacity={0.65}
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'none' }}
                />
              );
            })()
          : null}

        {robots.map((robot) => {
          const dragging = drag?.id === robot.id;
          const cx = dragging && drag ? drag.x : robot.position.x + 0.5;
          const cy = dragging && drag ? drag.y : robot.position.y + 0.5;
          const radius = 0.4;
          const isSelected = selectedRobotId != null && robot.id === selectedRobotId;
          const heading = Number.isFinite(robot.heading) ? robot.heading : 0;
          const hx = cx + Math.cos(heading) * radius * 1.6;
          const hy = cy + Math.sin(heading) * radius * 1.6;
          const interactive = !!onRobotSelect || !!onRobotMove;
          const cursor = !onRobotSelect
            ? 'default'
            : isSelected
              ? onRobotMove
                ? dragging
                  ? 'grabbing'
                  : 'grab'
                : 'default'
              : selectedRobotId != null
                ? 'not-allowed'
                : 'pointer';
          return (
            <g
              key={`r-${robot.id}`}
              onPointerDown={interactive ? startRobotDrag(robot) : undefined}
              onClick={interactive ? (e) => e.stopPropagation() : undefined}
              style={{ cursor, opacity: dragging ? 0.85 : 1 }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={robot.color}
                stroke={isSelected ? RING : FLEET_COLORS.ink}
                strokeWidth={isSelected ? 2 : 1}
                vectorEffect="non-scaling-stroke"
              />
              {isSelected ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius + 0.18}
                  fill="none"
                  stroke={RING}
                  strokeOpacity={onRobotMove ? 0.85 : 0.6}
                  strokeWidth={onRobotMove ? 1.5 : 1}
                  strokeDasharray={onRobotMove ? '3 2' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              <line x1={cx} y1={cy} x2={hx} y2={hy} stroke={FLEET_COLORS.ink} strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {showLabels ? (
                <text
                  x={cx}
                  y={cy - radius - 0.18}
                  fill={LABEL_DIM}
                  fontSize={0.5}
                  textAnchor="middle"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {robot.name}
                </text>
              ) : null}
            </g>
          );
        })}

        {drones.map((drone) => {
          const cx = drone.position.x + 0.5;
          const cy = drone.position.y + 0.5;
          const radius = 0.32;
          const isSelected = selectedDroneId != null && drone.id === selectedDroneId;
          const interactive = !!onDroneSelect;
          return (
            <g
              key={`d-${drone.id}`}
              onClick={
                interactive
                  ? (e) => {
                      e.stopPropagation();
                      onDroneSelect?.(isSelected ? null : drone.id);
                    }
                  : undefined
              }
              style={{ cursor: interactive ? 'pointer' : 'default' }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={drone.color}
                stroke={isSelected ? RING : FLEET_COLORS.ink}
                strokeWidth={isSelected ? 2 : 1}
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={cx - radius * 0.55}
                y={cy - radius * 0.55}
                width={radius * 1.1}
                height={radius * 1.1}
                fill="none"
                stroke={FLEET_COLORS.ink}
                strokeWidth={1}
                transform={`rotate(45 ${cx} ${cy})`}
                vectorEffect="non-scaling-stroke"
              />
              {isSelected ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius + 0.18}
                  fill="none"
                  stroke={RING}
                  strokeOpacity={0.6}
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {showLabels ? (
                <text
                  x={cx}
                  y={cy - radius - 0.18}
                  fill={LABEL_DIM}
                  fontSize={0.5}
                  textAnchor="middle"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {drone.name} · {drone.position.z.toFixed(1)}m
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

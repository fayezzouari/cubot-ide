'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Grid, Line, OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import type { Drone, Environment, Robot, Task } from '@/lib/fleet/types';
import {
  FLEET_COLORS,
  getBackgroundPreset,
  ROBOT_MODEL_SIZE,
  ROBOT_MODEL_URL,
  ROBOT_MODEL_YAW,
  TASK_MARKER_COLOR,
  WALL_HEIGHT,
  WALL_THICKNESS,
  type BackgroundPresetDef,
} from '@/lib/fleet/constants';
import type { EnvironmentViewProps } from './types';

const TEXTURE_TILE_SIZE: Record<BackgroundPresetDef['texture'], number> = {
  none: 1,
  crosshatch: 1,
  speckle: 2,
  stripes: 1.2,
  grain: 1.5,
};

function paintFloorTexture(ctx: CanvasRenderingContext2D, preset: BackgroundPresetDef, size: number) {
  ctx.fillStyle = preset.surface;
  ctx.fillRect(0, 0, size, size);
  if (preset.texture === 'crosshatch') {
    ctx.strokeStyle = preset.accent;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);
    ctx.stroke();
  } else if (preset.texture === 'speckle' || preset.texture === 'grain') {
    ctx.fillStyle = preset.accent;
    const count = preset.texture === 'speckle' ? 60 : 40;
    for (let i = 0; i < count; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = size * (0.01 + Math.random() * 0.02);
      ctx.globalAlpha = 0.2 + Math.random() * 0.25;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (preset.texture === 'stripes') {
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-size / 2, -size / 2);
    ctx.fillStyle = preset.accent;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(0, 0, size / 2.4, size * 3);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function useFloorTexture(preset: BackgroundPresetDef, width: number, height: number): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (preset.texture === 'none') return null;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    paintFloorTexture(ctx, preset, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    const tile = TEXTURE_TILE_SIZE[preset.texture];
    texture.repeat.set(Math.max(width, 1) / tile, Math.max(height, 1) / tile);
    texture.needsUpdate = true;
    return texture;
  }, [preset, width, height]);
}

interface CarTemplate {
  object: THREE.Group;
  scale: number;
}

function useCarTemplate(): CarTemplate {
  const raw = useLoader(LDrawLoader, ROBOT_MODEL_URL, (loader) => {
    loader.smoothNormals = true;
  });
  return useMemo(() => {
    const object = (raw as THREE.Group).clone(true);
    object.rotation.x = Math.PI;
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    object.position.set(-center.x, -box.min.y, -center.z);
    return { object, scale: ROBOT_MODEL_SIZE / maxDim };
  }, [raw]);
}

interface RobotDrag {
  id: string;
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function FloorAndGrid({
  width,
  height,
  preset,
  onPick,
  onDragOver,
}: {
  width: number;
  height: number;
  preset: BackgroundPresetDef;
  onPick?: (cell: { x: number; y: number }) => void;
  onDragOver?: (point: { x: number; y: number }) => void;
}) {
  const texture = useFloorTexture(preset, width, height);
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!onPick) return;
    event.stopPropagation();
    const col = Math.floor(event.point.x + width / 2);
    const row = Math.floor(event.point.z + height / 2);
    if (col < 0 || col >= width || row < 0 || row >= height) return;
    onPick({ x: col, y: row });
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!onDragOver) return;
    event.stopPropagation();
    onDragOver({ x: event.point.x + width / 2, y: event.point.z + height / 2 });
  };

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow onClick={handleClick} onPointerMove={handlePointerMove}>
        <planeGeometry args={[Math.max(width, 1), Math.max(height, 1)]} />
        <meshStandardMaterial color={texture ? '#ffffff' : preset.surface} map={texture} roughness={0.95} metalness={0.05} />
      </mesh>
      <Grid
        args={[Math.max(width, 1), Math.max(height, 1)]}
        position={[0, 0.01, 0]}
        cellSize={1}
        cellThickness={0.6}
        cellColor={preset.grid}
        sectionSize={5}
        sectionThickness={1}
        sectionColor={preset.border}
        fadeDistance={Math.max(width, height) * 2.5}
        fadeStrength={1.2}
        infiniteGrid={false}
      />
    </group>
  );
}

function Obstacles({ environment, preset }: { environment: Environment; preset: BackgroundPresetDef }) {
  const { width, height, obstacles } = environment;
  const blocked = useMemo(() => {
    const cells: { x: number; y: number }[] = [];
    for (let row = 0; row < height; row += 1) {
      const line = obstacles[row];
      if (!line) continue;
      for (let col = 0; col < width; col += 1) {
        if (line[col] === 1) cells.push({ x: col, y: row });
      }
    }
    return cells;
  }, [width, height, obstacles]);

  if (blocked.length === 0) return null;

  return (
    <group>
      {blocked.map((cell) => (
        <mesh key={`obs-${cell.x}-${cell.y}`} position={[cell.x - width / 2 + 0.5, 0.3, cell.y - height / 2 + 0.5]} castShadow receiveShadow>
          <boxGeometry args={[0.95, 0.6, 0.95]} />
          <meshStandardMaterial color={preset.obstacle} roughness={0.7} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function Walls({ width, height, preset }: { width: number; height: number; preset: BackgroundPresetDef }) {
  const segments = useMemo(
    () => [
      {
        key: 'n',
        size: [width + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as const,
        position: [0, WALL_HEIGHT / 2, -height / 2 - WALL_THICKNESS / 2] as const,
      },
      {
        key: 's',
        size: [width + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as const,
        position: [0, WALL_HEIGHT / 2, height / 2 + WALL_THICKNESS / 2] as const,
      },
      {
        key: 'e',
        size: [WALL_THICKNESS, WALL_HEIGHT, height] as const,
        position: [width / 2 + WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0] as const,
      },
      {
        key: 'w',
        size: [WALL_THICKNESS, WALL_HEIGHT, height] as const,
        position: [-width / 2 - WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0] as const,
      },
    ],
    [width, height],
  );

  return (
    <group>
      {segments.map((segment) => (
        <mesh key={segment.key} position={segment.position} castShadow receiveShadow>
          <boxGeometry args={segment.size} />
          <meshStandardMaterial color={preset.wall} roughness={0.85} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

function RobotMesh({
  robot,
  width,
  height,
  selected,
  locked,
  dragPos,
  interactive,
  onGrab,
}: {
  robot: Robot;
  width: number;
  height: number;
  selected: boolean;
  locked?: boolean;
  dragPos?: { x: number; y: number } | null;
  interactive?: boolean;
  onGrab?: (robot: Robot) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const template = useCarTemplate();
  const car = useMemo(() => template.object.clone(true), [template]);

  const target = useMemo(
    () =>
      new THREE.Vector3(
        (dragPos ? dragPos.x : robot.position.x + 0.5) - width / 2,
        robot.position.z + 0.3,
        (dragPos ? dragPos.y : robot.position.y + 0.5) - height / 2,
      ),
    [dragPos, robot.position.x, robot.position.y, robot.position.z, width, height],
  );

  useEffect(
    () => () => {
      document.body.style.cursor = '';
    },
    [],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const lerp = dragPos ? 1 : Math.min(1, delta * 8);
    group.position.lerp(target, lerp);
    const targetYaw = Math.atan2(Math.cos(robot.heading), Math.sin(robot.heading));
    const d = Math.atan2(Math.sin(targetYaw - group.rotation.y), Math.cos(targetYaw - group.rotation.y));
    group.rotation.y += d * lerp;
  });

  return (
    <group
      ref={groupRef}
      position={target}
      onPointerDown={
        interactive
          ? (e) => {
              e.stopPropagation();
              onGrab?.(robot);
            }
          : undefined
      }
      onPointerOver={
        interactive
          ? (e) => {
              e.stopPropagation();
              document.body.style.cursor = selected ? 'grab' : locked ? 'not-allowed' : 'pointer';
            }
          : undefined
      }
      onPointerOut={
        interactive
          ? () => {
              document.body.style.cursor = '';
            }
          : undefined
      }
    >
      <group position={[0, -0.3, 0]} rotation={[0, ROBOT_MODEL_YAW, 0]} scale={template.scale}>
        <primitive object={car} />
      </group>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.28, 0]}>
          <ringGeometry args={[0.6, 0.74, 32]} />
          <meshBasicMaterial color={robot.color} transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh position={[0, 0.7, 0]}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshBasicMaterial color={robot.color} />
      </mesh>
    </group>
  );
}

const DRONE_ROTOR_OFFSETS: readonly [number, number][] = [
  [0.35, 0.35],
  [-0.35, 0.35],
  [0.35, -0.35],
  [-0.35, -0.35],
];

function DroneMesh({
  drone,
  width,
  height,
  selected,
  interactive,
  onSelect,
}: {
  drone: Drone;
  width: number;
  height: number;
  selected: boolean;
  interactive?: boolean;
  onSelect?: (drone: Drone) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const rotorRef = useRef<THREE.Group>(null);

  const target = useMemo(
    () => new THREE.Vector3(drone.position.x + 0.5 - width / 2, drone.position.z, drone.position.y + 0.5 - height / 2),
    [drone.position.x, drone.position.y, drone.position.z, width, height],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (group) group.position.lerp(target, Math.min(1, delta * 8));
    const rotor = rotorRef.current;
    if (rotor) rotor.rotation.y += delta * 20;
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[drone.position.x + 0.5 - width / 2, 0.015, drone.position.y + 0.5 - height / 2]}>
        <circleGeometry args={[0.32, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.45} />
      </mesh>

      <group
        ref={groupRef}
        position={target}
        onPointerDown={
          interactive
            ? (e) => {
                e.stopPropagation();
                onSelect?.(drone);
              }
            : undefined
        }
        onPointerOver={
          interactive
            ? (e) => {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
              }
            : undefined
        }
        onPointerOut={
          interactive
            ? () => {
                document.body.style.cursor = '';
              }
            : undefined
        }
      >
        <mesh castShadow>
          <boxGeometry args={[0.36, 0.1, 0.36]} />
          <meshStandardMaterial color={drone.color} roughness={0.4} metalness={0.3} />
        </mesh>
        <group ref={rotorRef}>
          {DRONE_ROTOR_OFFSETS.map(([dx, dz]) => (
            <group key={`${dx}-${dz}`} position={[dx, 0.02, dz]}>
              <mesh>
                <cylinderGeometry args={[0.02, 0.02, 0.18, 6]} />
                <meshStandardMaterial color="#a3a3a3" />
              </mesh>
              <mesh position={[0, 0.1, 0]}>
                <cylinderGeometry args={[0.16, 0.16, 0.015, 10]} />
                <meshStandardMaterial color="#d4d4d4" transparent opacity={0.45} />
              </mesh>
            </group>
          ))}
        </group>
        {selected && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
            <ringGeometry args={[0.42, 0.5, 32]} />
            <meshBasicMaterial color={drone.color} transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    </group>
  );
}

function TaskMarker({ task, width, height, color }: { task: Task; width: number; height: number; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const baseY = task.position.z + 1.2;
  const done = task.status === 'done';
  const scale = (0.6 + Math.min(Math.max(task.priority, 0), 10) * 0.06) * (done ? 0.6 : 1);
  const [phase] = useState(() => Math.random() * Math.PI * 2);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.position.y = baseY + Math.sin(state.clock.elapsedTime * 1.5 + phase) * 0.15;
    mesh.rotation.y += 0.01;
  });

  return (
    <group position={[task.position.x - width / 2 + 0.5, 0, task.position.y - height / 2 + 0.5]}>
      <mesh ref={meshRef} position={[0, baseY, 0]} scale={scale} castShadow={!done}>
        <octahedronGeometry args={[0.3, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={done ? 0.1 : 0.5}
          roughness={0.4}
          metalness={0.3}
          transparent
          opacity={done ? 0.35 : 1}
        />
      </mesh>
      <mesh position={[0, baseY / 2, 0]}>
        <cylinderGeometry args={[0.02, 0.02, baseY, 6]} />
        <meshBasicMaterial color={color} transparent opacity={done ? 0.12 : 0.35} />
      </mesh>
      <Billboard position={[0, baseY + 0.5, 0]}>
        <Text
          fontSize={0.26}
          color="#e5e5e5"
          outlineWidth={0.018}
          outlineColor={FLEET_COLORS.ink}
          anchorX="center"
          anchorY="bottom"
          fillOpacity={done ? 0.4 : 1}
          outlineOpacity={done ? 0.4 : 1}
        >
          {task.name}
        </Text>
      </Billboard>
    </group>
  );
}

function PathLines({
  paths,
  robots,
  width,
  height,
}: {
  paths: Record<string, { x: number; y: number }[]>;
  robots: Robot[];
  width: number;
  height: number;
}) {
  const colorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const robot of robots) map.set(robot.id, robot.color);
    return map;
  }, [robots]);

  const lines = useMemo(() => {
    const result: { id: string; color: string; points: THREE.Vector3[] }[] = [];
    for (const [robotId, polyline] of Object.entries(paths)) {
      if (!polyline || polyline.length < 2) continue;
      const points = polyline.map((p) => new THREE.Vector3(p.x - width / 2 + 0.5, 0.05, p.y - height / 2 + 0.5));
      result.push({ id: robotId, color: colorById.get(robotId) ?? '#737373', points });
    }
    return result;
  }, [paths, colorById, width, height]);

  if (lines.length === 0) return null;

  return (
    <group>
      {lines.map((line) => (
        <Line key={`path-${line.id}`} points={line.points} color={line.color} lineWidth={2} transparent opacity={0.6} />
      ))}
    </group>
  );
}

function Scene({
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
}: EnvironmentViewProps) {
  const width = Math.max(1, Math.floor(environment.width) || 1);
  const height = Math.max(1, Math.floor(environment.height) || 1);
  const preset = useMemo(() => getBackgroundPreset(environment.background), [environment.background]);

  const robotColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const robot of robots) map.set(robot.id, robot.color);
    return map;
  }, [robots]);

  const interactive = !!onRobotSelect || !!onRobotMove;
  const [drag, setDrag] = useState<RobotDrag | null>(null);
  const dragRef = useRef<RobotDrag | null>(null);
  dragRef.current = drag;
  const dragMoved = useRef(false);
  const dragging = drag !== null;
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;

  const handleGrab = useCallback(
    (robot: Robot) => {
      if (robot.id !== selectedRobotId) {
        onRobotSelect?.(robot.id);
        return;
      }
      if (!onRobotMove) return;
      if (controls) controls.enabled = false;
      document.body.style.cursor = 'grabbing';
      dragMoved.current = false;
      setDrag({ id: robot.id, x: robot.position.x + 0.5, y: robot.position.y + 0.5 });
    },
    [onRobotSelect, onRobotMove, selectedRobotId, controls],
  );

  const handleDragOver = useCallback(
    (point: { x: number; y: number }) => {
      const current = dragRef.current;
      if (!current) return;
      dragMoved.current = true;
      setDrag({ id: current.id, x: clamp(point.x, 0, width), y: clamp(point.y, 0, height) });
    },
    [width, height],
  );

  useEffect(() => {
    if (!dragging) return;
    const end = () => {
      const current = dragRef.current;
      if (current && dragMoved.current) {
        onRobotMove?.(current.id, {
          x: clamp(Math.floor(current.x), 0, width - 1),
          y: clamp(Math.floor(current.y), 0, height - 1),
        });
      }
      dragMoved.current = false;
      document.body.style.cursor = '';
      if (controls) controls.enabled = true;
      setDrag(null);
    };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, [dragging, onRobotMove, width, height, controls]);

  const dropCell = drag
    ? { x: clamp(Math.floor(drag.x), 0, width - 1), y: clamp(Math.floor(drag.y), 0, height - 1) }
    : null;
  const dropBlocked = dropCell != null && environment.obstacles?.[dropCell.y]?.[dropCell.x] === 1;

  return (
    <>
      <color attach="background" args={[preset.fog]} />
      <fog attach="fog" args={[preset.fog, 20, Math.max(width, height) * 4]} />
      <ambientLight intensity={0.85} />
      <directionalLight
        position={[width, Math.max(width, height), height]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={Math.max(width, height) * 6}
        shadow-camera-left={-width}
        shadow-camera-right={width}
        shadow-camera-top={height}
        shadow-camera-bottom={-height}
      />
      <pointLight position={[-width / 2, 6, -height / 2]} intensity={0.4} color="#93c5fd" distance={Math.max(width, height) * 3} />

      <FloorAndGrid width={width} height={height} preset={preset} onPick={onPick} onDragOver={dragging ? handleDragOver : undefined} />
      <Obstacles environment={{ ...environment, width, height }} preset={preset} />
      <Walls width={width} height={height} preset={preset} />

      {dropCell && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[dropCell.x - width / 2 + 0.5, 0.02, dropCell.y - height / 2 + 0.5]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color={dropBlocked ? FLEET_COLORS.error : '#ffffff'} transparent opacity={0.25} />
        </mesh>
      )}

      <Suspense fallback={null}>
        {robots.map((robot) => (
          <RobotMesh
            key={robot.id}
            robot={robot}
            width={width}
            height={height}
            selected={selectedRobotId === robot.id}
            locked={selectedRobotId != null && selectedRobotId !== robot.id}
            dragPos={drag?.id === robot.id ? drag : null}
            interactive={interactive}
            onGrab={handleGrab}
          />
        ))}
      </Suspense>

      {drones.map((drone) => (
        <DroneMesh
          key={drone.id}
          drone={drone}
          width={width}
          height={height}
          selected={selectedDroneId === drone.id}
          interactive={!!onDroneSelect}
          onSelect={(d) => onDroneSelect?.(d.id)}
        />
      ))}

      <Suspense fallback={null}>
        {tasks.map((task) => (
          <TaskMarker
            key={task.id}
            task={task}
            width={width}
            height={height}
            color={
              taskColors?.[task.id] ??
              (task.assigned_robot_id ? robotColorById.get(task.assigned_robot_id) : undefined) ??
              TASK_MARKER_COLOR[task.status]
            }
          />
        ))}
      </Suspense>

      {paths && <PathLines paths={paths} robots={robots} width={width} height={height} />}

      <OrbitControls
        makeDefault
        enabled={!dragging}
        enablePan
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={0.1}
        maxPolarAngle={Math.PI / 2 - 0.05}
        target={[0, 0, 0]}
      />
    </>
  );
}

export default function Environment3D(props: EnvironmentViewProps) {
  const width = Math.max(1, Math.floor(props.environment.width) || 1);
  const height = Math.max(1, Math.floor(props.environment.height) || 1);
  const span = Math.max(width, height);

  return (
    <div className="h-full w-full">
      <Canvas shadows camera={{ position: [span * 0.9, span * 1.1, span * 1.4], fov: 50 }}>
        <Scene {...props} />
      </Canvas>
    </div>
  );
}

'use client';

// 3D view of the simulated workcell. Everything is modelled in millimetres
// inside a 0.001-scaled group, and every frame reads the World directly so the
// React tree only re-renders when parts are added or removed.
//
// Stations are drawn from the cell layout. In edit mode they can be selected,
// dragged on the floor, rotated (R) and nudged (arrow keys).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, extend, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { ARM, isReachable } from '@/lib/blocks/kinematics';
import {
  BIN_WALL,
  CONVEYOR_STOP_INSET,
  CONVEYOR_TOP,
  CONVEYOR_WIDTH,
  FENCE_THICKNESS,
  FIXTURE_TOP,
  FLOOR,
  footprint,
  PALLET_TOP,
  param,
  TRAY_PITCH,
  TRAY_TOP,
  traySize,
  type CellLayout,
  type Station,
} from '@/lib/blocks/layout';
import { PART_SIZE, type Part, type World } from '@/lib/blocks/workcell';
import { useWorldVersion } from '@/lib/blocks/useWorld';

// @ts-ignore — registering the full namespace is valid at runtime
extend(THREE);

const rad = THREE.MathUtils.degToRad;

const PART_COLORS: Record<string, string> = {
  red: '#ef4444',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#facc15',
};

function Arm({ world }: { world: World }) {
  const j = [
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
  ];
  const fingerL = useRef<THREE.Mesh>(null);
  const fingerR = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const q = world.joints;
    if (j[0].current) j[0].current.rotation.y = rad(q[0]);
    if (j[1].current) j[1].current.rotation.x = rad(q[1]);
    if (j[2].current) j[2].current.rotation.x = rad(q[2]);
    if (j[3].current) j[3].current.rotation.y = rad(q[3]);
    if (j[4].current) j[4].current.rotation.x = rad(q[4]);
    if (j[5].current) j[5].current.rotation.y = rad(q[5]);
    const gap = 12 + 30 * world.gripperWidth;
    if (fingerL.current) fingerL.current.position.x = -gap - 4;
    if (fingerR.current) fingerR.current.position.x = gap + 4;
  });

  const body = '#e5e7eb';
  const joint = '#f97316';
  return (
    <group>
      <mesh position={[0, 30, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[130, 150, 60, 40]} />
        <meshStandardMaterial color="#27272a" metalness={0.4} roughness={0.5} />
      </mesh>
      <group ref={j[0]} position={[0, 60, 0]}>
        <mesh position={[0, (ARM.shoulderHeight - 60) / 2, 0]} castShadow>
          <cylinderGeometry args={[85, 100, ARM.shoulderHeight - 60, 32]} />
          <meshStandardMaterial color={body} metalness={0.2} roughness={0.4} />
        </mesh>
        <group ref={j[1]} position={[0, ARM.shoulderHeight - 60, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[70, 70, 170, 32]} />
            <meshStandardMaterial color={joint} metalness={0.3} roughness={0.4} />
          </mesh>
          <mesh position={[0, ARM.upperArm / 2, 0]} castShadow>
            <boxGeometry args={[90, ARM.upperArm, 90]} />
            <meshStandardMaterial color={body} metalness={0.2} roughness={0.4} />
          </mesh>
          <group ref={j[2]} position={[0, ARM.upperArm, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[55, 55, 140, 32]} />
              <meshStandardMaterial color={joint} metalness={0.3} roughness={0.4} />
            </mesh>
            <group ref={j[3]}>
              <mesh position={[0, ARM.forearm / 2, 0]} castShadow>
                <boxGeometry args={[70, ARM.forearm, 70]} />
                <meshStandardMaterial color={body} metalness={0.2} roughness={0.4} />
              </mesh>
              <group ref={j[4]} position={[0, ARM.forearm, 0]}>
                <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                  <cylinderGeometry args={[40, 40, 100, 24]} />
                  <meshStandardMaterial color={joint} metalness={0.3} roughness={0.4} />
                </mesh>
                <group ref={j[5]}>
                  <mesh position={[0, 45, 0]} castShadow>
                    <cylinderGeometry args={[30, 30, 70, 24]} />
                    <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.3} />
                  </mesh>
                  <mesh position={[0, 90, 0]} castShadow>
                    <boxGeometry args={[110, 24, 44]} />
                    <meshStandardMaterial color="#3f3f46" metalness={0.5} roughness={0.4} />
                  </mesh>
                  <mesh ref={fingerL} position={[-40, 125, 0]} castShadow>
                    <boxGeometry args={[8, 55, 34]} />
                    <meshStandardMaterial color="#a1a1aa" metalness={0.7} roughness={0.3} />
                  </mesh>
                  <mesh ref={fingerR} position={[40, 125, 0]} castShadow>
                    <boxGeometry args={[8, 55, 34]} />
                    <meshStandardMaterial color="#a1a1aa" metalness={0.7} roughness={0.3} />
                  </mesh>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function PartMesh({ world, part }: { world: World; part: Part }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.set(part.pos.x, part.pos.y, part.pos.z);
    if (world.held === part) ref.current.rotation.y = rad(world.joints[0]);
    if (mat.current) {
      mat.current.color.set(part.machined ? '#a8a29e' : PART_COLORS[part.color]);
      mat.current.metalness = part.machined ? 0.8 : 0.1;
    }
  });
  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[PART_SIZE, PART_SIZE, PART_SIZE]} />
      <meshStandardMaterial ref={mat} color={PART_COLORS[part.color]} roughness={0.5} />
      {part.defect && (
        <mesh position={[0, PART_SIZE / 2 + 0.5, 0]} rotation={[-Math.PI / 2, 0, 0.6]}>
          <planeGeometry args={[34, 7]} />
          <meshBasicMaterial color="#111" />
        </mesh>
      )}
    </mesh>
  );
}

function Parts({ world }: { world: World }) {
  useWorldVersion(world, 4);
  return (
    <>
      {world.parts.map((p) => (
        <PartMesh key={p.id} world={world} part={p} />
      ))}
    </>
  );
}

function Label({ y, z = 0, children, tone }: { y: number; z?: number; children: ReactNode; tone?: 'error' | 'warning' | 'selected' }) {
  const cls =
    tone === 'error'
      ? 'bg-red-600/80 text-white'
      : tone === 'warning'
        ? 'bg-amber-500/80 text-black'
        : tone === 'selected'
          ? 'bg-violet-500/90 text-white'
          : 'bg-black/60 text-white/70';
  return (
    <Html position={[0, y, z]} center distanceFactor={1.2} style={{ pointerEvents: 'none' }}>
      <div className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{children}</div>
    </Html>
  );
}

function ConveyorModel({ world, s }: { world: World; s: Station }) {
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const belt = useRef<THREE.MeshStandardMaterial>(null);
  const flash = useRef<THREE.PointLight>(null);
  const length = param(s, 'length');
  const stop = length / 2 - CONVEYOR_STOP_INSET;
  const W = CONVEYOR_WIDTH;
  useFrame(() => {
    if (beam.current) beam.current.color.set(world.conveyorHasPart(s) ? '#22c55e' : '#ef4444');
    if (belt.current) belt.current.color.set(world.conveyorRunning ? '#3f3f46' : '#27272a');
    if (flash.current) flash.current.intensity = world.visionFlash * 3;
  });
  return (
    <group>
      <mesh position={[0, CONVEYOR_TOP - 10, 0]} receiveShadow>
        <boxGeometry args={[length, 20, W]} />
        <meshStandardMaterial ref={belt} color="#27272a" roughness={0.9} />
      </mesh>
      <mesh position={[0, (CONVEYOR_TOP - 20) / 2, 0]}>
        <boxGeometry args={[Math.max(10, length - 40), CONVEYOR_TOP - 20, W - 30]} />
        <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* end stop */}
      <mesh position={[length / 2 - 8, CONVEYOR_TOP + 20, 0]}>
        <boxGeometry args={[16, 40, W]} />
        <meshStandardMaterial color="#f59e0b" />
      </mesh>
      {/* feed direction arrow */}
      <mesh position={[-length / 2 + 40, CONVEYOR_TOP + 1, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
        <circleGeometry args={[22, 3]} />
        <meshBasicMaterial color="#a1a1aa" />
      </mesh>
      {/* photo-eye */}
      <mesh position={[stop, CONVEYOR_TOP + 25, -W / 2 - 15]}>
        <boxGeometry args={[20, 50, 20]} />
        <meshStandardMaterial color="#18181b" />
      </mesh>
      <mesh position={[stop, CONVEYOR_TOP + 25, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.5, 1.5, W + 20, 6]} />
        <meshBasicMaterial ref={beam} color="#ef4444" transparent opacity={0.7} />
      </mesh>
      {/* camera on a post above the pick point */}
      <mesh position={[stop - 120, 330, 120]}>
        <boxGeometry args={[20, 500, 20]} />
        <meshStandardMaterial color="#3f3f46" />
      </mesh>
      <mesh position={[stop - 60, 560, 60]} rotation={[0.6, 0, -0.6]}>
        <boxGeometry args={[60, 40, 80]} />
        <meshStandardMaterial color="#18181b" />
      </mesh>
      <pointLight ref={flash} position={[stop, 400, 0]} color="#bfdbfe" intensity={0} distance={800} />
    </group>
  );
}

function BinModel({ s }: { s: Station }) {
  const size = param(s, 'size');
  const color = param(s, 'color');
  const t = 8;
  return (
    <group>
      <mesh position={[0, 2, 0]} receiveShadow>
        <boxGeometry args={[size, 4, size]} />
        <meshStandardMaterial color="#18181b" />
      </mesh>
      {[
        [0, size / 2, size, t],
        [0, -size / 2, size, t],
        [size / 2, 0, t, size],
        [-size / 2, 0, t, size],
      ].map(([dx, dz, w, d], i) => (
        <mesh key={i} position={[dx, BIN_WALL / 2, dz]} castShadow>
          <boxGeometry args={[w, BIN_WALL, d]} />
          <meshStandardMaterial color={color} transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function PalletModel({ s }: { s: Station }) {
  const size = param(s, 'size');
  const step = size / 2 - 30;
  return (
    <group>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[0, PALLET_TOP / 2 - 5, i * step]} castShadow receiveShadow>
          <boxGeometry args={[size, PALLET_TOP - 10, 50]} />
          <meshStandardMaterial color="#a16207" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, PALLET_TOP - 4, 0]} receiveShadow>
        <boxGeometry args={[size, 8, size]} />
        <meshStandardMaterial color="#ca8a04" roughness={0.9} />
      </mesh>
    </group>
  );
}

function MachineModel({ world }: { world: World }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  const door = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const running = world.machineRunning;
    if (lamp.current) {
      lamp.current.color.set(running ? '#f59e0b' : world.machineDone ? '#22c55e' : '#3f3f46');
      lamp.current.emissive.set(running ? '#f59e0b' : world.machineDone ? '#22c55e' : '#000');
    }
    if (door.current) door.current.position.y = running ? 220 : 480;
  });
  return (
    <group>
      <mesh position={[-230, 300, 0]} castShadow receiveShadow>
        <boxGeometry args={[220, 600, 420]} />
        <meshStandardMaterial color="#334155" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, FIXTURE_TOP / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[110, FIXTURE_TOP, 110]} />
        <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* sliding guard door: drops in front of the fixture during a cycle */}
      <mesh ref={door} position={[80, 480, 0]}>
        <boxGeometry args={[8, 300, 260]} />
        <meshStandardMaterial color="#93c5fd" transparent opacity={0.25} />
      </mesh>
      <mesh position={[-230, 640, 150]}>
        <cylinderGeometry args={[18, 18, 40, 16]} />
        <meshStandardMaterial ref={lamp} color="#3f3f46" emissiveIntensity={1.5} />
      </mesh>
    </group>
  );
}

function TrayModel({ s }: { s: Station }) {
  const { w, d } = traySize(s);
  const rows = param(s, 'rows');
  const cols = param(s, 'cols');
  const pockets = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pockets.push([(c - (cols - 1) / 2) * TRAY_PITCH, (r - (rows - 1) / 2) * TRAY_PITCH]);
    }
  }
  return (
    <group>
      <mesh position={[0, TRAY_TOP / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, TRAY_TOP, d]} />
        <meshStandardMaterial color="#0f766e" roughness={0.7} />
      </mesh>
      {pockets.map(([x, z], i) => (
        <mesh key={i} position={[x, TRAY_TOP + 0.5, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[56, 56]} />
          <meshBasicMaterial color="#134e4a" />
        </mesh>
      ))}
    </group>
  );
}

function TableModel({ s }: { s: Station }) {
  const w = param(s, 'w');
  const d = param(s, 'd');
  const h = param(s, 'h');
  const slab = Math.min(30, h);
  return (
    <group>
      <mesh position={[0, h - slab / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, slab, d]} />
        <meshStandardMaterial color="#78716c" roughness={0.8} />
      </mesh>
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * (w / 2 - 25), (h - slab) / 2, sz * (d / 2 - 25)]} castShadow>
          <boxGeometry args={[30, Math.max(1, h - slab), 30]} />
          <meshStandardMaterial color="#44403c" />
        </mesh>
      ))}
    </group>
  );
}

function FenceModel({ s }: { s: Station }) {
  const length = param(s, 'length');
  const h = param(s, 'h');
  const posts = Math.max(2, Math.round(length / 400) + 1);
  return (
    <group>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[length, h, 6]} />
        <meshStandardMaterial color="#facc15" transparent opacity={0.18} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: posts }, (_, i) => (
        <mesh key={i} position={[-length / 2 + (i * length) / (posts - 1), h / 2, 0]} castShadow>
          <boxGeometry args={[FENCE_THICKNESS, h, FENCE_THICKNESS]} />
          <meshStandardMaterial color="#ca8a04" />
        </mesh>
      ))}
      <mesh position={[0, h - 10, 0]}>
        <boxGeometry args={[length, 20, 20]} />
        <meshStandardMaterial color="#ca8a04" />
      </mesh>
    </group>
  );
}

function BeaconModel({ world }: { world: World }) {
  const green = useRef<THREE.MeshStandardMaterial>(null);
  const red = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    green.current?.emissive.set(world.outputs[2] ? '#22c55e' : '#000');
    red.current?.emissive.set(world.outputs[3] ? '#ef4444' : '#000');
  });
  return (
    <group>
      <mesh position={[0, 5, 0]}>
        <cylinderGeometry args={[30, 30, 10, 16]} />
        <meshStandardMaterial color="#27272a" />
      </mesh>
      <mesh position={[0, 200, 0]}>
        <cylinderGeometry args={[6, 6, 400, 8]} />
        <meshStandardMaterial color="#3f3f46" />
      </mesh>
      <mesh position={[0, 420, 0]}>
        <cylinderGeometry args={[20, 20, 40, 16]} />
        <meshStandardMaterial ref={green} color="#14532d" emissiveIntensity={2} />
      </mesh>
      <mesh position={[0, 462, 0]}>
        <cylinderGeometry args={[20, 20, 40, 16]} />
        <meshStandardMaterial ref={red} color="#7f1d1d" emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

function labelHeight(s: Station): number {
  switch (s.kind) {
    case 'machine':
      return 690;
    case 'beacon':
      return 530;
    case 'fence':
    case 'table':
      return param(s, 'h') + 50;
    case 'conveyor':
      return 180;
    default:
      return 130;
  }
}

function StationModel({ world, s }: { world: World; s: Station }) {
  switch (s.kind) {
    case 'conveyor':
      return <ConveyorModel world={world} s={s} />;
    case 'bin':
      return <BinModel s={s} />;
    case 'pallet':
      return <PalletModel s={s} />;
    case 'machine':
      return <MachineModel world={world} />;
    case 'tray':
      return <TrayModel s={s} />;
    case 'table':
      return <TableModel s={s} />;
    case 'fence':
      return <FenceModel s={s} />;
    case 'beacon':
      return <BeaconModel world={world} />;
  }
}

interface EditProps {
  editing: boolean;
  selectedId: string | null;
  issues: Map<string, 'error' | 'warning'>;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, z: number) => void;
}

function StationNode({
  world,
  s,
  edit,
  onGrab,
}: {
  world: World;
  s: Station;
  edit: EditProps;
  onGrab: (s: Station, e: ThreeEvent<PointerEvent>) => void;
}) {
  const selected = edit.editing && edit.selectedId === s.id;
  const issue = edit.issues.get(s.id);
  const fp = footprint(s);
  return (
    <group
      position={[s.x, 0, s.z]}
      rotation={[0, (s.rot * Math.PI) / 180, 0]}
      onPointerDown={(e) => {
        if (!edit.editing || e.button !== 0) return;
        e.stopPropagation();
        onGrab(s, e);
      }}
      onClick={(e) => edit.editing && e.stopPropagation()}
      onPointerOver={(e) => {
        if (!edit.editing) return;
        e.stopPropagation();
        document.body.style.cursor = 'grab';
      }}
      onPointerOut={() => {
        if (edit.editing) document.body.style.cursor = '';
      }}
    >
      <StationModel world={world} s={s} />
      {edit.editing && (
        <mesh position={[fp.cx, 1.5, fp.cz]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[fp.w + 30, fp.d + 30]} />
          <meshBasicMaterial
            color={selected ? '#8b5cf6' : issue === 'error' ? '#ef4444' : '#a1a1aa'}
            transparent
            opacity={selected ? 0.35 : 0.1}
            depthWrite={false}
          />
        </mesh>
      )}
      <Label y={labelHeight(s)} tone={selected ? 'selected' : edit.editing ? issue : undefined}>
        {s.name}
      </Label>
    </group>
  );
}

// Reachable band at pick height: the ring shows where stations can go.
function ReachRing() {
  const [rmin, rmax] = useMemo(() => {
    let lo = Infinity;
    let hi = 0;
    for (let r = 0; r <= 1400; r += 10) {
      if (isReachable({ x: 0, y: 105, z: r }) && isReachable({ x: 0, y: 225, z: r })) {
        lo = Math.min(lo, r);
        hi = Math.max(hi, r);
      }
    }
    return [lo === Infinity ? 0 : lo, hi];
  }, []);
  // Ring angle θ maps to J1 = θ + 90°; J1 is limited to ±170°.
  return (
    <mesh position={[0, 1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[rmin, rmax, 96, 1, (-260 * Math.PI) / 180, (340 * Math.PI) / 180]} />
      <meshBasicMaterial color="#22c55e" transparent opacity={0.07} depthWrite={false} />
    </mesh>
  );
}

const snap = (v: number, step = 10) => Math.round(v / step) * step;
const clampFloor = (x: number, z: number) => ({
  x: Math.max(-FLOOR.halfX, Math.min(FLOOR.halfX, x)),
  z: Math.max(-FLOOR.halfZ, Math.min(FLOOR.halfZ, z)),
});

function Stations({ world, layout, edit }: { world: World; layout: CellLayout; edit: EditProps }) {
  const [drag, setDrag] = useState<{ id: string; dx: number; dz: number } | null>(null);
  const controls = useThree((st) => st.controls) as OrbitControlsImpl | null;

  useEffect(() => {
    if (controls) controls.enabled = !drag;
    if (!drag) return;
    const end = () => setDrag(null);
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, [drag, controls]);

  // Pointer position on the floor, in mm.
  const floorPoint = (e: ThreeEvent<PointerEvent>) => {
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    return { x: hit.x * 1000, z: hit.z * 1000 };
  };

  const grab = (s: Station, e: ThreeEvent<PointerEvent>) => {
    edit.onSelect(s.id);
    // Synchronously, so the orbit controls ignore the rest of this gesture.
    if (controls) controls.enabled = false;
    const p = floorPoint(e);
    if (p) setDrag({ id: s.id, dx: s.x - p.x, dz: s.z - p.z });
    else if (controls) controls.enabled = true;
  };

  return (
    <>
      {layout.stations.map((s) => (
        <StationNode key={s.id} world={world} s={s} edit={edit} onGrab={grab} />
      ))}
      {edit.editing && <ReachRing />}
      {/* Catches pointer moves while dragging, and clicks on empty floor. */}
      {edit.editing && (
        <mesh
          position={[0, 0.2, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = floorPoint(e);
            if (!p) return;
            const c = clampFloor(snap(p.x + drag.dx), snap(p.z + drag.dz));
            const s = layout.stations.find((t) => t.id === drag.id);
            if (s && (s.x !== c.x || s.z !== c.z)) edit.onMove(drag.id, c.x, c.z);
          }}
          onClick={(e) => {
            if (e.delta < 4 && !drag) edit.onSelect(null);
          }}
        >
          <planeGeometry args={[FLOOR.halfX * 6, FLOOR.halfZ * 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}

type View = 'perspective' | 'top';

function CameraRig({ view }: { view: View }) {
  const camera = useThree((st) => st.camera);
  const controls = useThree((st) => st.controls) as OrbitControlsImpl | null;
  useEffect(() => {
    if (!controls) return;
    if (view === 'top') {
      camera.position.set(0, 3.1, 0.001);
      controls.target.set(0, 0, 0);
    } else {
      camera.position.set(1.5, 1.35, 1.7);
      controls.target.set(0, 0.2, 0);
    }
    controls.update();
  }, [view, camera, controls]);
  return null;
}

function Trail({ world }: { world: World }) {
  const MAX = 4000;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const line = useMemo(() => new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#22d3ee' })), [geometry]);
  useFrame(() => {
    const pts = world.trail;
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(pts.length, MAX);
    for (let i = 0; i < n; i++) attr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    attr.needsUpdate = true;
    geometry.setDrawRange(0, n);
  });
  return <primitive object={line} />;
}

// A lost WebGL context never comes back on the same <canvas>: r3f calls
// forceContextLoss() (deferred) when a Canvas unmounts, which kills a renderer
// re-created on that element by Fast Refresh, and GPU resets do the same in
// production. Remounting with a new key gives the view a fresh canvas.
const MAX_RECOVERIES = 5;

const NO_ISSUES = new Map<string, 'error' | 'warning'>();

export interface WorkcellViewProps {
  world: World;
  layout: CellLayout;
  editing?: boolean;
  selectedId?: string | null;
  issues?: Map<string, 'error' | 'warning'>;
  onSelect?: (id: string | null) => void;
  onChange?: (id: string, patch: Partial<Station>) => void;
  onDelete?: (id: string) => void;
}

export default function WorkcellView({
  world,
  layout,
  editing = false,
  selectedId = null,
  issues = NO_ISSUES,
  onSelect = () => {},
  onChange = () => {},
  onDelete = () => {},
}: WorkcellViewProps) {
  const [generation, setGeneration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>('perspective');
  const wrapper = useRef<HTMLDivElement>(null);
  const recoveries = useRef(0);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    // Capture phase: the event is dispatched on the canvas and does not bubble.
    // A canvas that was already removed (our own remount) can't reach us.
    const onLost = (e: Event) => {
      if (!el.contains(e.target as globalThis.Node)) return;
      e.preventDefault();
      recoveries.current += 1;
      if (recoveries.current > MAX_RECOVERIES) setFailed(true);
      else setGeneration((g) => g + 1);
    };
    el.addEventListener('webglcontextlost', onLost, true);
    return () => el.removeEventListener('webglcontextlost', onLost, true);
  }, [failed]);

  useEffect(() => {
    if (!editing) document.body.style.cursor = '';
  }, [editing]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editing || !selectedId) return;
    const s = layout.stations.find((t) => t.id === selectedId);
    if (!s) return;
    const step = e.shiftKey ? 50 : 10;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (e.key === 'r' || e.key === 'R') {
      onChange(s.id, { rot: (((s.rot + (e.shiftKey ? -15 : 15) + 180) % 360) + 360) % 360 - 180 });
    } else if (nudge[e.key]) {
      const c = clampFloor(s.x + nudge[e.key][0], s.z + nudge[e.key][1]);
      onChange(s.id, c);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      onDelete(s.id);
    } else if (e.key === 'Escape') {
      onSelect(null);
    } else {
      return;
    }
    // Keep the flow editor (document-level shortcuts) from seeing the key.
    e.preventDefault();
    e.stopPropagation();
  };

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#09090b] p-6 text-center text-xs text-white/45">
        The 3D view lost its graphics context repeatedly. The simulation keeps running — reload the page to restore the view.
      </div>
    );
  }

  const edit: EditProps = {
    editing,
    selectedId,
    issues,
    onSelect,
    onMove: (id, x, z) => onChange(id, { x, z }),
  };

  return (
    <div
      ref={wrapper}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={() => editing && wrapper.current?.focus({ preventScroll: true })}
      className="relative h-full w-full bg-[#09090b] outline-none"
    >
      <Canvas key={generation} shadows camera={{ position: [1.5, 1.35, 1.7], fov: 45, near: 0.05, far: 50 }}>
        <color attach="background" args={['#09090b']} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[3, 5, 2]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]}>
          <orthographicCamera attach="shadow-camera" args={[-2, 2, 2, -2, 0.1, 15]} />
        </directionalLight>
        <directionalLight position={[-3, 2, -2]} intensity={0.3} />
        <group scale={0.001}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[FLOOR.halfX * 2, FLOOR.halfZ * 2]} />
            <meshStandardMaterial color="#141417" roughness={1} />
          </mesh>
          <gridHelper args={[2600, 26, '#27272a', '#1c1c1f']} position={[0, 0.5, 0]} />
          <Arm world={world} />
          <Stations world={world} layout={layout} edit={edit} />
          <Parts world={world} />
          <Trail world={world} />
        </group>
        <OrbitControls makeDefault target={[0, 0.2, 0]} minDistance={0.6} maxDistance={6} maxPolarAngle={Math.PI / 2.05} />
        <CameraRig view={view} />
      </Canvas>
      <div className="absolute right-2 top-2 flex overflow-hidden rounded border border-white/10 bg-black/50 text-[10px]">
        {(
          [
            ['perspective', '3D'],
            ['top', 'Top'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`px-2 py-1 ${view === id ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'}`}
            title={id === 'top' ? 'Top view — easiest for placing stations' : 'Perspective view'}
          >
            {label}
          </button>
        ))}
      </div>
      {editing && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white/60">
          Drag stations to move · click one, then R / Shift+R rotates · arrows nudge · Del removes · green ring = robot reach
        </div>
      )}
    </div>
  );
}

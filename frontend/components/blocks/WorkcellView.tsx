'use client';

// 3D view of the simulated workcell. Everything is modelled in millimetres
// inside a 0.001-scaled group, and every frame reads the World directly so the
// React tree only re-renders when parts are added or removed.
//
// Lighting comes from an environment built from light panels in code (no HDR
// download), so painted, plastic and metal surfaces get realistic reflections;
// textures are procedural (sceneTextures.ts).
//
// Stations are drawn from the cell layout. In edit mode they can be selected,
// dragged on the floor, rotated (R) and nudged (arrow keys).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, extend, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Environment, Html, Lightformer, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { ARM, FINGER, isReachable } from '@/lib/blocks/kinematics';
import {
  BIN_WALL,
  CONVEYOR_STOP_INSET,
  CONVEYOR_TOP,
  CONVEYOR_WIDTH,
  FENCE_THICKNESS,
  FIXTURE_TOP,
  FLOOR,
  footprint,
  modelDims,
  PALLET_TOP,
  param,
  TRAY_PITCH,
  TRAY_TOP,
  traySize,
  UNIT_MM,
  type CellLayout,
  type Station,
} from '@/lib/blocks/layout';
import { fingerOffset, PART_SIZE, type Part, type World } from '@/lib/blocks/workcell';
import { useWorldVersion } from '@/lib/blocks/useWorld';
import { loadModel } from './ModelLoader';
import {
  beltTexture,
  brushedRoughness,
  concreteTexture,
  hazardTexture,
  meshTexture,
  roundedPartGeometry,
  tiled,
  woodTexture,
} from './sceneTextures';

// @ts-ignore — registering the full namespace is valid at runtime
extend(THREE);

const rad = THREE.MathUtils.degToRad;

const PART_COLORS: Record<string, string> = {
  red: '#ef4444',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#facc15',
};

// ── Materials ───────────────────────────────────────────────────────────────

function Painted({ color, rough = 0.4 }: { color: string; rough?: number }) {
  return <meshPhysicalMaterial color={color} roughness={rough} metalness={0.05} clearcoat={0.35} clearcoatRoughness={0.4} />;
}

function Brushed({ color = '#c4c7cc', rough = 0.38, metal = 0.9 }: { color?: string; rough?: number; metal?: number }) {
  return <meshStandardMaterial color={color} metalness={metal} roughness={rough} roughnessMap={brushedRoughness()} />;
}

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
    const off = fingerOffset(world.gripperWidth);
    if (fingerL.current) fingerL.current.position.x = -off;
    if (fingerR.current) fingerR.current.position.x = off;
  });

  const body = '#eef0f3';
  const joint = '#f26b1d';
  const cap = '#2a2a2e';
  return (
    <group>
      {/* floor plate with anchor bolts */}
      <mesh position={[0, 6, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[175, 175, 12, 48]} />
        <Brushed color="#5b5f66" rough={0.55} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 152, 15, Math.sin(a) * 152]} castShadow>
            <cylinderGeometry args={[9, 9, 8, 6]} />
            <Brushed color="#9ca3af" rough={0.3} />
          </mesh>
        );
      })}
      <mesh position={[0, 36, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[125, 140, 48, 48]} />
        <Painted color={cap} rough={0.5} />
      </mesh>
      <group ref={j[0]} position={[0, 60, 0]}>
        <mesh position={[0, (ARM.shoulderHeight - 60) / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[82, 100, ARM.shoulderHeight - 60, 48]} />
          <Painted color={body} />
        </mesh>
        <group ref={j[1]} position={[0, ARM.shoulderHeight - 60, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[72, 72, 170, 48]} />
            <Painted color={joint} rough={0.35} />
          </mesh>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * 87, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[52, 52, 6, 48]} />
              <Brushed color="#b6bac0" rough={0.35} />
            </mesh>
          ))}
          <RoundedBox args={[92, ARM.upperArm, 92]} radius={22} smoothness={4} position={[0, ARM.upperArm / 2, 0]} castShadow receiveShadow>
            <Painted color={body} />
          </RoundedBox>
          <group ref={j[2]} position={[0, ARM.upperArm, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[56, 56, 140, 48]} />
              <Painted color={joint} rough={0.35} />
            </mesh>
            {[-1, 1].map((sx) => (
              <mesh key={sx} position={[sx * 72, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[40, 40, 5, 40]} />
                <Brushed color="#b6bac0" rough={0.35} />
              </mesh>
            ))}
            <group ref={j[3]}>
              <RoundedBox args={[72, ARM.forearm, 72]} radius={18} smoothness={4} position={[0, ARM.forearm / 2, 0]} castShadow receiveShadow>
                <Painted color={body} />
              </RoundedBox>
              <group ref={j[4]} position={[0, ARM.forearm, 0]}>
                <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                  <cylinderGeometry args={[40, 40, 100, 40]} />
                  <Painted color={joint} rough={0.35} />
                </mesh>
                <group ref={j[5]}>
                  {/* tool flange and gripper body */}
                  <mesh position={[0, 45, 0]} castShadow>
                    <cylinderGeometry args={[32, 32, 70, 40]} />
                    <Brushed color="#71757d" />
                  </mesh>
                  <RoundedBox args={[2 * FINGER.open + 24, 26, 46]} radius={5} smoothness={3} position={[0, 90, 0]} castShadow>
                    <Painted color="#33363b" rough={0.45} />
                  </RoundedBox>
                  <mesh ref={fingerL} position={[-FINGER.open, 125, 0]} castShadow>
                    <boxGeometry args={[FINGER.thickness, FINGER.length, FINGER.depth]} />
                    <Brushed />
                  </mesh>
                  <mesh ref={fingerR} position={[FINGER.open, 125, 0]} castShadow>
                    <boxGeometry args={[FINGER.thickness, FINGER.length, FINGER.depth]} />
                    <Brushed />
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
  const mat = useRef<THREE.MeshPhysicalMaterial>(null);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.set(part.pos.x, part.pos.y, part.pos.z);
    ref.current.rotation.y = rad(part.yaw);
    if (mat.current) {
      mat.current.color.set(part.machined ? '#b8bcc2' : PART_COLORS[part.color]);
      mat.current.metalness = part.machined ? 0.9 : 0;
      mat.current.roughness = part.machined ? 0.28 : 0.42;
      mat.current.clearcoat = part.machined ? 0 : 0.5;
    }
  });
  return (
    <mesh ref={ref} geometry={roundedPartGeometry()} castShadow receiveShadow>
      <meshPhysicalMaterial ref={mat} color={PART_COLORS[part.color]} roughness={0.42} clearcoat={0.5} clearcoatRoughness={0.3} />
      {part.defect && (
        <mesh position={[0, PART_SIZE / 2 + 0.5, 0]} rotation={[-Math.PI / 2, 0, 0.6]}>
          <planeGeometry args={[34, 6]} />
          <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
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

const BELT_TILE = 200; // mm of belt per texture tile

function ConveyorModel({ world, s }: { world: World; s: Station }) {
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const flash = useRef<THREE.PointLight>(null);
  const length = param(s, 'length');
  const stop = length / 2 - CONVEYOR_STOP_INSET;
  const W = CONVEYOR_WIDTH;
  const T = CONVEYOR_TOP;
  const belt = useMemo(() => tiled(beltTexture(), length / BELT_TILE, 1), [length]);
  const hazard = useMemo(() => tiled(hazardTexture(), 1, 0.4), []);
  useEffect(() => () => belt.dispose(), [belt]);
  useFrame((_, dt) => {
    if (beam.current) beam.current.color.set(world.conveyorHasPart(s) ? '#22c55e' : '#ef4444');
    if (flash.current) flash.current.intensity = world.visionFlash * 3;
    // Scroll the belt surface with the simulated belt speed.
    if (world.conveyorRunning && !world.paused) belt.offset.x -= (world.conveyorSpeed * world.speed * Math.min(dt, 0.1)) / BELT_TILE;
  });
  const legs = Math.max(2, Math.round(length / 450) + 1);
  return (
    <group>
      {/* belt */}
      <mesh position={[0, T - 6, 0]} receiveShadow castShadow>
        <boxGeometry args={[length - 30, 12, W - 16]} />
        <meshStandardMaterial map={belt} roughness={0.85} />
      </mesh>
      {/* end rollers */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (length / 2 - 18), T - 18, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[18, 18, W - 16, 24]} />
          <Brushed color="#9ca3af" />
        </mesh>
      ))}
      {/* aluminium side rails */}
      {[-1, 1].map((sz) => (
        <mesh key={sz} position={[0, T - 16, sz * (W / 2 - 4)]} castShadow receiveShadow>
          <boxGeometry args={[length, 40, 8]} />
          <Brushed color="#c9ccd1" />
        </mesh>
      ))}
      {/* legs and cross braces */}
      {Array.from({ length: legs }, (_, i) => {
        const x = -length / 2 + 40 + (i * (length - 80)) / (legs - 1);
        return (
          <group key={i} position={[x, 0, 0]}>
            {[-1, 1].map((sz) => (
              <mesh key={sz} position={[0, (T - 36) / 2, sz * (W / 2 - 18)]} castShadow>
                <boxGeometry args={[30, T - 36, 30]} />
                <Brushed color="#8b9097" rough={0.5} />
              </mesh>
            ))}
            <mesh position={[0, 14, 0]}>
              <boxGeometry args={[20, 10, W - 36]} />
              <Brushed color="#8b9097" rough={0.5} />
            </mesh>
          </group>
        );
      })}
      {/* end stop */}
      <mesh position={[length / 2 - 8, T + 20, 0]} castShadow>
        <boxGeometry args={[16, 40, W]} />
        <meshStandardMaterial map={hazard} roughness={0.6} />
      </mesh>
      {/* feed direction arrow, painted on the side rail */}
      <mesh position={[-length / 2 + 50, T - 16, W / 2 + 0.5]}>
        <circleGeometry args={[14, 3]} />
        <meshStandardMaterial color="#e4e4e7" roughness={0.6} />
      </mesh>
      {/* photo-eye and reflector */}
      <RoundedBox args={[22, 50, 22]} radius={4} smoothness={2} position={[stop, T + 25, -W / 2 - 15]} castShadow>
        <Painted color="#1c1d21" rough={0.5} />
      </RoundedBox>
      <mesh position={[stop, T + 25, W / 2 + 8]}>
        <boxGeometry args={[18, 30, 4]} />
        <meshStandardMaterial color="#fbbf24" roughness={0.2} metalness={0.3} />
      </mesh>
      <mesh position={[stop, T + 25, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.5, 1.5, W + 20, 6]} />
        <meshBasicMaterial ref={beam} color="#ef4444" transparent opacity={0.7} />
      </mesh>
      {/* camera on a post above the pick point */}
      <mesh position={[stop - 120, 330, 120]} castShadow>
        <cylinderGeometry args={[12, 12, 500, 16]} />
        <Brushed color="#8b9097" rough={0.45} />
      </mesh>
      <group position={[stop - 60, 560, 60]} rotation={[0.6, 0, -0.6]}>
        <RoundedBox args={[60, 44, 84]} radius={8} smoothness={3} castShadow>
          <Painted color="#1c1d21" rough={0.45} />
        </RoundedBox>
        <mesh position={[0, -24, 0]}>
          <cylinderGeometry args={[16, 16, 8, 24]} />
          <meshPhysicalMaterial color="#0b1220" roughness={0.05} metalness={0.2} clearcoat={1} />
        </mesh>
      </group>
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
      <mesh position={[0, 3, 0]} receiveShadow>
        <boxGeometry args={[size - 4, 6, size - 4]} />
        <meshPhysicalMaterial color={color} roughness={0.5} clearcoat={0.2} />
      </mesh>
      {[
        [0, size / 2, size, t],
        [0, -size / 2, size, t],
        [size / 2, 0, t, size],
        [-size / 2, 0, t, size],
      ].map(([dx, dz, w, d], i) => (
        <group key={i}>
          <mesh position={[dx, BIN_WALL / 2, dz]} castShadow>
            <boxGeometry args={[w, BIN_WALL, d]} />
            <meshPhysicalMaterial color={color} transparent opacity={0.62} roughness={0.22} clearcoat={0.8} clearcoatRoughness={0.15} />
          </mesh>
          {/* rolled rim */}
          <mesh position={[dx, BIN_WALL - 3, dz]}>
            <boxGeometry args={[w + 4, 8, d + 4]} />
            <meshPhysicalMaterial color={color} roughness={0.35} clearcoat={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function PalletModel({ s }: { s: Station }) {
  const size = param(s, 'size');
  const step = size / 2 - 30;
  const wood = useMemo(() => tiled(woodTexture(), size / 250, 0.25), [size]);
  const blockWood = useMemo(() => tiled(woodTexture(), 0.4, 0.4), []);
  useEffect(() => () => wood.dispose(), [wood]);
  const planks = 5;
  const plankW = size / planks - 8;
  return (
    <group>
      {/* stringer blocks */}
      {[-1, 0, 1].map((i) =>
        [-1, 0, 1].map((k) => (
          <mesh key={`${i}${k}`} position={[k * step, (PALLET_TOP - 10) / 2, i * step]} castShadow receiveShadow>
            <boxGeometry args={[60, PALLET_TOP - 10, 50]} />
            <meshStandardMaterial map={blockWood} color="#c9a273" roughness={0.9} />
          </mesh>
        )),
      )}
      {/* deck boards */}
      {Array.from({ length: planks }, (_, i) => (
        <mesh key={i} position={[0, PALLET_TOP - 5, -size / 2 + (i + 0.5) * (size / planks)]} castShadow receiveShadow>
          <boxGeometry args={[size, 10, plankW]} />
          <meshStandardMaterial map={wood} color="#e2c49c" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function MachineModel({ world }: { world: World }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  const door = useRef<THREE.Group>(null);
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const running = world.machineRunning;
    const state = running ? '#f59e0b' : world.machineDone ? '#22c55e' : '#3f3f46';
    if (lamp.current) {
      lamp.current.color.set(state);
      lamp.current.emissive.set(running || world.machineDone ? state : '#000');
    }
    if (screen.current) screen.current.emissive.set(running ? '#1d4ed8' : '#0f172a');
    if (door.current) door.current.position.y = running ? 220 : 480;
  });
  return (
    <group>
      {/* plinth and cabinet */}
      <mesh position={[-230, 15, 0]} castShadow receiveShadow>
        <boxGeometry args={[230, 30, 430]} />
        <Painted color="#26292e" rough={0.6} />
      </mesh>
      <RoundedBox args={[220, 570, 420]} radius={14} smoothness={4} position={[-230, 315, 0]} castShadow receiveShadow>
        <Painted color="#d6dbe1" rough={0.38} />
      </RoundedBox>
      {/* dark viewing window on the front */}
      <mesh position={[-119, 380, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[300, 220]} />
        <meshPhysicalMaterial color="#0b1220" roughness={0.08} metalness={0.1} clearcoat={1} />
      </mesh>
      {/* control panel with screen */}
      <group position={[-160, 420, 222]}>
        <RoundedBox args={[90, 140, 24]} radius={6} smoothness={3} castShadow>
          <Painted color="#2a2d33" rough={0.5} />
        </RoundedBox>
        <mesh position={[0, 25, 12.5]}>
          <planeGeometry args={[70, 50]} />
          <meshStandardMaterial ref={screen} color="#0f172a" emissive="#0f172a" emissiveIntensity={1.2} roughness={0.2} />
        </mesh>
        <mesh position={[0, -35, 14]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[10, 10, 6, 20]} />
          <meshStandardMaterial color="#dc2626" roughness={0.4} />
        </mesh>
      </group>
      {/* fixture with vice jaws */}
      <mesh position={[0, FIXTURE_TOP / 2 - 10, 0]} castShadow receiveShadow>
        <boxGeometry args={[110, FIXTURE_TOP - 20, 110]} />
        <Brushed color="#9aa1aa" rough={0.42} />
      </mesh>
      {[-1, 1].map((sz) => (
        <mesh key={sz} position={[0, FIXTURE_TOP - 6, sz * 46]} castShadow>
          <boxGeometry args={[100, 32, 14]} />
          <Brushed color="#c4c8ce" rough={0.3} />
        </mesh>
      ))}
      {/* sliding guard door: drops in front of the fixture during a cycle */}
      <group ref={door} position={[80, 480, 0]}>
        <mesh>
          <boxGeometry args={[6, 300, 260]} />
          <meshPhysicalMaterial color="#bfdbfe" transparent opacity={0.22} roughness={0.05} clearcoat={1} />
        </mesh>
        {[-1, 1].map((sz) => (
          <mesh key={sz} position={[0, 0, sz * 132]}>
            <boxGeometry args={[12, 300, 8]} />
            <Brushed color="#9ca3af" />
          </mesh>
        ))}
      </group>
      <mesh position={[-230, 640, 150]}>
        <cylinderGeometry args={[18, 18, 40, 24]} />
        <meshStandardMaterial ref={lamp} color="#3f3f46" emissiveIntensity={2} roughness={0.3} />
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
      <RoundedBox args={[w, TRAY_TOP, d]} radius={6} smoothness={3} position={[0, TRAY_TOP / 2, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial color="#0f766e" roughness={0.5} clearcoat={0.3} />
      </RoundedBox>
      {pockets.map(([x, z], i) => (
        <mesh key={i} position={[x, TRAY_TOP + 0.5, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[58, 58]} />
          <meshStandardMaterial color="#0b3d38" roughness={0.8} />
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
  const wood = useMemo(() => tiled(woodTexture(), w / 300, d / 300), [w, d]);
  useEffect(() => () => wood.dispose(), [wood]);
  return (
    <group>
      <RoundedBox args={[w, slab, d]} radius={Math.min(6, slab / 2 - 0.5)} smoothness={3} position={[0, h - slab / 2, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial map={wood} color="#f1dfc2" roughness={0.55} clearcoat={0.4} clearcoatRoughness={0.35} />
      </RoundedBox>
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * (w / 2 - 25), (h - slab) / 2, sz * (d / 2 - 25)]} castShadow>
          <boxGeometry args={[30, Math.max(1, h - slab), 30]} />
          <Brushed color="#8b9097" rough={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function FenceModel({ s }: { s: Station }) {
  const length = param(s, 'length');
  const h = param(s, 'h');
  const posts = Math.max(2, Math.round(length / 400) + 1);
  const wire = useMemo(() => tiled(meshTexture(), length / 50, h / 50), [length, h]);
  useEffect(() => () => wire.dispose(), [wire]);
  return (
    <group>
      <mesh position={[0, h / 2 + 40, 0]} castShadow>
        <planeGeometry args={[length, h - 80]} />
        <meshStandardMaterial map={wire} alphaTest={0.4} metalness={0.7} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: posts }, (_, i) => (
        <group key={i} position={[-length / 2 + (i * length) / (posts - 1), 0, 0]}>
          <mesh position={[0, h / 2, 0]} castShadow>
            <boxGeometry args={[FENCE_THICKNESS, h, FENCE_THICKNESS]} />
            <Painted color="#eab308" rough={0.45} />
          </mesh>
          <mesh position={[0, 3, 0]}>
            <boxGeometry args={[80, 6, 80]} />
            <Brushed color="#8b9097" rough={0.5} />
          </mesh>
        </group>
      ))}
      {[h - 10, 50].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow>
          <boxGeometry args={[length, 20, 20]} />
          <Painted color="#eab308" rough={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function BeaconModel({ world }: { world: World }) {
  const green = useRef<THREE.MeshPhysicalMaterial>(null);
  const red = useRef<THREE.MeshPhysicalMaterial>(null);
  useFrame(() => {
    green.current?.emissive.set(world.outputs[2] ? '#22c55e' : '#000');
    red.current?.emissive.set(world.outputs[3] ? '#ef4444' : '#000');
  });
  return (
    <group>
      <mesh position={[0, 5, 0]} castShadow>
        <cylinderGeometry args={[30, 34, 10, 24]} />
        <Painted color="#27272a" rough={0.5} />
      </mesh>
      <mesh position={[0, 200, 0]} castShadow>
        <cylinderGeometry args={[6, 6, 400, 12]} />
        <Brushed color="#9ca3af" />
      </mesh>
      <mesh position={[0, 404, 0]}>
        <cylinderGeometry args={[21, 21, 8, 24]} />
        <Painted color="#27272a" rough={0.5} />
      </mesh>
      <mesh position={[0, 428, 0]}>
        <cylinderGeometry args={[20, 20, 40, 24]} />
        <meshPhysicalMaterial ref={green} color="#166534" transparent opacity={0.9} roughness={0.15} clearcoat={1} emissiveIntensity={2.2} />
      </mesh>
      <mesh position={[0, 470, 0]}>
        <cylinderGeometry args={[20, 20, 40, 24]} />
        <meshPhysicalMaterial ref={red} color="#991b1b" transparent opacity={0.9} roughness={0.15} clearcoat={1} emissiveIntensity={2.2} />
      </mesh>
      <mesh position={[0, 494, 0]}>
        <cylinderGeometry args={[18, 21, 8, 24]} />
        <Painted color="#27272a" rough={0.5} />
      </mesh>
    </group>
  );
}

// A user-imported model, scaled to millimetres, turned upright, centred on the
// station and standing on the floor. A wire box shows its size while loading.
function CustomModel({ s }: { s: Station }) {
  const [source, setSource] = useState<THREE.Object3D | null>(null);
  const [failed, setFailed] = useState(false);
  const m = s.model;
  useEffect(() => {
    if (!m) return;
    let live = true;
    setSource(null);
    setFailed(false);
    loadModel(m)
      .then((o) => live && setSource(o))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [m]);

  const color = param(s, 'color');
  const k = m ? UNIT_MM[m.unit] * (s.scale ?? 1) : 1;
  const placed = useMemo(() => {
    if (!source || !m) return null;
    const inner = source.clone(true);
    if (m.zUp) inner.rotation.x = -Math.PI / 2;
    inner.scale.setScalar(k);
    const recolor = m.format === 'stl' || m.format === 'obj';
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Mesh files often have inconsistent face winding: draw both sides.
      if (recolor) mesh.material = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide });
    });
    const root = new THREE.Group();
    root.add(inner);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const c = box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -box.min.y, -c.z);
    return root;
  }, [source, m, k, color]);

  if (placed) return <primitive object={placed} />;
  const { w, d, h } = modelDims(s);
  return (
    <mesh position={[0, h / 2, 0]}>
      <boxGeometry args={[w, h, d]} />
      <meshBasicMaterial color={failed ? '#ef4444' : '#a1a1aa'} wireframe />
    </mesh>
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
    case 'model':
      return modelDims(s).h + 50;
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
    case 'model':
      return <CustomModel s={s} />;
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

// Concrete floor with a painted keep-out ring around the robot base.
function Floor() {
  const map = useMemo(() => tiled(concreteTexture(), (FLOOR.halfX * 2) / 1000, (FLOOR.halfZ * 2) / 1000), []);
  const stripes = useMemo(() => tiled(hazardTexture(), 24, 1), []);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FLOOR.halfX * 2, FLOOR.halfZ * 2]} />
        <meshStandardMaterial map={map} roughness={0.82} metalness={0} />
      </mesh>
      <mesh position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[205, 225, 96]} />
        <meshStandardMaterial map={stripes} roughness={0.7} />
      </mesh>
    </>
  );
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
      <Canvas
        key={generation}
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={[1, 2]}
        camera={{ position: [1.5, 1.35, 1.7], fov: 45, near: 0.05, far: 50 }}
      >
        <color attach="background" args={['#0b0b0e']} />
        <fog attach="fog" args={['#0b0b0e', 4.5, 9]} />
        <hemisphereLight args={['#dbeafe', '#1c1917', 0.35]} />
        <directionalLight
          position={[2.5, 5, 2]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
        >
          <orthographicCamera attach="shadow-camera" args={[-2, 2, 2, -2, 0.1, 15]} />
        </directionalLight>
        <directionalLight position={[-3, 2, -2]} intensity={0.35} color="#c7d2fe" />
        {/* Factory-hall light panels, rendered once into the environment map. */}
        <Environment resolution={256} environmentIntensity={0.75}>
          <Lightformer form="rect" intensity={2.5} position={[0, 4, 0]} rotation-x={Math.PI / 2} scale={[8, 1.5, 1]} />
          <Lightformer form="rect" intensity={2} position={[0, 4, -2.5]} rotation-x={Math.PI / 2} scale={[8, 1, 1]} />
          <Lightformer form="rect" intensity={2} position={[0, 4, 2.5]} rotation-x={Math.PI / 2} scale={[8, 1, 1]} />
          <Lightformer form="rect" intensity={0.8} position={[-5, 1.5, 0]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} color="#e0e7ff" />
          <Lightformer form="rect" intensity={0.6} position={[5, 1.5, 0]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} color="#fff7ed" />
        </Environment>
        <ContactShadows position={[0, 0.0007, 0]} scale={[2.8, 2.4]} resolution={512} blur={2.2} far={0.8} opacity={0.55} />
        <group scale={0.001}>
          <Floor />
          {editing && <gridHelper args={[2600, 26, '#3f3f46', '#26262b']} position={[0, 0.5, 0]} />}
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

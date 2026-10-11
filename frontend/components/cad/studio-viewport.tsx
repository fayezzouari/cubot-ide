'use client';

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, GizmoHelper, GizmoViewport, Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { cadApi, type CadInstance, type CadPart, type CaptureView, type FaceInfo, type PartMesh, type Vec3 } from '@/lib/api/cad';

const DEG = Math.PI / 180;
// The scene uses CAD axes directly: millimetres, Z up (the camera's up is +Z).

export type TransformMode = 'translate' | 'rotate';

export interface ViewportHandle {
  fit: () => void;
  /** JPEG data URL of the viewport as the user sees it (max 1280 px wide), for the AI. */
  capture: () => string | null;
  /** Screenshots of the whole assembly from the given directions, for the review. The user's
   *  camera is restored afterwards. Empty if the viewer isn't ready. */
  captureViews: (views: CaptureView[]) => Promise<{ view: string; data: string }[]>;
  /** Height (mm) to add to the instance's z so its lowest point rests on the ground. */
  dropToGround: (instanceId: string) => number | null;
}

interface Props {
  /** Imperative handle (passed as a prop: next/dynamic doesn't forward refs). */
  controlRef?: React.Ref<ViewportHandle>;
  parts: CadPart[];
  instances: CadInstance[];
  selectedId: string | null;
  face: FaceInfo | null;
  mode: TransformMode;
  snap: boolean;
  onSelect: (instanceId: string | null) => void;
  onFace: (face: FaceInfo | null) => void;
  onTransform: (instanceId: string, position: Vec3, rotation: Vec3) => void;
}

function useGeometry(key: string | undefined) {
  const [state, setState] = useState<{ geometry: THREE.BufferGeometry; mesh: PartMesh } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    cadApi
      .mesh(key)
      .then((mesh) => {
        if (cancelled) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
        geometry.setIndex(mesh.indices);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        setState((prev) => {
          prev?.geometry.dispose();
          return { geometry, mesh };
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  useEffect(() => () => state?.geometry.dispose(), [state]);
  return state;
}

function faceGeometry(source: THREE.BufferGeometry, face: FaceInfo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', source.getAttribute('position'));
  g.setAttribute('normal', source.getAttribute('normal'));
  const index = source.getIndex()!.array as Uint16Array | Uint32Array;
  g.setIndex(new THREE.BufferAttribute(index.slice(face.start, face.start + face.count), 1));
  return g;
}

/** Connection points of the selected part: a dot on the contact surface and
 *  an arrow along the port's outward axis. */
function PortMarkers({ part }: { part: CadPart }) {
  const ports = part.version?.ports;
  const size = part.version?.bbox?.size;
  const arrows = useMemo(() => {
    if (!ports) return [];
    const length = Math.max(4, Math.min(30, Math.max(...(size ?? [20])) * 0.25));
    return Object.entries(ports).map(([name, p]) => {
      const dir = new THREE.Vector3(...p.axis).normalize();
      const origin = new THREE.Vector3(...p.origin);
      return { name, origin, arrow: new THREE.ArrowHelper(dir, origin, length, 0x22d3ee, length * 0.3, length * 0.18) };
    });
  }, [ports, size]);
  useEffect(
    () => () =>
      arrows.forEach(({ arrow }) => {
        arrow.line.geometry.dispose();
        arrow.cone.geometry.dispose();
      }),
    [arrows],
  );
  const dot = Math.max(0.6, Math.min(3, Math.max(...(size ?? [20])) * 0.02));
  return (
    <group renderOrder={3}>
      {arrows.map(({ name, origin, arrow }) => (
        <group key={name}>
          <primitive object={arrow} />
          <mesh position={origin}>
            <sphereGeometry args={[dot, 12, 8]} />
            <meshBasicMaterial color="#22d3ee" depthTest={false} transparent opacity={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

interface InstanceProps {
  instance: CadInstance;
  part: CadPart;
  selected: boolean;
  face: FaceInfo | null;
  register: (id: string, object: THREE.Object3D | null) => void;
  onPick: (e: ThreeEvent<MouseEvent>, instance: CadInstance, mesh: PartMesh | null) => void;
}

function InstanceObject({ instance, part, selected, face, register, onPick }: InstanceProps) {
  const loaded = useGeometry(part.version?.key);
  const color = instance.color || part.color;
  const highlight = useMemo(
    () => (loaded && selected && face ? faceGeometry(loaded.geometry, face) : null),
    [loaded, selected, face],
  );
  useEffect(() => () => highlight?.dispose(), [highlight]);

  return (
    <group
      ref={(o) => register(instance.id, o)}
      position={instance.position}
      rotation={[instance.rotation[0] * DEG, instance.rotation[1] * DEG, instance.rotation[2] * DEG]}
      userData={{ instanceId: instance.id }}
    >
      {loaded && (
        <mesh
          geometry={loaded.geometry}
          onClick={(e) => onPick(e, instance, loaded.mesh)}
        >
          <meshStandardMaterial
            color={color}
            metalness={part.kind === 'mesh' ? 0.05 : 0.25}
            roughness={0.55}
            emissive={selected ? '#3b82f6' : '#000000'}
            emissiveIntensity={selected ? 0.18 : 0}
            flatShading={part.kind === 'mesh'}
            polygonOffset
            polygonOffsetFactor={1}
          />
          {part.kind === 'brep' && <Edges threshold={25} color={selected ? '#93c5fd' : '#1a1a1a'} />}
        </mesh>
      )}
      {selected && <PortMarkers part={part} />}
      {highlight && (
        <mesh geometry={highlight} renderOrder={2}>
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.55} depthTest polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      )}
    </group>
  );
}

function Scene(props: Props & { handleRef: React.Ref<ViewportHandle> }) {
  const { parts, instances, selectedId, face, mode, snap, onSelect, onFace, onTransform, handleRef } = props;
  const objects = useRef(new Map<string, THREE.Object3D>());
  const [target, setTarget] = useState<THREE.Object3D | null>(null);
  const { camera, controls, gl, scene } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: any;
    gl: THREE.WebGLRenderer;
    scene: THREE.Scene;
  };
  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const fitted = useRef(false);
  const instancesRef = useRef(instances);
  instancesRef.current = instances;

  const register = useCallback(
    (id: string, object: THREE.Object3D | null) => {
      if (object) objects.current.set(id, object);
      else objects.current.delete(id);
      if (id === selectedId) setTarget(object);
    },
    [selectedId],
  );

  useEffect(() => {
    setTarget(selectedId ? objects.current.get(selectedId) ?? null : null);
  }, [selectedId, instances]);

  const fit = useCallback(() => {
    const box = new THREE.Box3();
    objects.current.forEach((o) => box.expandByObject(o));
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = Math.max(sphere.radius, 10) / Math.sin((camera.fov * DEG) / 2);
    const direction = new THREE.Vector3(1, -1, 0.8).normalize();
    camera.position.copy(sphere.center).addScaledVector(direction, distance * 1.1);
    camera.near = Math.max(distance / 1000, 0.1);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls?.target.copy(sphere.center);
    controls?.update();
  }, [camera, controls]);

  // Frame the model once every visible part's mesh has loaded (or after 4 s).
  useEffect(() => {
    if (fitted.current || instances.length === 0) return;
    const started = Date.now();
    const timer = setInterval(() => {
      let loaded = 0;
      objects.current.forEach((o) => {
        if (o.children.length) loaded++;
      });
      const expected = instances.filter((i) => i.visible).length;
      if ((loaded >= expected || Date.now() - started > 4000) && loaded > 0) {
        fit();
        fitted.current = true;
        clearInterval(timer);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [instances, fit]);

  useImperativeHandle(
    handleRef,
    () => ({
      fit,
      capture: () => {
        try {
          // Draw a fresh frame so the buffer is current, then copy it before it's cleared.
          gl.render(scene, camera);
          const src = gl.domElement;
          const scale = Math.min(1, 1280 / src.width);
          const out = document.createElement('canvas');
          out.width = Math.round(src.width * scale);
          out.height = Math.round(src.height * scale);
          out.getContext('2d')?.drawImage(src, 0, 0, out.width, out.height);
          return out.toDataURL('image/jpeg', 0.85);
        } catch {
          return null;
        }
      },
      captureViews: async (views) => {
        // Wait (up to 6 s) until every visible copy's mesh is in the scene.
        const expected = instancesRef.current.filter((i) => i.visible).length;
        for (let t = 0; t < 60; t++) {
          let loaded = 0;
          objects.current.forEach((o) => {
            if (o.children.length) loaded++;
          });
          if (loaded >= expected) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        const src = gl.domElement;
        if (src.width < 200 || !objects.current.size) return [];
        const box = new THREE.Box3();
        objects.current.forEach((o) => box.expandByObject(o));
        if (box.isEmpty()) return [];
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const saved = {
          position: camera.position.clone(),
          up: camera.up.clone(),
          near: camera.near,
          far: camera.far,
          target: controls?.target.clone() as THREE.Vector3 | undefined,
        };
        const distance = (Math.max(sphere.radius, 5) / Math.sin((camera.fov * DEG) / 2)) * 1.08;
        const shots: { view: string; data: string }[] = [];
        const out = document.createElement('canvas');
        const scale = Math.min(1, 1024 / src.width);
        out.width = Math.round(src.width * scale);
        out.height = Math.round(src.height * scale);
        try {
          for (const v of views) {
            const dir = new THREE.Vector3(...v.dir).normalize();
            if (Math.abs(dir.z) > 0.95) camera.up.set(0, 1, 0);
            else camera.up.set(0, 0, 1);
            camera.position.copy(sphere.center).addScaledVector(dir, distance);
            camera.near = Math.max(distance / 1000, 0.1);
            camera.far = distance * 100;
            camera.lookAt(sphere.center);
            camera.updateProjectionMatrix();
            gl.render(scene, camera);
            out.getContext('2d')?.drawImage(src, 0, 0, out.width, out.height);
            shots.push({ view: v.name, data: out.toDataURL('image/jpeg', 0.85) });
          }
        } finally {
          camera.position.copy(saved.position);
          camera.up.copy(saved.up);
          camera.near = saved.near;
          camera.far = saved.far;
          if (saved.target) camera.lookAt(saved.target);
          camera.updateProjectionMatrix();
          controls?.update();
          gl.render(scene, camera);
        }
        return shots;
      },
      dropToGround: (id) => {
        const object = objects.current.get(id);
        if (!object || !object.children.length) return null;
        object.updateWorldMatrix(true, true);
        return -new THREE.Box3().setFromObject(object).min.z;
      },
    }),
    [fit, gl, scene, camera, controls],
  );

  const pick = useCallback(
    (e: ThreeEvent<MouseEvent>, instance: CadInstance, mesh: PartMesh | null) => {
      if (e.delta > 4) return; // the pointer moved: that was an orbit, not a click
      e.stopPropagation();
      if (instance.id !== selectedId) {
        onSelect(instance.id);
        onFace(null);
        return;
      }
      // Clicking the selected part picks the B-rep face under the cursor.
      const triangle = e.faceIndex ?? -1;
      const hit = mesh?.faces.find((f) => triangle * 3 >= f.start && triangle * 3 < f.start + f.count) ?? null;
      onFace(hit && face?.id === hit.id ? null : hit);
    },
    [selectedId, face, onSelect, onFace],
  );

  const commit = useCallback(() => {
    if (!target || !selectedId) return;
    const p = target.position;
    const r = target.rotation;
    const round = (v: number, d = 1000) => Math.round(v * d) / d;
    onTransform(
      selectedId,
      [round(p.x), round(p.y), round(p.z)],
      [round(r.x / DEG, 100), round(r.y / DEG, 100), round(r.z / DEG, 100)],
    );
  }, [target, selectedId, onTransform]);

  return (
    <>
      <color attach="background" args={['#0a0a0a']} />
      <hemisphereLight args={['#dfe7f0', '#20201c', 0.9]} position={[0, 0, 1]} />
      <directionalLight position={[300, -400, 600]} intensity={1.6} />
      <directionalLight position={[-400, 300, 200]} intensity={0.5} />
      {/* Soft fill from below, so the underside (motors, casters, nuts) stays readable. */}
      <directionalLight position={[200, -300, -500]} intensity={0.55} />

      <Grid
        args={[2000, 2000]}
        cellSize={10}
        sectionSize={100}
        cellColor="#1c1c1c"
        sectionColor="#2e2e2e"
        fadeDistance={3000}
        infiniteGrid
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.01]}
      />

      <group>
        {instances
          .filter((i) => i.visible && partById.get(i.part_id)?.version)
          .map((instance) => (
            <InstanceObject
              key={instance.id}
              instance={instance}
              part={partById.get(instance.part_id)!}
              selected={instance.id === selectedId}
              face={instance.id === selectedId ? face : null}
              register={register}
              onPick={pick}
            />
          ))}
      </group>

      {target && (
        <TransformControls
          object={target}
          mode={mode}
          size={0.8}
          translationSnap={snap ? 5 : null}
          rotationSnap={snap ? 15 * DEG : null}
          onMouseUp={commit}
        />
      )}

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#000" />
      </GizmoHelper>
    </>
  );
}

export default function StudioViewport(props: Props) {
  return (
    <Canvas
      camera={{ position: [250, -250, 200], up: [0, 0, 1], fov: 40, near: 0.5, far: 50000 }}
      onPointerMissed={(e) => {
        if (e.type === 'click') {
          props.onSelect(null);
          props.onFace(null);
        }
      }}
    >
      <Scene {...props} handleRef={props.controlRef ?? null} />
    </Canvas>
  );
}

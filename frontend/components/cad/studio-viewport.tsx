'use client';

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, GizmoHelper, GizmoViewport, Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { cadApi, type CadInstance, type CadPart, type FaceInfo, type PartMesh, type Vec3 } from '@/lib/api/cad';

const DEG = Math.PI / 180;
// The scene uses CAD axes directly: millimetres, Z up (the camera's up is +Z).

export type TransformMode = 'translate' | 'rotate';

export interface ViewportHandle {
  fit: () => void;
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
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: any };
  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const fitted = useRef(false);

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
      dropToGround: (id) => {
        const object = objects.current.get(id);
        if (!object || !object.children.length) return null;
        object.updateWorldMatrix(true, true);
        return -new THREE.Box3().setFromObject(object).min.z;
      },
    }),
    [fit],
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

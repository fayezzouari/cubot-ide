/**
 * Physics sandbox for the assembly (Rapier, Z up, gravity -9.81).
 *
 * Every copy becomes a convex-hull collider. Copies joined by fixed mates
 * form ONE rigid body (a plate with its standoffs and screws moves as a
 * piece); a revolute mate becomes a hinge about the mated port's axis; a
 * body with a copy mated to the ground is static. Parts placed by hand are
 * free bodies: they fall, rest and collide. Dragging a part drives its
 * body kinematically, so hinged neighbours swing and free parts get pushed;
 * a static body can be dragged too and stays where it is released.
 *
 * Rapier works in metres; the assembly is in millimetres. Poses come back
 * in millimetres and degrees (Euler XYZ), the viewer's convention.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CadInstance, CadPart, PartHulls, PartMesh, Vec3 } from '@/lib/api/cad';

const MM = 0.001;
const DEG = Math.PI / 180;
const HULL_POINTS = 1500; // enough for a faithful hull, cheap to build
const DENSITY = 1200; // kg/m³, PLA-ish

export interface Pose {
  position: Vec3;
  rotation: Vec3;
}

export interface PhysicsWorld {
  step(dt: number): void;
  /** Current pose of every simulated copy, in the viewer's units. */
  poses(): Map<string, Pose>;
  /** Start driving the body under `instanceId` from `point` (world, mm). */
  grab(instanceId: string, point: Vec3): boolean;
  drag(point: Vec3): void;
  release(): void;
  readonly dragging: boolean;
  /** How the copies were grouped: for the UI ("12 bodies, 4 hinges, 1 fixed"). */
  readonly summary: { bodies: number; hinges: number; fixed: number; overlapping: number };
  dispose(): void;
}

const PENETRATION = 0.0003; // m: deeper than this at the start counts as "already overlapping"

function matrixOf(instance: CadInstance) {
  const m = new THREE.Matrix4();
  const e = new THREE.Euler(instance.rotation[0] * DEG, instance.rotation[1] * DEG, instance.rotation[2] * DEG, 'XYZ');
  m.makeRotationFromEuler(e);
  m.setPosition(instance.position[0], instance.position[1], instance.position[2]);
  return m;
}

function poseOf(m: THREE.Matrix4): Pose {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const r = (v: number, d: number) => Math.round(v * d) / d;
  return {
    position: [r(p.x, 1000), r(p.y, 1000), r(p.z, 1000)],
    rotation: [r(e.x / DEG, 100), r(e.y / DEG, 100), r(e.z / DEG, 100)],
  };
}

/** Resolve "slug#n" to the n-th copy of the part with that slug. */
function targetOf(ref: string, parts: Map<string, CadPart>, instances: CadInstance[]) {
  const [slug, idx] = ref.split('#');
  const part = [...parts.values()].find((p) => p.slug === slug);
  if (!part) return null;
  const copies = instances.filter((i) => i.part_id === part.id);
  const k = Math.min(Math.max((parseInt(idx || '1', 10) || 1) - 1, 0), copies.length - 1);
  return copies[k] ?? null;
}

export async function buildPhysics(
  parts: CadPart[],
  instances: CadInstance[],
  meshes: Map<string, PartMesh>,
  hulls: Map<string, PartHulls> = new Map(),
): Promise<PhysicsWorld> {
  const R: typeof RAPIER = await import('@dimforge/rapier3d-compat');
  await R.init();
  const partById = new Map(parts.map((p) => [p.id, p]));
  const live = instances.filter((i) => i.visible && partById.get(i.part_id)?.version && meshes.has(partById.get(i.part_id)!.version!.key));
  const index = new Map(live.map((i, k) => [i.id, k]));

  // Union-find over fixed mates (and legacy face attachments).
  const parent = live.map((_, k) => k);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const grounded = new Set<number>();
  const hinges: { child: number; target: number; anchor: THREE.Vector3; axis: THREE.Vector3 }[] = [];
  for (const inst of live) {
    const k = index.get(inst.id)!;
    const mate = inst.mate;
    const attach = inst.attach as { to?: string } | null | undefined;
    if (mate) {
      if (mate.to === 'ground') {
        grounded.add(k);
        continue;
      }
      const target = targetOf(mate.to, partById, instances);
      const t = target ? index.get(target.id) : undefined;
      if (t === undefined) continue;
      if (mate.joint === 'revolute') {
        const tport = partById.get(target!.part_id)?.version?.ports?.[mate.to_port];
        if (tport) {
          const m = matrixOf(target!);
          const anchor = new THREE.Vector3(...tport.origin).applyMatrix4(m);
          const axis = new THREE.Vector3(...tport.axis).transformDirection(m).normalize();
          hinges.push({ child: k, target: t, anchor, axis });
          continue;
        }
      }
      union(k, t);
    } else if (attach?.to) {
      if (attach.to === 'ground') grounded.add(k);
      else {
        const target = targetOf(attach.to, partById, instances);
        const t = target ? index.get(target.id) : undefined;
        if (t !== undefined) union(k, t);
      }
    }
  }

  const world = new R.World({ x: 0, y: 0, z: -9.81 });
  world.timestep = 1 / 120;

  // The floor sits at the assembly's lowest point, so nothing starts inside it.
  let floor = 0;
  for (const inst of live) {
    const m = matrixOf(inst);
    const bb = partById.get(inst.part_id)!.version!.bbox;
    if (!bb) continue;
    for (const x of [bb.min[0], bb.max[0]])
      for (const y of [bb.min[1], bb.max[1]])
        for (const z of [bb.min[2], bb.max[2]]) floor = Math.min(floor, new THREE.Vector3(x, y, z).applyMatrix4(m).z);
  }
  const ground = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 0, floor * MM - 0.5));
  world.createCollider(R.ColliderDesc.cuboid(50, 50, 0.5).setFriction(0.8), ground);

  // One body per group. Body frames are translation only (world orientation), so hinge axes and
  // anchors are the same in every body's local frame; each collider carries its copy's rotation.
  // Every body starts kinematic: one probe step finds the pairs that already overlap (a spline
  // in a horn, a defect the review didn't fix) so they can be left alone instead of exploding.
  const groups = new Map<number, number[]>();
  live.forEach((_, k) => {
    const root = find(k);
    groups.set(root, [...(groups.get(root) ?? []), k]);
  });
  const bodyOf = new Map<number, RAPIER.RigidBody>();
  const bodyOrigin = new Map<number, THREE.Vector3>(); // body frame origin, mm
  const local = new Map<number, THREE.Matrix4>(); // copy → its matrix relative to the body origin (mm)
  const colliders: RAPIER.Collider[] = [];
  const intended = new Map<number, RAPIER.RigidBodyType>(); // body handle → type after the probe
  let fixedBodies = 0;
  for (const [root, members] of groups) {
    const isStatic = members.some((k) => grounded.has(k));
    const origin = new THREE.Vector3(...live[members[0]].position);
    const desc = R.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(origin.x * MM, origin.y * MM, origin.z * MM)
      .setLinearDamping(0.4)
      .setAngularDamping(0.6);
    const body = world.createRigidBody(desc);
    intended.set(body.handle, isStatic ? R.RigidBodyType.Fixed : R.RigidBodyType.Dynamic);
    if (isStatic) fixedBodies++;
    for (const k of members) {
      const inst = live[k];
      const part = partById.get(inst.part_id)!;
      const mesh = meshes.get(part.version!.key)!;
      const m = matrixOf(inst);
      const rel = m.clone();
      rel.elements[12] -= origin.x;
      rel.elements[13] -= origin.y;
      rel.elements[14] -= origin.z;
      local.set(k, rel);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      // Collision shape: the part's convex pieces (bores and pockets kept) when the server has
      // them, else one convex hull of the mesh, else its box.
      const shapes: RAPIER.ColliderDesc[] = [];
      const pieces = hulls.get(part.version!.key)?.hulls ?? [];
      for (const piece of pieces) {
        const desc = R.ColliderDesc.convexHull(new Float32Array(piece.points.map((v) => v * MM)));
        if (desc) shapes.push(desc);
      }
      if (!shapes.length) {
        const n = mesh.positions.length / 3;
        const stride = Math.max(1, Math.floor(n / HULL_POINTS));
        const pts: number[] = [];
        for (let i = 0; i < n; i += stride) {
          pts.push(mesh.positions[i * 3] * MM, mesh.positions[i * 3 + 1] * MM, mesh.positions[i * 3 + 2] * MM);
        }
        const hull = R.ColliderDesc.convexHull(new Float32Array(pts));
        if (hull) shapes.push(hull);
      }
      if (!shapes.length) {
        const size = part.version!.bbox?.size ?? [10, 10, 10];
        const min = part.version!.bbox?.min ?? [-5, -5, 0];
        const c = new THREE.Vector3(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2).applyQuaternion(q);
        rel.elements[12] += c.x;
        rel.elements[13] += c.y;
        rel.elements[14] += c.z;
        shapes.push(R.ColliderDesc.cuboid((size[0] * MM) / 2, (size[1] * MM) / 2, (size[2] * MM) / 2));
      }
      for (const collider of shapes) {
        collider
          .setTranslation(rel.elements[12] * MM, rel.elements[13] * MM, rel.elements[14] * MM)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setDensity(DENSITY)
          .setFriction(0.6)
          .setRestitution(0.05)
          .setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS)
          .setActiveCollisionTypes(R.ActiveCollisionTypes.ALL); // kinematic probe: every pair is checked
        colliders.push(world.createCollider(collider, body));
      }
      bodyOf.set(k, body);
      bodyOrigin.set(k, origin);
    }
  }

  // Hinges between bodies, about the target port's world axis through its origin. The two
  // bodies of a hinge never collide with each other (the spline sits inside the horn's hull).
  let hingeCount = 0;
  for (const h of hinges) {
    const b1 = bodyOf.get(h.target)!;
    const b2 = bodyOf.get(h.child)!;
    if (b1 === b2) continue;
    const o1 = bodyOrigin.get(h.target)!;
    const o2 = bodyOrigin.get(h.child)!;
    const a1 = h.anchor.clone().sub(o1).multiplyScalar(MM);
    const a2 = h.anchor.clone().sub(o2).multiplyScalar(MM);
    const joint = R.JointData.revolute(
      { x: a1.x, y: a1.y, z: a1.z },
      { x: a2.x, y: a2.y, z: a2.z },
      { x: h.axis.x, y: h.axis.y, z: h.axis.z },
    );
    world.createImpulseJoint(joint, b1, b2, true).setContactsEnabled(false);
    hingeCount++;
  }

  // Probe step: pairs of bodies already penetrating each other are excluded from contacts, so
  // the simulation starts from rest instead of flinging them apart.
  const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const excluded = new Set<string>();
  const parentOf = new Map(colliders.map((c) => [c.handle, c.parent()!.handle]));
  world.step();
  for (const c of colliders) {
    world.narrowPhase.contactPairsWith(c.handle, (other) => {
      const b1 = parentOf.get(c.handle);
      const b2 = parentOf.get(other);
      if (b1 === undefined || b2 === undefined || b1 === b2) return;
      world.narrowPhase.contactPair(c.handle, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactDist(i) < -PENETRATION) {
            excluded.add(pairKey(b1, b2));
            return;
          }
        }
      });
    });
  }
  for (const c of colliders) c.setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT);
  world.bodies.forEach((b) => {
    const type = intended.get(b.handle);
    if (type !== undefined) b.setBodyType(type, false);
  });
  const hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (_c1, _c2, b1, b2) => (excluded.has(pairKey(b1, b2)) ? null : R.SolverFlags.COMPUTE_IMPULSE),
    filterIntersectionPair: () => true,
  };

  let held: { body: RAPIER.RigidBody; offset: THREE.Vector3; wasDynamic: boolean } | null = null;
  const worldMatrix = (k: number) => {
    const body = bodyOf.get(k)!;
    const t = body.translation();
    const r = body.rotation();
    const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    m.setPosition(t.x / MM, t.y / MM, t.z / MM);
    return m.multiply(local.get(k)!);
  };

  return {
    get dragging() {
      return held !== null;
    },
    summary: { bodies: groups.size, hinges: hingeCount, fixed: fixedBodies, overlapping: excluded.size },
    step(dt) {
      world.timestep = Math.min(Math.max(dt, 1 / 240), 1 / 30);
      world.step(undefined, hooks);
    },
    poses() {
      const out = new Map<string, Pose>();
      live.forEach((inst, k) => out.set(inst.id, poseOf(worldMatrix(k))));
      return out;
    },
    grab(instanceId, point) {
      const k = index.get(instanceId);
      if (k === undefined) return false;
      const body = bodyOf.get(k)!;
      // A grounded body follows the pointer too (and stays put when released), so an assembly
      // that is one block fixed to the ground can still be moved to see its hinges react.
      const wasDynamic = body.isDynamic();
      const t = body.translation();
      held = { body, offset: new THREE.Vector3(point[0] * MM - t.x, point[1] * MM - t.y, point[2] * MM - t.z), wasDynamic };
      body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
      return true;
    },
    drag(point) {
      if (!held) return;
      held.body.setNextKinematicTranslation({
        x: point[0] * MM - held.offset.x,
        y: point[1] * MM - held.offset.y,
        z: point[2] * MM - held.offset.z,
      });
    },
    release() {
      if (!held) return;
      held.body.setBodyType(held.wasDynamic ? R.RigidBodyType.Dynamic : R.RigidBodyType.Fixed, true);
      held = null;
    },
    dispose() {
      world.free();
    },
  };
}

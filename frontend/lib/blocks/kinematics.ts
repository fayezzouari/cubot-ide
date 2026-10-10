// Kinematics for the simulated 6-axis arm.
//
// Conventions (all lengths in millimetres, angles in degrees, Y is up):
//   J1  base yaw about +Y. 0° points the arm towards +Z.
//   J2  shoulder pitch. 0° = upper arm vertical, positive leans forward.
//   J3  elbow pitch, relative to the upper arm.
//   J4  forearm roll (does not move the TCP for a downward tool).
//   J5  wrist pitch, relative to the forearm.
//   J6  tool roll.
//
// The 3D model (WorkcellView) is built from exactly the same chain, so the
// forward kinematics here and the rendered arm always agree.

import type { Vec3 } from './types';

export const ARM = {
  shoulderHeight: 350, // base plate to J2
  upperArm: 450, // J2 -> J3
  forearm: 400, // J3 -> J5
  tool: 150, // J5 -> TCP (gripper tip)
};

export const JOINT_LIMITS: [number, number][] = [
  [-170, 170],
  [-30, 130],
  [-10, 160],
  [-180, 180],
  [-120, 120],
  [-180, 180],
];

// Tool pointing down, 400 mm in front of the base, 650 mm high.
export const HOME_JOINTS = [0, 0, 90, 0, 90, 0];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function forwardKinematics(j: number[]): Vec3 {
  const a2 = rad(j[1]);
  const a3 = a2 + rad(j[2]);
  const a5 = a3 + rad(j[4]);
  const h =
    ARM.upperArm * Math.sin(a2) +
    ARM.forearm * Math.sin(a3) +
    ARM.tool * Math.sin(a5);
  const y =
    ARM.shoulderHeight +
    ARM.upperArm * Math.cos(a2) +
    ARM.forearm * Math.cos(a3) +
    ARM.tool * Math.cos(a5);
  const yaw = rad(j[0]);
  return { x: h * Math.sin(yaw), y, z: h * Math.cos(yaw) };
}

// Points along the arm's links (shoulder → elbow → wrist → tool flange), used
// for collision checks against the cell. Each has the link's half-thickness.
export function armSamples(j: number[]): { p: Vec3; r: number }[] {
  const a2 = rad(j[1]);
  const a3 = a2 + rad(j[2]);
  const a5 = a3 + rad(j[4]);
  const yaw = rad(j[0]);
  const at = (h: number, y: number): Vec3 => ({ x: h * Math.sin(yaw), y, z: h * Math.cos(yaw) });
  const shoulder = { h: 0, y: ARM.shoulderHeight };
  const elbow = { h: ARM.upperArm * Math.sin(a2), y: shoulder.y + ARM.upperArm * Math.cos(a2) };
  const wrist = { h: elbow.h + ARM.forearm * Math.sin(a3), y: elbow.y + ARM.forearm * Math.cos(a3) };
  // Stop short of the TCP: the fingers are checked separately.
  const flange = { h: wrist.h + 90 * Math.sin(a5), y: wrist.y + 90 * Math.cos(a5) };
  const out: { p: Vec3; r: number }[] = [];
  const link = (a: { h: number; y: number }, b: { h: number; y: number }, r: number, n: number) => {
    for (let i = 1; i <= n; i++) {
      const s = i / n;
      out.push({ p: at(a.h + (b.h - a.h) * s, a.y + (b.y - a.y) * s), r });
    }
  };
  link(shoulder, elbow, 48, 6);
  link(elbow, wrist, 38, 6);
  link(wrist, flange, 32, 2);
  return out;
}

// Parallel gripper, measured from the tool axis to the middle of each finger
// (mm). Fully open the inner faces clear a 50 mm part by 8 mm a side: enough
// to drop over it, little enough to fit between neighbours 20 mm apart.
export const FINGER = { closed: 8, open: 37, holding: 29, thickness: 8, depth: 34, length: 55 };

export const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

// J6 that gives tool angle `rz` at target `t`, chosen closest to `near` and
// within the J6 limits; null if none fits.
export function rollFor(t: Vec3, rz: number, near: number): number | null {
  const base = deg(Math.atan2(t.x, t.z)) - rz;
  const [lo, hi] = JOINT_LIMITS[5];
  let best: number | null = null;
  for (let k = -2; k <= 2; k++) {
    const c = base + 360 * k;
    if (c < lo || c > hi) continue;
    if (best === null || Math.abs(c - near) < Math.abs(best - near)) best = c;
  }
  return best;
}

// Tool yaw about +Y for a downward-pointing tool (degrees). J6 turns the tool
// about its own axis, which points down, so it subtracts from the base yaw.
export function toolYaw(j: number[]): number {
  return j[0] - j[5];
}

export class UnreachableError extends Error {
  constructor(target: Vec3, reason: string) {
    super(
      `Target (${target.x.toFixed(0)}, ${target.y.toFixed(0)}, ${target.z.toFixed(0)}) mm is unreachable: ${reason}`,
    );
    this.name = 'UnreachableError';
  }
}

// Analytic IK for a tool pointing straight down (the normal pose for
// pick-and-place). `toolRoll` is passed through to J6.
export function inverseKinematics(t: Vec3, toolRoll = 0): number[] {
  const r = Math.hypot(t.x, t.z);
  if (t.y < -5) throw new UnreachableError(t, 'below the table surface');
  if (r < 120) throw new UnreachableError(t, 'too close to the robot base');

  // Wrist centre sits one tool length above the TCP.
  const wy = t.y + ARM.tool - ARM.shoulderHeight;
  const d = Math.hypot(r, wy);
  const L1 = ARM.upperArm;
  const L2 = ARM.forearm;
  if (d > L1 + L2 - 1) {
    throw new UnreachableError(t, `outside reach (${d.toFixed(0)} of ${L1 + L2} mm)`);
  }
  if (d < Math.abs(L1 - L2) + 1) throw new UnreachableError(t, 'inside the minimum reach');

  // Elbow-up solution. Angles are measured from vertical, forward positive.
  const cosElbow = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const elbow = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
  const toWrist = Math.atan2(r, wy); // angle of the shoulder->wrist line from vertical
  const inner = Math.atan2(L2 * Math.sin(elbow), L1 + L2 * Math.cos(elbow));
  const a2 = toWrist - inner;
  const a3 = a2 + elbow;

  const j1 = deg(Math.atan2(t.x, t.z));
  const j2 = deg(a2);
  const j3 = deg(elbow);
  const j5 = 180 - deg(a3); // bring the tool to point straight down
  const joints = [j1, j2, j3, 0, j5, toolRoll];

  const violated = checkLimits(joints);
  if (violated !== null) {
    throw new UnreachableError(
      t,
      `J${violated + 1} would be ${joints[violated].toFixed(0)}° (limit ${JOINT_LIMITS[violated][0]}…${JOINT_LIMITS[violated][1]}°)`,
    );
  }
  return joints;
}

// Returns the index of the first joint outside its limits, or null.
export function checkLimits(joints: number[]): number | null {
  for (let i = 0; i < joints.length; i++) {
    const [lo, hi] = JOINT_LIMITS[i];
    if (joints[i] < lo - 0.01 || joints[i] > hi + 0.01) return i;
  }
  return null;
}

export function isReachable(t: Vec3): boolean {
  try {
    inverseKinematics(t);
    return true;
  } catch {
    return false;
  }
}

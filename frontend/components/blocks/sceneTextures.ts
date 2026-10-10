// Procedural textures and shared geometry for the 3D workcell.
//
// Textures are drawn on a canvas at runtime, so the view needs no image
// downloads. Each one is created once, on first use, and shared by every mesh.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PART_SIZE } from '@/lib/blocks/layout';

// Small deterministic PRNG so textures look the same on every load.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, srgb = true) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, count: number, alpha: number, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(r() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

// Sealed concrete floor with faint panel joints. One tile covers 1 m.
export function concreteTexture() {
  return cached('concrete', () =>
    canvasTexture(512, (ctx, n) => {
      ctx.fillStyle = '#2b2b30';
      ctx.fillRect(0, 0, n, n);
      const r = rng(7);
      // Large soft blotches.
      for (let i = 0; i < 60; i++) {
        const x = r() * n;
        const y = r() * n;
        const rad = 30 + r() * 90;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const light = r() > 0.5;
        g.addColorStop(0, light ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      speckle(ctx, n, 9000, 0.18, 11);
      // Panel joints on the tile edge.
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, n - 2, n - 2);
    }),
  );
}

// Rubber belt with transverse cleats. One tile covers 200 mm of belt.
export function beltTexture() {
  return cached('belt', () =>
    canvasTexture(256, (ctx, n) => {
      ctx.fillStyle = '#1d1d21';
      ctx.fillRect(0, 0, n, n);
      speckle(ctx, n, 2500, 0.12, 3);
      for (let i = 0; i < 4; i++) {
        const x = (i * n) / 4;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, 0, 6, n);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x + 6, 0, 3, n);
      }
    }),
  );
}

// Pine planks: warm base with grain streaks along u. One tile ≈ 250 mm.
export function woodTexture() {
  return cached('wood', () =>
    canvasTexture(256, (ctx, n) => {
      ctx.fillStyle = '#b07b45';
      ctx.fillRect(0, 0, n, n);
      const r = rng(21);
      for (let i = 0; i < 70; i++) {
        const y = r() * n;
        const dark = r() > 0.4;
        ctx.strokeStyle = dark ? `rgba(90,50,20,${0.15 + r() * 0.25})` : `rgba(255,220,170,${0.08 + r() * 0.12})`;
        ctx.lineWidth = 0.5 + r() * 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= n; x += 16) ctx.lineTo(x, y + Math.sin(x / 30 + i) * 2 + (r() - 0.5) * 2);
        ctx.stroke();
      }
      // A couple of knots.
      for (let i = 0; i < 2; i++) {
        const x = r() * n;
        const y = r() * n;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
        g.addColorStop(0, 'rgba(70,35,10,0.7)');
        g.addColorStop(1, 'rgba(70,35,10,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 10, y - 10, 20, 20);
      }
    }),
  );
}

// Fine directional scratches used as a roughness map on brushed metal.
export function brushedRoughness() {
  return cached('brushed', () =>
    canvasTexture(
      256,
      (ctx, n) => {
        ctx.fillStyle = '#6f6f6f';
        ctx.fillRect(0, 0, n, n);
        const r = rng(5);
        for (let i = 0; i < 900; i++) {
          const v = 80 + Math.floor(r() * 90);
          ctx.strokeStyle = `rgba(${v},${v},${v},0.5)`;
          ctx.lineWidth = r() * 1.2;
          const y = r() * n;
          ctx.beginPath();
          ctx.moveTo(r() * n, y);
          ctx.lineTo(r() * n + 60, y);
          ctx.stroke();
        }
      },
      false,
    ),
  );
}

// Black/yellow hazard stripes for end stops and the fence top rail.
export function hazardTexture() {
  return cached('hazard', () =>
    canvasTexture(128, (ctx, n) => {
      ctx.fillStyle = '#facc15';
      ctx.fillRect(0, 0, n, n);
      ctx.fillStyle = '#18181b';
      for (let i = -n; i < n * 2; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 16, 0);
        ctx.lineTo(i + 16 + n, n);
        ctx.lineTo(i + n, n);
        ctx.fill();
      }
    }),
  );
}

// Welded wire mesh for fence panels (alpha-tested).
export function meshTexture() {
  return cached('wiremesh', () =>
    canvasTexture(64, (ctx, n) => {
      ctx.clearRect(0, 0, n, n);
      ctx.strokeStyle = '#d4d4d8';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, n, n);
    }),
  );
}

// Returns a copy with its own repeat/offset (the image is shared).
export function tiled(tex: THREE.Texture, u: number, v: number) {
  const t = tex.clone();
  t.repeat.set(u, v);
  t.needsUpdate = true;
  return t;
}

let partGeometry: THREE.BufferGeometry | null = null;
export function roundedPartGeometry() {
  partGeometry ??= new RoundedBoxGeometry(PART_SIZE, PART_SIZE, PART_SIZE, 3, 4);
  return partGeometry;
}

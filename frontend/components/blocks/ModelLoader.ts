// Loads user-supplied 3D models for custom stations.
//
// Supported files:
//   .glb   binary glTF — recommended: one file with geometry, materials, textures
//   .gltf  only when self-contained (buffers/textures embedded as data URIs)
//   .stl   CAD exports (geometry only, usually millimetres, Z-up)
//   .obj   geometry only (materials from a separate .mtl file are not loaded)
//
// The file is kept as a data URL inside the layout so environments stay a
// single portable JSON document; parsed models are cached per file.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { MAX_MODEL_BYTES, type ModelFormat, type ModelSource } from '@/lib/blocks/layout';

export const MODEL_ACCEPT = '.glb,.gltf,.stl,.obj';

export function formatOf(fileName: string): ModelFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'glb' || ext === 'gltf' || ext === 'stl' || ext === 'obj' ? ext : null;
}

async function toBuffer(dataUrl: string): Promise<ArrayBuffer> {
  return (await fetch(dataUrl)).arrayBuffer();
}

async function parse(format: ModelFormat, dataUrl: string): Promise<THREE.Object3D> {
  const buffer = await toBuffer(dataUrl);
  if (format === 'stl') {
    const geometry = new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  }
  if (format === 'obj') {
    return new OBJLoader().parse(new TextDecoder().decode(buffer));
  }
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buffer,
      '',
      (gltf) => resolve(gltf.scene),
      () =>
        reject(
          new Error(
            format === 'gltf'
              ? 'this .gltf points to separate .bin or texture files. Export it as a single .glb instead.'
              : 'the file is not a valid glTF binary.',
          ),
        ),
    );
  });
}

const cache = new Map<string, Promise<THREE.Object3D>>();

// The model as authored (file units, original axes). Callers clone it.
export function loadModel(source: Pick<ModelSource, 'format' | 'data'>): Promise<THREE.Object3D> {
  let p = cache.get(source.data);
  if (!p) {
    p = parse(source.format, source.data);
    p.catch(() => cache.delete(source.data));
    cache.set(source.data, p);
  }
  return p;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('could not read the file'));
    r.readAsDataURL(file);
  });
}

// Reads and validates a model file, and measures it.
export async function readModelFile(file: File): Promise<ModelSource> {
  const format = formatOf(file.name);
  if (!format) throw new Error('use a .glb, .gltf, .stl or .obj file.');
  if (file.size > MAX_MODEL_BYTES) {
    throw new Error(`the file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_MODEL_BYTES / 1048576} MB. Simplify or compress the model.`);
  }
  const data = await readAsDataUrl(file);
  const object = await loadModel({ format, data });
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw new Error('the file contains no geometry.');
  const size = box.getSize(new THREE.Vector3());
  const cad = format === 'stl' || format === 'obj';
  return {
    file: file.name,
    format,
    data,
    bytes: file.size,
    size: [size.x, size.y, size.z],
    // glTF is metres and Y-up by specification; CAD meshes are usually mm, Z-up.
    unit: cad ? 'mm' : 'm',
    zUp: cad,
  };
}

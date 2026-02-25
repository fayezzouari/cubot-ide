'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, ZoomIn, ZoomOut, Box } from 'lucide-react';

const PART_COLORS = [
  0x4fc3f7, // light blue
  0xff7043, // deep orange
  0x66bb6a, // green
  0xffa726, // amber
  0xab47bc, // purple
  0x26c6da, // cyan
  0xec407a, // pink
  0x8d6e63, // brown
];

interface AssemblyPart {
  id: string;
  name: string;
  stl_base64: string;
}

interface CadViewerProps {
  assemblyParts?: AssemblyPart[];
}

export default function CadViewer({ assemblyParts = [] }: CadViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const partMeshesRef = useRef<any[]>([]);
  const frameIdRef = useRef<number>(0);
  const [threeLoaded, setThreeLoaded] = useState(false);
  const threeRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadThree() {
      try {
        const [THREE, { OrbitControls }, { STLLoader }] = await Promise.all([
          import('three'),
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('three/examples/jsm/loaders/STLLoader.js'),
        ]);
        if (cancelled) return;
        threeRef.current = { THREE, OrbitControls, STLLoader };
        setThreeLoaded(true);
      } catch (err) {
        console.error('Failed to load Three.js:', err);
      }
    }
    loadThree();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!threeLoaded || !containerRef.current || !threeRef.current) return;

    const { THREE } = threeRef.current;
    const container = containerRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080808);
    sceneRef.current = scene;

    // Subtle grid
    const gridHelper = new THREE.GridHelper(200, 20, 0x1a1a1a, 0x141414);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(30);
    scene.add(axesHelper);

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(100, 80, 100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const { OrbitControls } = threeRef.current;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dl1.position.set(100, 100, 50);
    dl1.castShadow = true;
    scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dl2.position.set(-100, 50, -50);
    scene.add(dl2);

    function animate() {
      frameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [threeLoaded]);


  useEffect(() => {
    if (!sceneRef.current || !threeRef.current) return;

    const { THREE, STLLoader } = threeRef.current;
    const scene = sceneRef.current;

    // Remove previous part meshes
    for (const m of partMeshesRef.current) {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    partMeshesRef.current = [];

    if (assemblyParts.length === 0) return;

    const loader = new STLLoader();
    const combinedBox = new THREE.Box3();

    assemblyParts.forEach((part, index) => {
      try {
        const binaryString = atob(part.stl_base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

        const geometry = loader.parse(bytes.buffer);
        geometry.computeBoundingBox();

        const color = PART_COLORS[index % PART_COLORS.length];
        const material = new THREE.MeshPhongMaterial({
          color,
          specular: 0x222222,
          shininess: 60,
          flatShading: false,
          transparent: true,
          opacity: 0.92,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        partMeshesRef.current.push(mesh);

        const box = new THREE.Box3().setFromObject(mesh);
        combinedBox.union(box);
      } catch (err) {
        console.error(`Failed to load STL for part "${part.name}":`, err);
      }
    });

    if (partMeshesRef.current.length === 0) return;

    // Center all parts around the combined bounding box center
    const center = new THREE.Vector3();
    combinedBox.getCenter(center);
    for (const m of partMeshesRef.current) {
      m.position.sub(center);
    }

    // Fit camera
    const size = combinedBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = cameraRef.current.fov * (Math.PI / 180);
    const cameraZ = (maxDim / (2 * Math.tan(fov / 2))) * 2;
    cameraRef.current.position.set(cameraZ, cameraZ * 0.7, cameraZ);
    cameraRef.current.lookAt(0, 0, 0);
    controlsRef.current?.target.set(0, 0, 0);
    controlsRef.current?.update();
  }, [assemblyParts, threeLoaded]);

  const handleResetView = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(100, 80, 100);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  };

  const handleZoom = (factor: number) => {
    if (!cameraRef.current) return;
    cameraRef.current.position.multiplyScalar(factor);
    controlsRef.current?.update();
  };

  return (
    <div className="relative w-full h-full bg-[#080808]">

      {/* Viewport controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        {[
          { icon: ZoomIn,    title: 'Zoom in',    action: () => handleZoom(0.8)  },
          { icon: ZoomOut,   title: 'Zoom out',   action: () => handleZoom(1.25) },
          { icon: RotateCcw, title: 'Reset view', action: handleResetView        },
        ].map(({ icon: Icon, title, action }) => (
          <button
            key={title}
            onClick={action}
            title={title}
            className="w-7 h-7 flex items-center justify-center bg-black/60 backdrop-blur-sm border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.06] text-white/40 hover:text-white/80 rounded-lg transition-all cursor-pointer"
          >
            <Icon size={13} />
          </button>
        ))}
      </div>

      {/* Empty state */}
      {assemblyParts.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-center justify-center mx-auto mb-3">
              <Box size={20} className="text-white/15" />
            </div>
            <p className="text-xs font-medium text-white/25">CAD Viewport</p>
            <p className="text-[11px] text-white/15 mt-1">Describe a component in the chat</p>
          </div>
        </div>
      )}

      {/* Three.js canvas */}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

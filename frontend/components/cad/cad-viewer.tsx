'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CadViewerProps {
  stlBase64: string | null;
}

export default function CadViewer({ stlBase64 }: CadViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const meshRef = useRef<any>(null);
  const frameIdRef = useRef<number>(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [threeLoaded, setThreeLoaded] = useState(false);
  const threeRef = useRef<any>(null);

  // Dynamically load Three.js modules
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
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize the 3D scene
  useEffect(() => {
    if (!threeLoaded || !containerRef.current || !threeRef.current) return;

    const { THREE } = threeRef.current;
    const container = containerRef.current;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // Grid helper
    const gridHelper = new THREE.GridHelper(200, 20, 0x444466, 0x333355);
    scene.add(gridHelper);

    // Axes helper
    const axesHelper = new THREE.AxesHelper(50);
    scene.add(axesHelper);

    // Camera
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      2000
    );
    camera.position.set(100, 80, 100);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const { OrbitControls } = threeRef.current;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 50);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-100, 50, -50);
    scene.add(directionalLight2);

    // Animation loop
    function animate() {
      frameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [threeLoaded]);

  // Load STL when data changes
  useEffect(() => {
    if (!stlBase64 || !sceneRef.current || !threeRef.current) return;

    const { THREE, STLLoader } = threeRef.current;
    const scene = sceneRef.current;

    // Remove previous mesh
    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      meshRef.current.material.dispose();
      meshRef.current = null;
    }

    try {
      // Decode base64 to binary
      const binaryString = atob(stlBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const loader = new STLLoader();
      const geometry = loader.parse(bytes.buffer);

      // Center the geometry
      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox!.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);

      const material = new THREE.MeshPhongMaterial({
        color: 0x4fc3f7,
        specular: 0x222222,
        shininess: 60,
        flatShading: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      meshRef.current = mesh;

      // Fit camera to model
      const boundingBox = new THREE.Box3().setFromObject(mesh);
      const size = boundingBox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = cameraRef.current.fov * (Math.PI / 180);
      let cameraZ = maxDim / (2 * Math.tan(fov / 2));
      cameraZ *= 2.0;

      cameraRef.current.position.set(cameraZ, cameraZ * 0.7, cameraZ);
      cameraRef.current.lookAt(0, 0, 0);
      controlsRef.current?.target.set(0, 0, 0);
      controlsRef.current?.update();

      setIsLoaded(true);
    } catch (err) {
      console.error('Failed to load STL:', err);
    }
  }, [stlBase64]);

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
    <div className="relative w-full h-full">
      {/* Viewer controls */}
      <div className="absolute top-3 right-3 z-10 flex gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={() => handleZoom(0.8)}
          className="w-8 h-8 bg-background/80 backdrop-blur-sm border-2 border-foreground"
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => handleZoom(1.25)}
          className="w-8 h-8 bg-background/80 backdrop-blur-sm border-2 border-foreground"
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={handleResetView}
          className="w-8 h-8 bg-background/80 backdrop-blur-sm border-2 border-foreground"
          title="Reset view"
        >
          <RotateCcw size={14} />
        </Button>
      </div>

      {/* Instructions overlay */}
      {!stlBase64 && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center p-6">
            <Maximize2 size={48} className="mx-auto mb-4 text-muted-foreground/40" />
            <p className="text-lg font-black text-muted-foreground/60">
              CAD VIEWPORT
            </p>
            <p className="text-sm font-bold text-muted-foreground/40 mt-2">
              Describe a 3D model in the chat to see it here
            </p>
          </div>
        </div>
      )}

      {/* Three.js canvas container */}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

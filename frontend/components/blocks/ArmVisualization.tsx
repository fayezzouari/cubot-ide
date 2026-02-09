'use client';

// Note: TypeScript may show errors for @react-three/fiber imports
// but the code works correctly at runtime
import { useRef } from 'react';
import { Canvas, extend, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// Extend Three.js elements for JSX
extend(THREE);

interface ArmVisualizationProps {
  position: { x: number; y: number; z: number };
  joints: number[];
}

function RobotArm({ position, joints }: ArmVisualizationProps) {
  const baseRef = useRef<THREE.Group>(null);
  const joint1Ref = useRef<THREE.Group>(null);
  const joint2Ref = useRef<THREE.Group>(null);
  const joint3Ref = useRef<THREE.Group>(null);
  const joint4Ref = useRef<THREE.Group>(null);
  const joint5Ref = useRef<THREE.Group>(null);

  // Log when props change
  console.log('RobotArm render - joints:', joints, 'position:', position);

  // Use useFrame to continuously update rotations
  useFrame(() => {
    if (joint1Ref.current) {
      const targetRotation = THREE.MathUtils.degToRad(joints[0] || 0);
      // Smooth interpolation
      joint1Ref.current.rotation.y = THREE.MathUtils.lerp(
        joint1Ref.current.rotation.y,
        targetRotation,
        0.1
      );
    }
    if (joint2Ref.current) {
      const targetRotation = THREE.MathUtils.degToRad(joints[1] || 0);
      joint2Ref.current.rotation.z = THREE.MathUtils.lerp(
        joint2Ref.current.rotation.z,
        targetRotation,
        0.1
      );
    }
    if (joint3Ref.current) {
      const targetRotation = THREE.MathUtils.degToRad(joints[2] || 0);
      joint3Ref.current.rotation.z = THREE.MathUtils.lerp(
        joint3Ref.current.rotation.z,
        targetRotation,
        0.1
      );
    }
    if (joint4Ref.current) {
      const targetRotation = THREE.MathUtils.degToRad(joints[3] || 0);
      joint4Ref.current.rotation.x = THREE.MathUtils.lerp(
        joint4Ref.current.rotation.x,
        targetRotation,
        0.1
      );
    }
    if (joint5Ref.current) {
      const targetRotation = THREE.MathUtils.degToRad(joints[4] || 0);
      joint5Ref.current.rotation.z = THREE.MathUtils.lerp(
        joint5Ref.current.rotation.z,
        targetRotation,
        0.1
      );
    }
  });

  return (
    <group ref={baseRef} position={[0, 0, 0]}>
      {/* Base */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.8, 1, 0.3, 32]} />
        <meshStandardMaterial color="#4a5568" />
      </mesh>

      {/* Joint 1 - Base rotation */}
      <group ref={joint1Ref} position={[0, 0.3, 0]}>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.5, 16]} />
          <meshStandardMaterial color="#667eea" />
        </mesh>

        {/* Joint 2 - Shoulder */}
        <group ref={joint2Ref} position={[0, 0.5, 0]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.4, 0.4, 0.4]} />
            <meshStandardMaterial color="#764ba2" />
          </mesh>
          
          {/* Link 1 */}
          <mesh position={[0, 0.75, 0]}>
            <boxGeometry args={[0.2, 1.5, 0.2]} />
            <meshStandardMaterial color="#667eea" />
          </mesh>

          {/* Joint 3 - Elbow */}
          <group ref={joint3Ref} position={[0, 1.5, 0]}>
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[0.35, 0.35, 0.35]} />
              <meshStandardMaterial color="#764ba2" />
            </mesh>

            {/* Link 2 */}
            <mesh position={[0, 0.6, 0]}>
              <boxGeometry args={[0.15, 1.2, 0.15]} />
              <meshStandardMaterial color="#667eea" />
            </mesh>

            {/* Joint 4 - Wrist rotation */}
            <group ref={joint4Ref} position={[0, 1.2, 0]}>
              <mesh position={[0, 0.15, 0]}>
                <cylinderGeometry args={[0.15, 0.15, 0.3, 16]} />
                <meshStandardMaterial color="#764ba2" />
              </mesh>

              {/* Joint 5 - Wrist bend */}
              <group ref={joint5Ref} position={[0, 0.3, 0]}>
                <mesh position={[0, 0, 0]}>
                  <boxGeometry args={[0.25, 0.25, 0.25]} />
                  <meshStandardMaterial color="#764ba2" />
                </mesh>

                {/* End effector */}
                <mesh position={[0, 0.2, 0]}>
                  <boxGeometry args={[0.3, 0.1, 0.3]} />
                  <meshStandardMaterial color="#f56565" />
                </mesh>

                {/* Gripper fingers */}
                <mesh position={[-0.15, 0.35, 0]}>
                  <boxGeometry args={[0.05, 0.3, 0.1]} />
                  <meshStandardMaterial color="#fc8181" />
                </mesh>
                <mesh position={[0.15, 0.35, 0]}>
                  <boxGeometry args={[0.05, 0.3, 0.1]} />
                  <meshStandardMaterial color="#fc8181" />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>

      {/* Target position indicator */}
      <mesh position={[position.x, position.y + 2, position.z]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color="#48bb78" emissive="#48bb78" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

function GridHelper() {
  return (
    <>
      <gridHelper args={[20, 20, '#6b7280', '#4b5563']} />
      <axesHelper args={[5]} />
    </>
  );
}

export default function ArmVisualization({ position, joints }: ArmVisualizationProps) {
  return (
    <div className="w-full h-full bg-slate-900">
      <Canvas
        camera={{ position: [5, 5, 5], fov: 50 }}
        shadows
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
        <pointLight position={[-10, -10, -5]} intensity={0.5} />
        
        <RobotArm position={position} joints={joints} />
        <GridHelper />
        
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={2}
          maxDistance={20}
        />
      </Canvas>
    </div>
  );
}

'use client';

import { useRef, useEffect, useState } from 'react';

interface SimpleArmTestProps {
  joints: number[];
}

export default function SimpleArmTest({ joints }: SimpleArmTestProps) {
  const [displayJoints, setDisplayJoints] = useState(joints);
  
  useEffect(() => {
    console.log('SimpleArmTest: joints prop changed to:', joints);
    setDisplayJoints(joints);
  }, [joints]);
  
  return (
    <div className="p-4 bg-slate-800 text-white">
      <h3 className="font-bold mb-2">Simple Arm Test (No 3D)</h3>
      <div className="space-y-1 text-sm font-mono">
        {displayJoints.map((angle, i) => (
          <div key={i} className="flex items-center gap-2">
            <span>J{i + 1}:</span>
            <div className="flex-1 bg-slate-700 h-4 relative">
              <div 
                className="bg-blue-500 h-full transition-all duration-300"
                style={{ width: `${(angle + 180) / 360 * 100}%` }}
              />
            </div>
            <span className="w-16 text-right">{angle.toFixed(1)}°</span>
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs text-slate-400">
        If these bars move when you click buttons, the state IS updating.
        If they don't move, the state is NOT reaching this component.
      </div>
    </div>
  );
}

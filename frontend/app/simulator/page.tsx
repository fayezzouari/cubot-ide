'use client';

import { Suspense } from 'react';
import SimulatorPageContent from './simulator-content';

export default function SimulatorPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center bg-black text-white">Loading...</div>}>
      <SimulatorPageContent />
    </Suspense>
  );
}

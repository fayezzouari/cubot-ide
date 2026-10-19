'use client';

import { Suspense } from 'react';
import FleetPageContent from './fleet-content';

export default function FleetPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center bg-black text-white">Loading...</div>}>
      <FleetPageContent />
    </Suspense>
  );
}

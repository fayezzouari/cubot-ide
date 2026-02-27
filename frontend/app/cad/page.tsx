'use client';

import { Suspense } from 'react';
import CadPageContent from './cad-content';

export default function CadPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center bg-black text-white">Loading...</div>}>
      <CadPageContent />
    </Suspense>
  );
}

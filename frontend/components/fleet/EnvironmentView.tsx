'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { Dimension } from '@/lib/fleet/types';
import { Environment2D } from './Environment2D';
import type { EnvironmentViewProps } from './types';

const Environment3D = dynamic(() => import('./Environment3D'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-white/30">
      <Loader2 size={16} className="animate-spin" />
    </div>
  ),
});

export function EnvironmentView({ dimension, ...rest }: EnvironmentViewProps & { dimension: Dimension }) {
  return dimension === '3d' ? <Environment3D {...rest} /> : <Environment2D {...rest} />;
}

'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

export function useNavigate() {
  const router = useRouter();
  return useCallback((path: string) => router.push(path), [router]);
}

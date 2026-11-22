'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { userService } from '@/lib/api';

// The API enforces admin access on every /admin route; this only keeps the UI away from non-admins.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'allowed' | 'denied'>('loading');

  useEffect(() => {
    let isMounted = true;
    userService.me()
      .then(me => { if (isMounted) setState(me.is_admin ? 'allowed' : 'denied'); })
      .catch(() => { if (isMounted) setState('denied'); });
    return () => { isMounted = false; };
  }, []);

  if (state === 'loading') {
    return <div className="h-40 rounded-xl bg-surface animate-pulse" />;
  }

  if (state === 'denied') {
    return (
      <div className="max-w-md rounded-xl border border-line bg-surface p-6">
        <ShieldAlert size={18} className="text-ink-3 mb-3" />
        <h1 className="text-sm font-semibold text-ink mb-1">Admins only</h1>
        <p className="text-xs text-ink-3 mb-4">Your account doesn&apos;t have access to this page.</p>
        <Link href="/dashboard" className="text-xs font-medium text-ink underline underline-offset-4">
          Back to your projects
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}

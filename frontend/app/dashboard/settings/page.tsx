'use client';

import { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { LogOut, Settings } from 'lucide-react';
import { userService } from '@/lib/api';
import type { UserProfile } from '@/lib/api/types';

export default function SettingsPage() {
  const { data: session } = useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let isMounted = true;
    userService.me()
      .then(me => { if (isMounted) setProfile(me); })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

  const rows = [
    { label: 'Name', value: profile?.name ?? session?.user?.name },
    { label: 'Email', value: profile?.email ?? session?.user?.email },
    { label: 'Sign-in provider', value: 'Google' },
    {
      label: 'Member since',
      value: profile && new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 text-white/40 font-mono text-[10px] uppercase tracking-wider mb-3">
        <Settings size={12} />
        Settings
      </div>
      <h1 className="text-3xl font-bold text-white tracking-tight mb-10">Settings</h1>

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-white/60 tracking-tight mb-1">Account</h2>
        <p className="text-xs text-white/35 mb-3">Managed by your Google account.</p>
        <dl className="rounded-xl border border-white/[0.08] bg-black divide-y divide-white/[0.06]">
          {rows.map(row => (
            <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-xs text-white/45">{row.label}</dt>
              <dd className="text-xs text-white font-mono truncate">{row.value || '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white/60 tracking-tight mb-3">Session</h2>
        <div className="rounded-xl border border-white/[0.08] bg-black flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-xs text-white">Sign out</p>
            <p className="text-[11px] text-white/35">End your session on this device.</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.12] hover:bg-white/[0.06] text-white font-medium text-xs rounded-lg transition-all cursor-pointer"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

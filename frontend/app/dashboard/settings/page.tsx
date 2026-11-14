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
      <div className="flex items-center gap-2 text-ink-3 text-xs mb-3">
        <Settings size={12} />
        Settings
      </div>
      <h1 className="text-3xl font-bold text-ink tracking-tight mb-10">Settings</h1>

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-ink-2 tracking-tight mb-1">Account</h2>
        <p className="text-xs text-ink-3 mb-3">Managed by your Google account.</p>
        <dl className="rounded-xl border border-line bg-surface divide-y divide-line">
          {rows.map(row => (
            <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-xs text-ink-3">{row.label}</dt>
              <dd className="text-xs text-ink truncate">{row.value || '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink-2 tracking-tight mb-3">Session</h2>
        <div className="rounded-xl border border-line bg-surface flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-xs text-ink">Sign out</p>
            <p className="text-xs text-ink-3">End your session on this device.</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-line-strong hover:bg-raised text-ink font-medium text-xs rounded-lg transition-all cursor-pointer"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

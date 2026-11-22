'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Shield, User, Users } from 'lucide-react';
import { adminService } from '@/lib/api';
import type { AdminUserPage, AdminUserRow } from '@/lib/api/types';
import { formatRelative, parseDate } from '@/lib/dates';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-2';

function Avatar({ user }: { user: AdminUserRow }) {
  const [failed, setFailed] = useState(false);
  if (user.picture && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.picture}
        alt=""
        width={28}
        height={28}
        className="rounded-full flex-shrink-0"
        onError={() => setFailed(true)}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-raised flex items-center justify-center flex-shrink-0">
      <User size={13} className="text-ink-2" />
    </div>
  );
}

export default function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<AdminUserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wait for typing to pause before searching.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(query.trim()); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    adminService.users({ search, skip: page * PAGE_SIZE, limit: PAGE_SIZE })
      .then(res => { if (isMounted) { setData(res); setError(null); } })
      .catch(err => { if (isMounted) setError(err?.message || 'Failed to load users'); })
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [search, page]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center gap-2 text-ink-3 text-xs mb-3">
        <Users size={12} />
        Admin
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight mb-1">Users</h1>
          <p className="text-xs text-ink-3">
            {data ? `${total.toLocaleString()} ${search ? 'matching' : 'signed up'}` : 'Loading…'}
          </p>
        </div>
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search users</span>
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or email"
            className={cn(
              'w-full pl-8 pr-3 py-2 rounded-lg bg-surface border border-line text-sm text-ink placeholder:text-ink-3',
              focusRing,
            )}
          />
        </label>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 mb-6">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface overflow-x-auto">
        <table className={cn('w-full text-sm transition-opacity', loading && data && 'opacity-60')}>
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="font-medium px-4 py-3">User</th>
              <th className="font-medium px-4 py-3 text-right">Projects</th>
              <th className="font-medium px-4 py-3 text-right">Lessons passed</th>
              <th className="font-medium px-4 py-3">Last active</th>
              <th className="font-medium px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!data && [...Array(6)].map((_, i) => (
              <tr key={i}>
                <td colSpan={5} className="px-4 py-3"><div className="h-7 rounded bg-raised/50 animate-pulse" /></td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-ink-3">
                  {search ? `No users match “${search}”.` : 'No users yet.'}
                </td>
              </tr>
            )}
            {data?.items.map(user => (
              <tr key={user.id} className="hover:bg-raised/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar user={user} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-ink font-medium truncate">
                        {user.name}
                        {user.is_admin && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-2 px-1.5 py-px rounded-md border border-line-strong">
                            <Shield size={10} />
                            Admin
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-3 truncate">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-2">{user.projects}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-2">{user.lessons_passed}</td>
                <td className="px-4 py-3 text-xs text-ink-3 whitespace-nowrap">
                  {user.last_active_at ? formatRelative(user.last_active_at) : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-ink-3 whitespace-nowrap">
                  {parseDate(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-xs text-ink-3">
          <span className="tabular-nums">{from}–{to} of {total.toLocaleString()}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0 || loading}
              aria-label="Previous page"
              className={cn('p-1.5 rounded-lg hover:bg-raised hover:text-ink disabled:opacity-40 disabled:pointer-events-none cursor-pointer', focusRing)}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= pages - 1 || loading}
              aria-label="Next page"
              className={cn('p-1.5 rounded-lg hover:bg-raised hover:text-ink disabled:opacity-40 disabled:pointer-events-none cursor-pointer', focusRing)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

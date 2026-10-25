'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CheckCircle2, CircleDot, FolderPlus, Layers, User, UserRound } from 'lucide-react';
import { userService } from '@/lib/api';
import type { ActivityEvent, UserActivity, UserProfile } from '@/lib/api/types';
import { formatRelative, parseDate } from '@/lib/dates';

const EVENT_META: Record<ActivityEvent['kind'], { Icon: typeof FolderPlus; label: string; className: string }> = {
  project_created: { Icon: FolderPlus, label: 'Created project', className: 'text-white/60' },
  mission_started: { Icon: CircleDot, label: 'Started lesson', className: 'text-amber-300/80' },
  mission_passed: { Icon: CheckCircle2, label: 'Completed lesson', className: 'text-green-400' },
};

export default function ProfilePage() {
  const { data: session } = useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    Promise.all([userService.me(), userService.activity()])
      .then(([me, data]) => {
        if (!isMounted) return;
        setProfile(me);
        setActivity(data);
      })
      .catch(err => { if (isMounted) setError(err?.message || 'Failed to load your activity'); });
    return () => { isMounted = false; };
  }, []);

  const name = profile?.name ?? session?.user?.name;
  const email = profile?.email ?? session?.user?.email;
  const picture = profile?.picture ?? session?.user?.image;
  const tracks = activity?.categories.filter(c => c.kind === 'track') ?? [];
  const platforms = activity?.categories.filter(c => c.kind === 'platform') ?? [];

  const stats = activity && [
    { label: 'Projects', value: activity.projects.total, detail: 'built from scratch' },
    { label: 'Lessons', value: activity.lessons.passed, detail: `of ${activity.lessons.total} completed` },
    { label: 'Categories', value: activity.categories.length, detail: 'tracks and platforms' },
    { label: 'Checks run', value: activity.lessons.attempts, detail: `${activity.lessons.in_progress} lesson${activity.lessons.in_progress === 1 ? '' : 's'} in progress` },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 text-white/40 font-mono text-[10px] uppercase tracking-wider mb-3">
        <UserRound size={12} />
        Profile
      </div>
      <div className="flex items-center gap-4 mb-10">
        {picture && !imageError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={picture}
            alt={name ?? 'User'}
            width={56}
            height={56}
            className="rounded-full"
            onError={() => setImageError(true)}
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
            <User size={22} className="text-white/80" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-white tracking-tight truncate">{name}</h1>
          <p className="text-xs text-white/40 font-mono mt-1 truncate">
            {email}
            {profile && ` · joined ${parseDate(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 mb-6">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}

      <h2 className="text-sm font-semibold text-white/60 tracking-tight mb-3">Activities</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.08] mb-10">
        {stats
          ? stats.map(stat => (
              <div key={stat.label} className="bg-black p-5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-3">{stat.label}</p>
                <p className="text-3xl font-bold text-white tabular-nums tracking-tight">{stat.value}</p>
                <p className="text-[11px] text-white/35 mt-1">{stat.detail}</p>
              </div>
            ))
          : [...Array(4)].map((_, i) => <div key={i} className="h-[7.5rem] bg-black animate-pulse" />)}
      </div>

      {activity && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 2xl:gap-10">
          <section>
            <h2 className="text-sm font-semibold text-white/60 tracking-tight mb-3">Categories tackled</h2>
            <div className="rounded-xl border border-white/[0.08] bg-black divide-y divide-white/[0.06]">
              {activity.categories.length === 0 && (
                <p className="p-5 text-xs text-white/35">Create a project or complete a lesson to unlock categories.</p>
              )}
              {tracks.map(track => (
                <div key={`track-${track.name}`} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-white">{track.name}</span>
                    <span className="font-mono text-[11px] text-white/50 tabular-nums">
                      {track.count} / {track.total} lessons
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full bg-white"
                      style={{ width: `${track.total ? (track.count / track.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
              {platforms.map(platform => (
                <div key={`platform-${platform.name}`} className="p-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-white">
                    <Layers size={12} className="text-white/40" />
                    {platform.name}
                  </span>
                  <span className="font-mono text-[11px] text-white/50 tabular-nums">
                    {platform.count} project{platform.count === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>

            {activity.concepts.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-white/60 tracking-tight mt-8 mb-3">Concepts learned</h2>
                <div className="flex flex-wrap gap-1.5">
                  {activity.concepts.map(concept => (
                    <span key={concept} className="font-mono text-[10px] text-white/60 px-2 py-0.5 rounded-md border border-white/[0.12]">
                      {concept}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-white/60 tracking-tight mb-3">Recent activity</h2>
            <div className="rounded-xl border border-white/[0.08] bg-black">
              {activity.events.length === 0 ? (
                <p className="p-5 text-xs text-white/35">Nothing yet. Your projects and lessons will show up here.</p>
              ) : (
                <ol className="divide-y divide-white/[0.06]">
                  {activity.events.map(event => {
                    const { Icon, label, className } = EVENT_META[event.kind];
                    return (
                      <li key={`${event.kind}-${event.project_id ?? event.mission_id}-${event.at}`} className="flex items-center gap-3 px-4 py-3">
                        <Icon size={13} className={`flex-shrink-0 ${className}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-white truncate">{event.title}</p>
                          <p className="text-[11px] text-white/35">{label}</p>
                        </div>
                        <span className="font-mono text-[10px] text-white/30 flex-shrink-0">{formatRelative(event.at)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

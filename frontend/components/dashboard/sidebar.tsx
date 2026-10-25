'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { FolderKanban, GraduationCap, Settings, User, UserRound } from 'lucide-react';
import { userService } from '@/lib/api';
import { loadMissionProgress, MISSIONS as BLOCKS_MISSIONS } from '@/lib/blocks/missions';
import { cn } from '@/lib/utils';

const sections = [
  { label: 'Projects', href: '/dashboard', Icon: FolderKanban },
  { label: 'Learn', href: '/dashboard/learn', Icon: GraduationCap },
  { label: 'Profile', href: '/dashboard/profile', Icon: UserRound },
  { label: 'Settings', href: '/dashboard/settings', Icon: Settings },
];

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [imageError, setImageError] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});

  useEffect(() => {
    let isMounted = true;
    userService.activity()
      .then(activity => {
        if (!isMounted) return;
        const progress = loadMissionProgress();
        const blocksPassed = BLOCKS_MISSIONS.filter(m => progress[m.id] === 'passed').length;
        setCounts({
          '/dashboard': String(activity.projects.total),
          '/dashboard/learn': `${activity.lessons.passed + blocksPassed}/${activity.lessons.total + BLOCKS_MISSIONS.length}`,
        });
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [pathname]);

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="lg:sticky lg:top-28 lg:self-start">
      {session?.user && (
        <div className="hidden lg:flex items-center gap-2.5 px-2 pb-5 mb-4 border-b border-white/[0.08]">
          {session.user.image && !imageError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt={session.user.name ?? 'User'}
              width={30}
              height={30}
              className="rounded-full flex-shrink-0"
              onError={() => setImageError(true)}
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-[30px] h-[30px] rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
              <User size={14} className="text-white/80" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-white truncate leading-4">{session.user.name}</p>
            <p className="text-[11px] text-white/45 truncate font-mono mt-0.5">{session.user.email}</p>
          </div>
        </div>
      )}

      <nav className="flex lg:flex-col gap-0.5 overflow-x-auto rounded-xl lg:rounded-none border border-white/[0.08] lg:border-0 bg-black/60 lg:bg-transparent p-1 lg:p-0">
        {sections.map(({ label, href, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 lg:flex-none items-center justify-center lg:justify-start gap-3 px-2.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
                active
                  ? 'bg-white/[0.08] text-white'
                  : 'text-white/55 hover:text-white hover:bg-white/[0.04]',
              )}
            >
              <Icon size={15} className={active ? 'text-white' : 'text-white/45'} />
              <span className="lg:flex-1">{label}</span>
              {counts[href] && (
                <span className="hidden lg:inline font-mono text-[11px] text-white/45 tabular-nums">{counts[href]}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

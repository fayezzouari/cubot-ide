'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { FolderKanban, GraduationCap, LayoutDashboard, LogOut, Settings, User, UserRound, Users } from 'lucide-react';
import { userService } from '@/lib/api';
import { loadMissionProgress, MISSIONS as BLOCKS_MISSIONS } from '@/lib/blocks/missions';
import { cn } from '@/lib/utils';

const sections = [
  { label: 'Projects', href: '/dashboard', Icon: FolderKanban },
  { label: 'Learn', href: '/dashboard/learn', Icon: GraduationCap },
  { label: 'Profile', href: '/dashboard/profile', Icon: UserRound },
  { label: 'Settings', href: '/dashboard/settings', Icon: Settings },
];

const adminSections = [
  { label: 'Overview', href: '/dashboard/admin', Icon: LayoutDashboard },
  { label: 'Users', href: '/dashboard/admin/users', Icon: Users },
];

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-2';

function SignOutButton({ className }: { className?: string }) {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/' })}
      aria-label="Log out"
      title="Log out"
      className={cn('p-2 rounded-lg text-ink-3 hover:text-ink hover:bg-raised transition-colors cursor-pointer', focusRing, className)}
    >
      <LogOut size={15} />
    </button>
  );
}

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [imageError, setImageError] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let isMounted = true;
    userService.me()
      .then(me => { if (isMounted) setIsAdmin(me.is_admin); })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

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
    href === '/dashboard' || href === '/dashboard/admin'
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  const renderLink = ({ label, href, Icon }: (typeof sections)[number]) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex flex-1 lg:flex-none items-center justify-center lg:justify-start gap-3 px-2.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
          focusRing,
          active ? 'bg-raised text-ink' : 'text-ink-2 hover:text-ink hover:bg-surface',
        )}
      >
        <Icon size={15} className={active ? 'text-ink' : 'text-ink-3'} />
        <span className="lg:flex-1">{label}</span>
        {counts[href] && (
          <span className="hidden lg:inline text-xs text-ink-3 tabular-nums">{counts[href]}</span>
        )}
      </Link>
    );
  };

  return (
    <aside className="flex flex-col px-6 lg:px-4 pt-6 pb-4 lg:pt-8 lg:pb-6 bg-well border-b lg:border-b-0 lg:border-r border-line lg:sticky lg:top-0 lg:h-screen">
      <div className="flex items-center justify-between mb-5 lg:mb-8 lg:px-2">
        <Link href="/" className={cn('flex items-center gap-2.5 rounded-lg', focusRing)}>
          <img src="/cubot.svg" alt="" className="w-8 h-8 object-contain" />
          <span className="text-base font-semibold text-ink tracking-tight">CuBot</span>
        </Link>
        <SignOutButton className="lg:hidden" />
      </div>

      <nav className="flex lg:flex-col gap-1 overflow-x-auto rounded-xl lg:rounded-none border border-line lg:border-0 bg-surface lg:bg-transparent p-1 lg:p-0">
        {sections.map(renderLink)}
        {isAdmin && (
          <>
            <p className="hidden lg:block px-2.5 pt-5 pb-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">
              Admin
            </p>
            <span className="lg:hidden w-px my-1.5 bg-line flex-shrink-0" aria-hidden />
            {adminSections.map(renderLink)}
          </>
        )}
      </nav>

      {session?.user && (
        <div className="hidden lg:flex items-center gap-2.5 mt-auto pt-4 pl-2 border-t border-line">
          {session.user.image && !imageError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt=""
              width={28}
              height={28}
              className="rounded-full flex-shrink-0"
              onError={() => setImageError(true)}
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-raised flex items-center justify-center flex-shrink-0">
              <User size={14} className="text-ink-2" />
            </div>
          )}
          <p className="flex-1 min-w-0 text-sm font-medium text-ink truncate">{session.user.name}</p>
          <SignOutButton />
        </div>
      )}
    </aside>
  );
}

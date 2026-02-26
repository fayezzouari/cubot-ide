'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, LogOut, User } from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';

const navLinks = [
  { label: 'Platform', href: '#about' },
  { label: 'Features', href: '#features' },
  { label: 'Docs', href: '#' },
];

export default function Header() {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const { data: session, status } = useSession();
  const [imageError, setImageError] = useState(false);

  return (
    <header className="fixed top-4 left-0 right-0 z-50 flex justify-center px-6">
      <nav className="w-full max-w-3xl flex items-center justify-between gap-6 h-11 px-4 rounded-xl bg-black/80 backdrop-blur-xl border border-white/[0.08] shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_8px_32px_rgba(0,0,0,0.6)]">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0 group">
          <img src="/cubot.svg" alt="CuBot" className="w-8 h-8 object-contain" />
          <span className="text-sm font-semibold text-white tracking-tight">CuBot</span>
        </Link>

        {/* Nav links */}
        {isLanding && (
          <div className="hidden md:flex items-center gap-0.5">
            {navLinks.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white hover:bg-white/[0.06] rounded-lg transition-all"
              >
                {label}
              </a>
            ))}
            <span className="mx-2 h-3.5 w-px bg-white/10" />
            <a
              href="https://github.com/fayezzouari/cubot-ide"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white hover:bg-white/[0.06] rounded-lg transition-all flex items-center gap-1.5"
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              GitHub
            </a>
          </div>
        )}

        {/* CTA */}
        {status === 'authenticated' ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            {pathname !== '/dashboard' && (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs rounded-lg transition-all group"
              >
                Dashboard
                <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
            )}
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="p-1.5 text-white/30 hover:text-white/70 hover:bg-white/[0.06] rounded-lg transition-all cursor-pointer"
              title="Sign out"
            >
              <LogOut size={13} />
            </button>
            {session.user?.image && !imageError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={session.user.name ?? 'User'}
                width={24}
                height={24}
                className="rounded-full"
                onError={() => setImageError(true)}
                crossOrigin="anonymous"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                <User size={14} className="text-primary" />
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs rounded-lg transition-all group flex-shrink-0"
          >
            Login
            <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
        )}

      </nav>
    </header>
  );
}

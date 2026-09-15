'use client';

import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import HostingNotice from '@/components/hosting-notice';

export default function LoginPage() {
  const handleGoogleSignIn = () => {
    signIn('google', { callbackUrl: '/dashboard' });
  };

  return (
    <main className="min-h-screen bg-black text-foreground font-sans flex items-center justify-center px-6">
            {/* Dot grid */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }}
      />
      {/* Subtle dot grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 3px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Header */}
        <div className="mb-12">
          <Link href="/" className="flex items-center gap-2 mb-8">
            <img src="/cubot.svg" alt="CuBot" className="w-8 h-8 object-contain" />
            <span className="text-sm font-semibold text-white tracking-tight">CuBot</span>
          </Link>
          <h1 className="text-3xl font-semibold text-white tracking-tight mb-2">Login</h1>
          <p className="text-sm text-white/40">Sign in to access your projects and workspace</p>
        </div>

        <HostingNotice />

        {/* Login Card */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
          <button
            onClick={handleGoogleSignIn}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm rounded-lg transition-all group cursor-pointer "
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
            <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </button>

          <p className="text-xs text-white/30 text-center mt-6">
            By signing in, you agree to our terms of service
          </p>
        </div>

        {/* Footer link */}
        <p className="text-xs text-white/25 text-center mt-8">
          Don&apos;t have an account?{' '}
          <Link href="/" className="text-white/40 hover:text-white transition-colors">
            Learn more
          </Link>
        </p>
      </div>
    </main>
  );
}

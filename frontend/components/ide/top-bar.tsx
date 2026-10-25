'use client';

import Link from 'next/link';
import { Play, ArrowLeft, TerminalSquare, Cpu, Usb } from 'lucide-react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';

interface TopBarProps {
  projectId: string | null;
  isArduinoProject: boolean;
  projectType: string | null;
  backHref: string;
  backLabel: string;
  onOpenCompile: () => void;
  onOpenSerial: () => void;
  onOpenUpload: () => void;
}

export default function TopBar({
  projectId,
  isArduinoProject,
  projectType,
  backHref,
  backLabel,
  onOpenCompile,
  onOpenSerial,
  onOpenUpload,
}: TopBarProps) {
  const { data: session, status } = useSession();
  
  return (
    <header className="h-11 border-b border-white/[0.06] flex items-center justify-between px-4 bg-[#0e0e0e] flex-shrink-0">
      {/* Left: Logo */}
      <div className="flex items-center gap-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 text-xs text-white/50 hover:text-white hover:bg-white/[0.06] rounded-lg transition-all"
        >
          <ArrowLeft size={13} />
          {backLabel}
        </Link>

        <span className="w-px h-4 bg-white/[0.08]" />

        <div className="flex items-center gap-2">
          <img src="/cubot.svg" alt="CuBot" className="w-6 h-6 object-contain" />
          <span className="text-sm font-semibold text-white/80">CuBot</span>
        </div>

        <span className="text-white/[0.12]">·</span>

        <span className="text-xs text-white/30 font-mono">IDE</span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1.5">
  

        {isArduinoProject && projectType !== 'ros' && (
          <>
            <button
              onClick={onOpenCompile}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-white/90 text-black font-medium text-xs rounded-lg transition-all cursor-pointer"
            >
              <Play size={11} />
              Compile
            </button>
            <button
              onClick={onOpenUpload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-blue-500 text-black font-medium text-xs rounded-lg transition-all cursor-pointer"
            >
              <Usb size={11} />
              Connect
            </button>
            <button
              onClick={onOpenSerial}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] text-white/50 hover:text-white font-medium text-xs rounded-lg transition-all cursor-pointer"
            >
              <TerminalSquare size={11} />
              Serial
            </button>

            {projectId && (
              <Link
                href={`/simulator?project=${projectId}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] text-white/50 hover:text-white font-medium text-xs rounded-lg transition-all"
              >
                <Cpu size={11} />
                Simulate
              </Link>
            )}
          </>
        )}

        <span className="w-px h-4 bg-white/[0.08] mx-1" />

        <>
          {status === 'authenticated' && (
            <>
              {session?.user?.image && (
                <Image
                  src={session.user.image}
                  alt={session.user.name ?? 'User'}
                  width={24}
                  height={24}
                  className="rounded-full"
                  referrerPolicy="no-referrer"
                />
              )}
            </>
          )}
        </>
      </div>
    </header>
  );
}

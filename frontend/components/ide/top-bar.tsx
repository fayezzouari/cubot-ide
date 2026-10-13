'use client';

import Link from 'next/link';
import { Play, Home, TerminalSquare, Cpu, Usb } from 'lucide-react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { PRODUCT_NAME } from '@/lib/branding';

interface TopBarProps {
  projectId: string | null;
  projectName?: string | null;
  isArduinoProject: boolean;
  projectType: string | null;
  onOpenCompile: () => void;
  onOpenSerial: () => void;
  onOpenUpload: () => void;
}

const ghostButton =
  'inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] text-white/55 hover:text-white font-medium text-xs rounded-lg transition-all cursor-pointer';

export default function TopBar({
  projectId,
  projectName,
  isArduinoProject,
  projectType,
  onOpenCompile,
  onOpenSerial,
  onOpenUpload,
}: TopBarProps) {
  const { data: session, status } = useSession();

  return (
    <header className="h-11 border-b border-white/[0.06] flex items-center justify-between px-4 bg-black flex-shrink-0">
      {/* Left: brand and project */}
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/" className="flex items-center gap-2 group flex-shrink-0">
          <img src="/cubot.svg" alt={PRODUCT_NAME} className="w-6 h-6 object-contain" />
          <span className="text-sm font-semibold text-white/85 group-hover:text-white transition-colors">{PRODUCT_NAME}</span>
        </Link>
        <span className="text-white/[0.12]">/</span>
        <span className="text-xs text-white/35 font-mono flex-shrink-0">IDE</span>
        {projectName && (
          <>
            <span className="text-white/[0.12]">/</span>
            <span className="text-xs text-white/60 truncate" title={projectName}>{projectName}</span>
          </>
        )}
      </div>

      {/* Right: actions */}
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
            <button onClick={onOpenUpload} className={ghostButton}>
              <Usb size={11} />
              Connect
            </button>
            <button onClick={onOpenSerial} className={ghostButton}>
              <TerminalSquare size={11} />
              Serial
            </button>
            {projectId && (
              <Link href={`/simulator?project=${projectId}`} className={ghostButton}>
                <Cpu size={11} />
                Simulate
              </Link>
            )}
          </>
        )}

        <span className="w-px h-4 bg-white/[0.08] mx-1" />

        <Link
          href="/dashboard"
          className="w-7 h-7 flex items-center justify-center text-white/35 hover:text-white/80 hover:bg-white/[0.06] rounded-lg transition-all"
          title="Back to Dashboard"
        >
          <Home size={13} />
        </Link>
        {status === 'authenticated' && session?.user?.image && (
          <Image
            src={session.user.image}
            alt={session.user.name ?? 'User'}
            width={24}
            height={24}
            className="rounded-full"
          />
        )}
      </div>
    </header>
  );
}

'use client';

import Link from 'next/link';
import { Play, Settings, Home, TerminalSquare, Cpu, Usb } from 'lucide-react';

interface TopBarProps {
  projectId: string | null;
  isArduinoProject: boolean;
  projectType: string | null;
  onOpenCompile: () => void;
  onOpenSerial: () => void;
  onOpenUpload: () => void;
}

export default function TopBar({
  projectId,
  isArduinoProject,
  projectType,
  onOpenCompile,
  onOpenSerial,
  onOpenUpload,
}: TopBarProps) {
  return (
    <header className="h-11 border-b border-white/[0.06] flex items-center justify-between px-4 bg-black flex-shrink-0">
      {/* Left: Logo */}
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-6 h-6 bg-white rounded-md flex items-center justify-center">
            <Cpu size={12} className="text-black" />
          </div>
          <span className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">cubot</span>
        </Link>

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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded-lg transition-all cursor-pointer"
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

        <button className="w-7 h-7 flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] rounded-lg transition-all cursor-pointer">
          <Settings size={13} />
        </button>
        <Link
          href="/"
          className="w-7 h-7 flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] rounded-lg transition-all"
        >
          <Home size={13} />
        </Link>
      </div>
    </header>
  );
}

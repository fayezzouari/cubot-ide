'use client';

import Link from 'next/link';
import { Play, Settings, Home, TerminalSquare, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TopBarProps {
  projectId: string | null;
  isArduinoProject: boolean;
  onOpenCompile: () => void;
  onOpenSerial: () => void;
}

export default function TopBar({
  projectId,
  isArduinoProject,
  onOpenCompile,
  onOpenSerial,
}: TopBarProps) {
  return (
    <header className="h-14 border-b-4 border-foreground flex items-center justify-between px-4 bg-gradient-to-r from-primary/15 via-background to-primary/10 shadow-sm relative z-10">
      <div className="flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary border-2 border-foreground flex items-center justify-center">
            <span className="text-primary-foreground font-black text-sm">⚙</span>
          </div>
          <span className="font-serif text-xl font-black">CUBOT IDE</span>
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="border-2 border-foreground font-black"
          onClick={onOpenCompile}
        >
          <Play size={14} />
          COMPILE
        </Button>
        {isArduinoProject && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="border-2 border-foreground font-black"
              onClick={onOpenSerial}
            >
              <TerminalSquare size={14} />
              SERIAL MONITOR
            </Button>
            {projectId && (
              <Link href={`/simulator?project=${projectId}`}>
                <Button variant="outline" size="sm" className="border-2 border-foreground font-black">
                  <Cpu size={14} />
                  SIMULATE
                </Button>
              </Link>
            )}
          </>
        )}
        <Button variant="ghost" size="icon">
          <Settings size={18} />
        </Button>
        <Link href="/">
          <Button variant="ghost" size="icon">
            <Home size={18} />
          </Button>
        </Link>
      </div>
    </header>
  );
}

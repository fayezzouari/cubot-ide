'use client';

import Link from 'next/link';
import { Play, Settings, Home, TerminalSquare, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TopBarProps {
  projectId: string | null;
  isArduinoProject: boolean;
  projectType: string | null;
  onOpenCompile: () => void;
  onOpenSerial: () => void;
}

export default function TopBar({
  projectId,
  isArduinoProject,
  projectType,
  onOpenCompile,
  onOpenSerial,
}: TopBarProps) {
  return (
    <header className="h-12 border-b border-border flex items-center justify-between px-4 bg-card">
      <div className="flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 bg-primary rounded flex items-center justify-center">
            <span className="text-primary-foreground font-semibold text-sm">⚙</span>
          </div>
          <span className="font-semibold text-base">Cubot IDE</span>
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          className="h-8 px-3 font-medium"
          onClick={onOpenCompile}
        >
          <Play size={14} className="mr-1.5" />
          Compile
        </Button>
        {isArduinoProject && projectType !== 'ros' && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 font-medium"
              onClick={onOpenSerial}
            >
              <TerminalSquare size={14} className="mr-1.5" />
              Serial Monitor
            </Button>
            {projectId && (
              <Link href={`/simulator?project=${projectId}`}>
                <Button variant="outline" size="sm" className="h-8 px-3 font-medium">
                  <Cpu size={14} className="mr-1.5" />
                  Simulate
                </Button>
              </Link>
            )}
          </>
        )}
        <div className="w-px h-6 bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Settings size={16} />
        </Button>
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Home size={16} />
          </Button>
        </Link>
      </div>
    </header>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Play,
  Square,
  Home,
  Cpu,
  Lightbulb,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { compileService } from '@/lib/api';
import { CompilerType } from '@/lib/api/types';
import { useProject } from '@/contexts/project-context';

const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';

export default function SimulatorPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('project');
  const { currentProject, loadProject, isLoading: projectLoading } = useProject();

  const [isRunning, setIsRunning] = useState(false);
  const [serialOutput, setSerialOutput] = useState('');
  const [ledStates, setLedStates] = useState<Record<number, boolean>>({
    13: false, // Built-in LED
  });
  const [compileStatus, setCompileStatus] = useState<'idle' | 'compiling' | 'ready' | 'error'>('idle');
  const [compileError, setCompileError] = useState('');
  const [hexData, setHexData] = useState<string | null>(null);
  const [simState, setSimState] = useState<string>('idle');

  const wsRef = useRef<WebSocket | null>(null);

  // Load project
  useEffect(() => {
    if (projectId && !currentProject) {
      loadProject(projectId);
    }
  }, [projectId, currentProject, loadProject]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const connectWebSocket = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      const ws = new WebSocket(`${WS_BASE_URL}/ws/simulate`);
      wsRef.current = ws;

      ws.onopen = () => resolve(ws);
      ws.onerror = (e) => reject(new Error('WebSocket connection failed'));

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'serial':
              setSerialOutput((prev) => prev + msg.data);
              break;
            case 'pin':
              setLedStates((prev) => ({ ...prev, [msg.pin]: msg.value }));
              break;
            case 'state':
              setSimState(msg.state);
              if (msg.state === 'running') {
                setIsRunning(true);
              } else if (msg.state === 'stopped' || msg.state === 'error') {
                setIsRunning(false);
              }
              break;
            case 'error':
              setCompileError(msg.message || 'Simulation error');
              setIsRunning(false);
              break;
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        setIsRunning(false);
        wsRef.current = null;
      };
    });
  }, []);

  const handleCompile = useCallback(async () => {
    if (!currentProject || currentProject.files.length === 0) {
      setCompileError('No files to compile');
      setCompileStatus('error');
      return;
    }

    setCompileStatus('compiling');
    setCompileError('');

    try {
      const mainFile = currentProject.files.find(
        (f) => f.name.endsWith('.ino') || f.name.endsWith('.cpp') || f.name === 'main.c'
      );

      if (!mainFile) {
        throw new Error('No main file found (.ino, .cpp, or main.c)');
      }

      const result = await compileService.compile({
        project_id: currentProject.id,
        main_file: mainFile.path,
        file_ids: currentProject.files.map((f) => f.id),
        compiler: 'arduino' as CompilerType,
      });

      if (result.success && result.hex_output) {
        setHexData(result.hex_output);
        setCompileStatus('ready');
      } else {
        throw new Error(result.errors?.join('\n') || 'Compilation failed');
      }
    } catch (err: any) {
      setCompileError(err.message || 'Compilation failed');
      setCompileStatus('error');
    }
  }, [currentProject]);

  const handleStart = useCallback(async () => {
    if (!hexData) {
      setCompileError('No compiled program. Click Compile first.');
      return;
    }

    try {
      const ws = await connectWebSocket();
      ws.send(JSON.stringify({ type: 'start', hex: hexData }));
    } catch (err: any) {
      setCompileError(err.message || 'Failed to connect to simulation server');
    }
  }, [hexData, connectWebSocket]);

  const handleStop = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
    setIsRunning(false);
  }, []);

  const handleReset = useCallback(() => {
    handleStop();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setSerialOutput('');
    setLedStates({ 13: false });
    setSimState('idle');
  }, [handleStop]);

  if (projectLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-foreground font-bold">Loading project...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="h-14 border-b-4 border-foreground flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary border-2 border-foreground flex items-center justify-center">
              <span className="text-primary-foreground font-black text-sm">⚙</span>
            </div>
            <span className="font-serif text-xl font-black">CUBOT SIMULATOR</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-2 border-foreground font-black"
            onClick={handleCompile}
            disabled={compileStatus === 'compiling'}
          >
            <Cpu size={14} />
            {compileStatus === 'compiling' ? 'COMPILING...' : 'COMPILE'}
          </Button>
          {!isRunning ? (
            <Button
              variant="outline"
              size="sm"
              className="border-2 border-foreground font-black"
              onClick={handleStart}
              disabled={compileStatus !== 'ready'}
            >
              <Play size={14} />
              RUN
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="border-2 border-foreground font-black"
              onClick={handleStop}
            >
              <Square size={14} />
              STOP
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-2 border-foreground font-black"
            onClick={handleReset}
          >
            <RotateCcw size={14} />
            RESET
          </Button>
          <Link href={`/ide?project=${projectId}`}>
            <Button variant="ghost" size="icon">
              <Home size={18} />
            </Button>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Arduino Board Visualization */}
        <div className="w-1/2 border-r-4 border-foreground p-6">
          <h2 className="text-xl font-black mb-4">ARDUINO UNO</h2>

          {/* Simple board representation */}
          <div className="bg-blue-900 border-4 border-foreground rounded-lg p-6 max-w-md">
            <div className="flex justify-between mb-4">
              <span className="text-white font-bold text-xs">DIGITAL PINS</span>
            </div>

            {/* Pin row */}
            <div className="flex gap-1 mb-6">
              {[13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((pin) => (
                <div
                  key={pin}
                  className={`w-6 h-6 rounded border-2 border-white flex items-center justify-center text-xs font-bold ${
                    ledStates[pin] ? 'bg-yellow-400 text-black' : 'bg-gray-700 text-white'
                  }`}
                  title={`Pin ${pin}`}
                >
                  {pin}
                </div>
              ))}
            </div>

            {/* Built-in LED indicator */}
            <div className="flex items-center gap-3 mt-4">
              <Lightbulb
                size={32}
                className={ledStates[13] ? 'text-yellow-400' : 'text-gray-500'}
                fill={ledStates[13] ? '#facc15' : 'none'}
              />
              <span className="text-white font-bold">
                LED (Pin 13): {ledStates[13] ? 'ON' : 'OFF'}
              </span>
            </div>

            {/* Status */}
            <div className="mt-6 p-2 bg-black/30 rounded">
              <span className="text-green-400 font-mono text-xs">
                {isRunning ? '● Running' : '○ Stopped'}
              </span>
            </div>
          </div>

          {/* Compile status */}
          {compileStatus === 'error' && (
            <div className="mt-4 p-3 bg-destructive/10 border-2 border-destructive rounded">
              <span className="text-destructive font-bold text-sm">{compileError}</span>
            </div>
          )}

          {compileStatus === 'ready' && (
            <div className="mt-4 p-3 bg-green-500/10 border-2 border-green-500 rounded">
              <span className="text-green-600 font-bold text-sm">
                ✓ Compiled successfully. Click RUN to start simulation.
              </span>
            </div>
          )}
        </div>

        {/* Serial Monitor */}
        <div className="w-1/2 flex flex-col">
          <div className="h-10 border-b-2 border-foreground flex items-center px-4">
            <span className="font-black text-sm">SERIAL MONITOR</span>
          </div>
          <ScrollArea className="flex-1 p-4">
            <pre className="font-mono text-sm whitespace-pre-wrap">
              {serialOutput || 'No serial output yet.'}
            </pre>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

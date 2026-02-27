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
  Plus,
  Trash2,
  Thermometer,
  Droplets,
  Sun,
  Wind,
  Flame,
  CloudRain,
  Snowflake,
  X,
  Link2,
  Unlink,
  FlaskConical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { compileService, wiringService } from '@/lib/api';
import { CompilerType, WiringGuideDTO } from '@/lib/api/types';
import { useProject } from '@/contexts/project-context';
import WiringDiagram from '@/components/wiring-diagram';

const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';

const SENSOR_OPTIONS = [
  { type: 'Temperature', unit: '°C', min: -20, max: 80, defaultValue: 25, defaultPin: 'A0', icon: 'thermometer' },
  { type: 'Humidity', unit: '%', min: 0, max: 100, defaultValue: 45, defaultPin: 'A1', icon: 'droplets' },
  { type: 'Light (LDR)', unit: '%', min: 0, max: 100, defaultValue: 60, defaultPin: 'A2', icon: 'sun' },
  { type: 'Distance (Ultrasonic)', unit: 'cm', min: 2, max: 400, defaultValue: 50, defaultPin: 'A3', icon: 'wind' },
  { type: 'Sound', unit: '%', min: 0, max: 100, defaultValue: 30, defaultPin: 'A4', icon: 'wind' },
  { type: 'Gas', unit: '%', min: 0, max: 100, defaultValue: 10, defaultPin: 'A5', icon: 'flask' },
  { type: 'Pressure', unit: 'kPa', min: 80, max: 120, defaultValue: 101, defaultPin: 'A0', icon: 'wind' },
  { type: 'Soil Moisture', unit: '%', min: 0, max: 100, defaultValue: 40, defaultPin: 'A1', icon: 'droplets' },
  { type: 'Potentiometer', unit: '%', min: 0, max: 100, defaultValue: 50, defaultPin: 'A2', icon: 'sun' },
  { type: 'Motion (PIR)', unit: 'state', min: 0, max: 1, defaultValue: 0, defaultPin: 'D2', icon: 'wind' },
];

type EnvironmentPreset = {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Mapping from sensor type → value to set when this environment is active */
  sensorValues: Record<string, number>;
};

const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    id: 'kitchen-fire',
    name: 'Kitchen Fire',
    icon: 'flame',
    description: 'High temp, gas leak, smoke detected',
    sensorValues: { Temperature: 72, Humidity: 15, Gas: 85, 'Light (LDR)': 90, Sound: 70 },
  },
  {
    id: 'rainy-day',
    name: 'Rainy Day',
    icon: 'rain',
    description: 'Cool, high humidity, low light',
    sensorValues: { Temperature: 14, Humidity: 92, 'Light (LDR)': 15, 'Soil Moisture': 85, Pressure: 98, Sound: 40 },
  },
  {
    id: 'sunny-day',
    name: 'Sunny Day',
    icon: 'sun',
    description: 'Warm, dry, bright daylight',
    sensorValues: { Temperature: 32, Humidity: 25, 'Light (LDR)': 95, 'Soil Moisture': 20, Pressure: 103 },
  },
  {
    id: 'freezing',
    name: 'Freezing Cold',
    icon: 'snowflake',
    description: 'Below zero, icy conditions',
    sensorValues: { Temperature: -10, Humidity: 70, 'Light (LDR)': 30, 'Soil Moisture': 5, Pressure: 105 },
  },
  {
    id: 'dark-room',
    name: 'Dark Room',
    icon: 'moon',
    description: 'No light, quiet, room temperature',
    sensorValues: { Temperature: 22, Humidity: 50, 'Light (LDR)': 2, Sound: 5, 'Motion (PIR)': 0 },
  },
  {
    id: 'greenhouse',
    name: 'Greenhouse',
    icon: 'flask',
    description: 'Warm, humid, bright, moist soil',
    sensorValues: { Temperature: 35, Humidity: 80, 'Light (LDR)': 75, 'Soil Moisture': 70, Gas: 3 },
  },
];

type SensorConfig = {
  id: string;
  type: string;
  pin: string;
  value: number;
  /** Which environment preset is linked to this sensor (if any) */
  linkedEnv: string | null;
};

type CustomEnvironment = {
  id: string;
  name: string;
  sensorValues: Record<string, number>;
};

export default function SimulatorPageContent() {
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
  const [sensors, setSensors] = useState<SensorConfig[]>([]);
  const [activeEnvironment, setActiveEnvironment] = useState<string | null>(null);
  const [customEnvironments, setCustomEnvironments] = useState<CustomEnvironment[]>([]);
  const [showCreateEnv, setShowCreateEnv] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const [wiringGuide, setWiringGuide] = useState<WiringGuideDTO | null>(null);
  const [isGeneratingWiring, setIsGeneratingWiring] = useState(false);
  const [wiringError, setWiringError] = useState('');

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

  const getSensorOption = useCallback((type: string) => {
    return SENSOR_OPTIONS.find((opt) => opt.type === type) || SENSOR_OPTIONS[0];
  }, []);

  const handleAddSensor = useCallback(() => {
    const option = SENSOR_OPTIONS[0];
    setSensors((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: option.type,
        pin: option.defaultPin,
        value: option.defaultValue,
        linkedEnv: null,
      },
    ]);
  }, []);

  const handleRemoveSensor = useCallback((id: string) => {
    setSensors((prev) => prev.filter((sensor) => sensor.id !== id));
  }, []);

  const handleUpdateSensor = useCallback(
    (id: string, updates: Partial<SensorConfig>) => {
      setSensors((prev) =>
        prev.map((sensor) => (sensor.id === id ? { ...sensor, ...updates } : sensor))
      );
    },
    []
  );

  /** Activate an environment preset and push its values to linked sensors */
  const handleActivateEnvironment = useCallback(
    (envId: string) => {
      const isDeactivating = activeEnvironment === envId;
      setActiveEnvironment(isDeactivating ? null : envId);

      if (isDeactivating) return;

      // Find the preset or custom env
      const preset = ENVIRONMENT_PRESETS.find((e) => e.id === envId);
      const custom = customEnvironments.find((e) => e.id === envId);
      const sensorValues = preset?.sensorValues ?? custom?.sensorValues ?? {};

      setSensors((prev) =>
        prev.map((sensor) => {
          if (sensor.linkedEnv === envId && sensorValues[sensor.type] !== undefined) {
            return { ...sensor, value: sensorValues[sensor.type] };
          }
          return sensor;
        })
      );
    },
    [activeEnvironment, customEnvironments]
  );

  /** Link / unlink a sensor to the currently active environment */
  const handleToggleSensorLink = useCallback(
    (sensorId: string, envId: string) => {
      setSensors((prev) =>
        prev.map((sensor) => {
          if (sensor.id !== sensorId) return sensor;
          const alreadyLinked = sensor.linkedEnv === envId;
          if (alreadyLinked) return { ...sensor, linkedEnv: null };

          // Apply value from environment immediately
          const preset = ENVIRONMENT_PRESETS.find((e) => e.id === envId);
          const custom = customEnvironments.find((e) => e.id === envId);
          const sensorValues = preset?.sensorValues ?? custom?.sensorValues ?? {};
          const envValue = sensorValues[sensor.type];

          return {
            ...sensor,
            linkedEnv: envId,
            ...(envValue !== undefined ? { value: envValue } : {}),
          };
        })
      );
    },
    [customEnvironments]
  );

  /** Create a custom environment from current sensor values */
  const handleCreateCustomEnvironment = useCallback(() => {
    if (!newEnvName.trim()) return;
    const vals: Record<string, number> = {};
    sensors.forEach((s) => {
      vals[s.type] = s.value;
    });
    const env: CustomEnvironment = {
      id: `custom-${Date.now()}`,
      name: newEnvName.trim(),
      sensorValues: vals,
    };
    setCustomEnvironments((prev) => [...prev, env]);
    setNewEnvName('');
    setShowCreateEnv(false);
  }, [newEnvName, sensors]);

  const handleDeleteCustomEnvironment = useCallback((envId: string) => {
    setCustomEnvironments((prev) => prev.filter((e) => e.id !== envId));
    setActiveEnvironment((prev) => (prev === envId ? null : prev));
    setSensors((prev) =>
      prev.map((s) => (s.linkedEnv === envId ? { ...s, linkedEnv: null } : s))
    );
  }, []);

  const getEnvIcon = (iconName: string) => {
    switch (iconName) {
      case 'flame': return <Flame size={14} />;
      case 'rain': return <CloudRain size={14} />;
      case 'sun': return <Sun size={14} />;
      case 'snowflake': return <Snowflake size={14} />;
      case 'moon': return <Sun size={14} />;
      case 'flask': return <FlaskConical size={14} />;
      default: return <Thermometer size={14} />;
    }
  };

  const handleGenerateWiring = useCallback(async (sourceCode: string) => {
    setIsGeneratingWiring(true);
    setWiringError('');
    try {
      const response = await wiringService.generate({
        source_code: sourceCode,
        compiler: 'arduino',
      });
      setWiringGuide(response.guide);
    } catch (err: any) {
      setWiringError(err?.message || 'Failed to generate wiring guide');
      setWiringGuide(null);
    } finally {
      setIsGeneratingWiring(false);
    }
  }, []);

  const handleCompile = useCallback(async () => {
    if (!currentProject || currentProject.files.length === 0) {
      setCompileError('No files to compile');
      setCompileStatus('error');
      return;
    }

    setCompileStatus('compiling');
    setCompileError('');
    setWiringGuide(null);
    setWiringError('');

    try {
      const mainFile = currentProject.files.find(
        (f) => f.name.endsWith('.ino') || f.name.endsWith('.cpp') || f.name === 'main.c'
      );

      if (!mainFile) {
        throw new Error('No main file found (.ino, .cpp, or main.c)');
      }

      const result = await compileService.compile({
        project_id: currentProject.id,
        main_file: mainFile.path || mainFile.name,
        file_ids: currentProject.files.map((f) => f.id),
        compiler: 'arduino' as CompilerType,
      });

      if (result.success && result.hex_output) {
        setHexData(result.hex_output);
        setCompileStatus('ready');
        const sourceCode = currentProject.files
          .map((file) => `// FILE: ${file.path}\n${file.content}`)
          .join('\n\n');
        await handleGenerateWiring(sourceCode);
      } else {
        throw new Error(result.errors?.join('\n') || 'Compilation failed');
      }
    } catch (err: any) {
      setCompileError(err.message || 'Compilation failed');
      setCompileStatus('error');
    }
  }, [currentProject, handleGenerateWiring]);

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
      // Don't set isRunning here - wait for server confirmation via WebSocket message
    }
  }, []);

  const handleReset = useCallback(() => {
    // Send stop command if connected
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
    
    // Close WebSocket connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Reset UI state
    setIsRunning(false);
    setSerialOutput('');
    setLedStates({ 13: false });
    setSimState('idle');
  }, []);

  if (projectLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#080808]">
        <div className="flex items-center gap-3 text-white/40 text-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          Loading project…
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#080808] text-[#ededed] overflow-hidden">

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="h-12 border-b border-white/[0.06] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 bg-blue-500/10 rounded-lg flex items-center justify-center">
              <Cpu size={13} className="text-blue-400" />
            </div>
            <span className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">
              Simulator
            </span>
          </Link>
          {currentProject && (
            <>
              <span className="text-white/20">/</span>
              <span className="text-sm text-white/40 font-mono">{currentProject.name}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Compile */}
          <button
            onClick={handleCompile}
            disabled={compileStatus === 'compiling'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white/70 hover:text-white"
          >
            <Cpu size={12} />
            {compileStatus === 'compiling' ? 'Compiling…' : 'Compile'}
          </button>

          {/* Run / Stop */}
          {!isRunning ? (
            <button
              onClick={handleStart}
              disabled={compileStatus !== 'ready'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/30 text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Play size={12} />
              Run
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 text-red-400 transition-colors"
            >
              <Square size={12} />
              Stop
            </button>
          )}

          {/* Reset */}
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-white/50 hover:text-white"
          >
            <RotateCcw size={12} />
            Reset
          </button>

          <div className="w-px h-5 bg-white/[0.08] mx-1" />

          {/* Back to IDE */}
          <Link
            href={`/ide?project=${projectId}`}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-white/40 hover:text-white transition-colors"
          >
            <Home size={13} />
          </Link>
        </div>
      </header>

      {/* ── Main layout ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── Left panel ──────────────────────────────────────────────── */}
        <div className="w-[420px] shrink-0 border-r border-white/[0.06] flex flex-col min-h-0 overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">

              {/* Board card */}
              <div className="rounded-xl border border-white/[0.06] bg-[#0e0e0e] overflow-hidden">
                {/* Card header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center">
                      <Cpu size={11} className="text-blue-400" />
                    </div>
                    <span className="text-xs font-semibold text-white/80">Arduino Uno</span>
                  </div>
                  {/* Status pill */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    isRunning
                      ? 'bg-green-500/10 border-green-500/20 text-green-400'
                      : simState === 'error'
                        ? 'bg-red-500/10 border-red-500/20 text-red-400'
                        : 'bg-white/[0.04] border-white/[0.08] text-white/30'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full bg-current ${isRunning ? 'animate-pulse' : ''}`} />
                    {isRunning ? 'Running' : simState === 'error' ? 'Error' : 'Idle'}
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* Digital pin row */}
                  <div>
                    <p className="text-[10px] font-medium text-white/30 uppercase tracking-widest mb-2">Digital Pins</p>
                    <div className="flex flex-wrap gap-1">
                      {[13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((pin) => (
                        <div
                          key={pin}
                          title={`Pin ${pin}`}
                          className={`w-7 h-7 rounded-md border flex items-center justify-center text-[10px] font-mono font-semibold transition-all ${
                            ledStates[pin]
                              ? 'bg-yellow-400/20 border-yellow-400/40 text-yellow-300 shadow-[0_0_6px_rgba(250,204,21,0.3)]'
                              : 'bg-white/[0.03] border-white/[0.08] text-white/30'
                          }`}
                        >
                          {pin}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* LED indicator */}
                  <div className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    ledStates[13]
                      ? 'bg-yellow-400/10 border-yellow-400/20'
                      : 'bg-white/[0.02] border-white/[0.06]'
                  }`}>
                    <Lightbulb
                      size={20}
                      className={ledStates[13] ? 'text-yellow-300' : 'text-white/20'}
                      fill={ledStates[13] ? 'currentColor' : 'none'}
                    />
                    <div>
                      <p className="text-xs font-medium text-white/70">Built-in LED</p>
                      <p className="text-[10px] font-mono text-white/30">Pin 13</p>
                    </div>
                    <span className={`ml-auto text-xs font-semibold tabular-nums ${ledStates[13] ? 'text-yellow-300' : 'text-white/20'}`}>
                      {ledStates[13] ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Compile status banner */}
              {compileStatus === 'error' && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-red-950/20 border border-red-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1 shrink-0" />
                  <p className="text-[11px] font-mono text-red-300/80 leading-relaxed">{compileError}</p>
                </div>
              )}
              {compileStatus === 'ready' && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-green-950/20 border border-green-500/20 text-green-400 text-[11px] font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  Compiled — click Run to start simulation
                </div>
              )}

              {/* Environments card */}
              <div className="rounded-xl border border-white/[0.06] bg-[#0e0e0e] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                  <span className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">Environments</span>
                  <button
                    onClick={() => setShowCreateEnv((v) => !v)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-white/50 hover:text-white transition-colors"
                  >
                    <Plus size={10} />
                    Custom
                  </button>
                </div>

                <div className="p-3 space-y-3">
                  {showCreateEnv && (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5">
                      <input
                        value={newEnvName}
                        onChange={(e) => setNewEnvName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateCustomEnvironment()}
                        placeholder="Environment name…"
                        className="flex-1 bg-transparent text-xs font-medium text-white/80 placeholder:text-white/20 outline-none"
                      />
                      <button
                        onClick={handleCreateCustomEnvironment}
                        disabled={!newEnvName.trim() || sensors.length === 0}
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/20 text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Save
                      </button>
                      <button onClick={() => setShowCreateEnv(false)} className="text-white/30 hover:text-white/60 transition-colors">
                        <X size={12} />
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-1.5">
                    {ENVIRONMENT_PRESETS.map((env) => (
                      <button
                        key={env.id}
                        onClick={() => handleActivateEnvironment(env.id)}
                        title={env.description}
                        className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-[11px] font-medium transition-all cursor-pointer ${
                          activeEnvironment === env.id
                            ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04] text-white/50 hover:text-white/80'
                        }`}
                      >
                        <span className={activeEnvironment === env.id ? 'text-blue-400' : 'text-white/30'}>
                          {getEnvIcon(env.icon)}
                        </span>
                        <span className="truncate w-full text-center leading-tight">{env.name}</span>
                      </button>
                    ))}
                    {customEnvironments.map((env) => (
                      <div key={env.id} className="relative group">
                        <button
                          onClick={() => handleActivateEnvironment(env.id)}
                          className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-[11px] font-medium transition-all w-full cursor-pointer ${
                            activeEnvironment === env.id
                              ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                              : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04] text-white/50 hover:text-white/80'
                          }`}
                        >
                          <FlaskConical size={13} className={activeEnvironment === env.id ? 'text-blue-400' : 'text-white/30'} />
                          <span className="truncate w-full text-center leading-tight">{env.name}</span>
                        </button>
                        <button
                          onClick={() => handleDeleteCustomEnvironment(env.id)}
                          className="absolute -top-1 -right-1 bg-red-500 rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <X size={7} className="text-white" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {activeEnvironment && (
                    <p className="text-[10px] text-white/30 leading-relaxed">
                      Environment active — link sensors below to sync their values.
                    </p>
                  )}
                </div>
              </div>

              {/* Sensors card */}
              <div className="rounded-xl border border-white/[0.06] bg-[#0e0e0e] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                  <span className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">Sensors</span>
                  <button
                    onClick={handleAddSensor}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-white/50 hover:text-white transition-colors"
                  >
                    <Plus size={10} />
                    Add
                  </button>
                </div>

                <div className="p-3">
                  {sensors.length === 0 ? (
                    <p className="text-[11px] text-white/25 py-2 text-center">
                      No sensors yet — click Add to attach a virtual sensor
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {sensors.map((sensor) => {
                        const option = getSensorOption(sensor.type);
                        const linked = sensor.linkedEnv !== null;
                        const linkedEnvName =
                          ENVIRONMENT_PRESETS.find((e) => e.id === sensor.linkedEnv)?.name ??
                          customEnvironments.find((e) => e.id === sensor.linkedEnv)?.name;
                        return (
                          <div
                            key={sensor.id}
                            className={`rounded-lg border p-2.5 transition-colors ${
                              linked
                                ? 'border-blue-500/20 bg-blue-500/[0.04]'
                                : 'border-white/[0.06] bg-white/[0.02]'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <select
                                value={sensor.type}
                                onChange={(e) => {
                                  const next = getSensorOption(e.target.value);
                                  handleUpdateSensor(sensor.id, {
                                    type: next.type,
                                    pin: next.defaultPin,
                                    value: next.defaultValue,
                                  });
                                }}
                                className="flex-1 bg-[#161616] border border-white/[0.08] rounded-md px-2 py-1 text-[11px] font-medium text-white/70 cursor-pointer focus:outline-none focus:border-blue-500/40"
                              >
                                {SENSOR_OPTIONS.map((opt) => (
                                  <option key={opt.type} value={opt.type}>{opt.type}</option>
                                ))}
                              </select>
                              <input
                                value={sensor.pin}
                                onChange={(e) => handleUpdateSensor(sensor.id, { pin: e.target.value })}
                                className="w-14 bg-[#161616] border border-white/[0.08] rounded-md px-2 py-1 text-[11px] font-mono text-white/70 text-center focus:outline-none focus:border-blue-500/40"
                                placeholder="A0"
                              />
                              {activeEnvironment && (
                                <button
                                  onClick={() => handleToggleSensorLink(sensor.id, activeEnvironment)}
                                  title={linked ? `Linked to ${linkedEnvName}` : 'Link to active environment'}
                                  className={`w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
                                    linked
                                      ? 'bg-blue-500/20 border-blue-500/30 text-blue-400'
                                      : 'border-white/[0.08] bg-white/[0.03] text-white/30 hover:text-white/60'
                                  }`}
                                >
                                  {linked ? <Link2 size={11} /> : <Unlink size={11} />}
                                </button>
                              )}
                              <button
                                onClick={() => handleRemoveSensor(sensor.id)}
                                className="w-7 h-7 rounded-md border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-white/25 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/[0.05] transition-colors"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>

                            <div className="mt-2.5 flex items-center gap-2.5">
                              <input
                                type="range"
                                min={option.min}
                                max={option.max}
                                value={sensor.value}
                                onChange={(e) => handleUpdateSensor(sensor.id, { value: Number(e.target.value) })}
                                className="flex-1 accent-blue-500 h-1 cursor-pointer"
                              />
                              <span className="text-[11px] font-mono text-white/50 w-16 text-right tabular-nums shrink-0">
                                {sensor.value} {option.unit}
                              </span>
                            </div>

                            {linked && (
                              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-blue-400/70">
                                <Link2 size={8} />
                                Linked to {linkedEnvName}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

            </div>
          </ScrollArea>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {/* Wiring Diagram */}
          <div className="flex-1 border-b border-white/[0.06] flex flex-col min-h-0 overflow-hidden">
            <div className="h-10 border-b border-white/[0.04] flex items-center px-4 shrink-0">
              <span className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">Wiring Diagram</span>
              {isGeneratingWiring && (
                <div className="ml-auto flex items-center gap-1.5 text-[11px] text-blue-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  Generating…
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 relative bg-[#080808]">
              <WiringDiagram
                guide={wiringGuide}
                loading={isGeneratingWiring}
                error={wiringError || undefined}
              />
            </div>
          </div>

          {/* Serial Monitor */}
          <div className="h-52 shrink-0 flex flex-col min-h-0 overflow-hidden">
            <div className="h-10 border-b border-white/[0.04] flex items-center px-4 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white/10" />
                <span className="w-1.5 h-1.5 rounded-full bg-white/10" />
                <span className="w-1.5 h-1.5 rounded-full bg-white/10" />
              </div>
              <span className="ml-2.5 text-[11px] font-semibold text-white/40 uppercase tracking-wider">Serial Monitor</span>
              {isRunning && (
                <div className="ml-auto flex items-center gap-1.5 text-[11px] text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden bg-black">
              <ScrollArea className="h-full">
                <pre className="px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-white/50">
                  {serialOutput || <span className="text-white/20">No serial output yet…</span>}
                </pre>
              </ScrollArea>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

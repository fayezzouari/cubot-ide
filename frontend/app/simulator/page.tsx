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
        main_file: mainFile.path,
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
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
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
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Arduino Board Visualization */}
        <div className="w-1/2 border-r-4 border-foreground p-6 overflow-y-auto">
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

          {/* Environment Simulator & Sensors */}
          <div className="mt-6 border-2 border-foreground max-w-md bg-background">
            {/* Environment Presets */}
            <div className="border-b-2 border-foreground p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-black text-sm">ENVIRONMENTS</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-2 border-foreground font-black h-7 text-xs"
                  onClick={() => setShowCreateEnv((v) => !v)}
                >
                  <Plus size={12} />
                  CUSTOM
                </Button>
              </div>

              {showCreateEnv && (
                <div className="mb-2 flex items-center gap-2 p-2 border-2 border-dashed border-primary rounded">
                  <Input
                    value={newEnvName}
                    onChange={(e) => setNewEnvName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateCustomEnvironment()}
                    placeholder="Environment name..."
                    className="h-7 text-xs flex-1 border-2 border-foreground"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-2 border-foreground font-black"
                    onClick={handleCreateCustomEnvironment}
                    disabled={!newEnvName.trim() || sensors.length === 0}
                  >
                    SAVE
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setShowCreateEnv(false)}
                  >
                    <X size={12} />
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-3 gap-1.5">
                {ENVIRONMENT_PRESETS.map((env) => (
                  <button
                    key={env.id}
                    onClick={() => handleActivateEnvironment(env.id)}
                    title={env.description}
                    className={`flex flex-col items-center gap-1 p-2 rounded border-2 text-xs font-bold transition-all ${
                      activeEnvironment === env.id
                        ? 'border-primary bg-primary/15 text-primary shadow-md'
                        : 'border-foreground/30 hover:border-foreground hover:bg-muted'
                    }`}
                  >
                    {getEnvIcon(env.icon)}
                    <span className="truncate w-full text-center leading-tight">{env.name}</span>
                  </button>
                ))}
                {customEnvironments.map((env) => (
                  <div key={env.id} className="relative group">
                    <button
                      onClick={() => handleActivateEnvironment(env.id)}
                      className={`flex flex-col items-center gap-1 p-2 rounded border-2 text-xs font-bold transition-all w-full ${
                        activeEnvironment === env.id
                          ? 'border-primary bg-primary/15 text-primary shadow-md'
                          : 'border-foreground/30 hover:border-foreground hover:bg-muted'
                      }`}
                    >
                      <FlaskConical size={14} />
                      <span className="truncate w-full text-center leading-tight">{env.name}</span>
                    </button>
                    <button
                      onClick={() => handleDeleteCustomEnvironment(env.id)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={8} />
                    </button>
                  </div>
                ))}
              </div>
              {activeEnvironment && (
                <p className="text-[10px] text-muted-foreground mt-2 leading-tight">
                  ✓ Active — link sensors below to this environment so their values update when it&apos;s activated.
                </p>
              )}
            </div>

            {/* Sensors */}
            <div className="p-3">
              <div className="flex items-center justify-between">
                <span className="font-black text-sm">SENSORS</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-2 border-foreground font-black h-7"
                  onClick={handleAddSensor}
                >
                  <Plus size={12} />
                  ADD
                </Button>
              </div>
              {sensors.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-2">No sensors added yet. Click ADD to attach virtual sensors.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {sensors.map((sensor) => {
                    const option = getSensorOption(sensor.type);
                    const linked = sensor.linkedEnv !== null;
                    const linkedEnvName =
                      ENVIRONMENT_PRESETS.find((e) => e.id === sensor.linkedEnv)?.name ??
                      customEnvironments.find((e) => e.id === sensor.linkedEnv)?.name;
                    return (
                      <div
                        key={sensor.id}
                        className={`border-2 p-2 rounded transition-colors ${
                          linked ? 'border-primary/60 bg-primary/5' : 'border-foreground'
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
                            className="flex-1 border-2 border-foreground px-2 py-1 text-xs font-bold bg-background rounded"
                          >
                            {SENSOR_OPTIONS.map((opt) => (
                              <option key={opt.type} value={opt.type}>
                                {opt.type}
                              </option>
                            ))}
                          </select>
                          <Input
                            value={sensor.pin}
                            onChange={(e) => handleUpdateSensor(sensor.id, { pin: e.target.value })}
                            className="w-16 h-7 text-xs font-mono border-2 border-foreground"
                            placeholder="A0"
                          />
                          {activeEnvironment && (
                            <Button
                              variant={linked ? 'default' : 'outline'}
                              size="icon"
                              className={`h-7 w-7 border-2 ${linked ? 'border-primary' : 'border-foreground'}`}
                              onClick={() => handleToggleSensorLink(sensor.id, activeEnvironment)}
                              title={linked ? `Linked to ${linkedEnvName}` : 'Link to active environment'}
                            >
                              {linked ? <Link2 size={12} /> : <Unlink size={12} />}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 border-2 border-foreground"
                            onClick={() => handleRemoveSensor(sensor.id)}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="range"
                            min={option.min}
                            max={option.max}
                            value={sensor.value}
                            onChange={(e) => handleUpdateSensor(sensor.id, { value: Number(e.target.value) })}
                            className="flex-1 accent-primary"
                          />
                          <span className="text-xs font-bold w-16 text-right tabular-nums">
                            {sensor.value} {option.unit}
                          </span>
                        </div>
                        {linked && (
                          <div className="mt-1 text-[10px] text-primary flex items-center gap-1">
                            <Link2 size={8} /> Linked to {linkedEnvName}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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

        {/* Right panel: Wiring Diagram + Serial Monitor */}
        <div className="w-1/2 flex flex-col min-h-0 overflow-hidden">
          {/* Wiring Diagram */}
          <div className="flex-1 border-b-4 border-foreground flex flex-col min-h-0 overflow-hidden">
            <div className="h-10 border-b-2 border-foreground flex items-center px-4 shrink-0">
              <span className="font-black text-sm">WIRING DIAGRAM</span>
              {isGeneratingWiring && (
                <span className="ml-auto text-xs font-bold text-primary">Generating…</span>
              )}
            </div>
            <div className="flex-1 min-h-0 relative">
              <WiringDiagram
                guide={wiringGuide}
                loading={isGeneratingWiring}
                error={wiringError || undefined}
              />
            </div>
          </div>

          {/* Serial Monitor */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="h-10 border-b-2 border-foreground flex items-center px-4 shrink-0">
              <span className="font-black text-sm">SERIAL MONITOR</span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full p-4">
                <pre className="font-mono text-sm whitespace-pre-wrap">
                  {serialOutput || 'No serial output yet.'}
                </pre>
              </ScrollArea>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

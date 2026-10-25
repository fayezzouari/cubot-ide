'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Box,
  BrickWall,
  Cpu,
  Gauge,
  Home,
  Image as ImageIcon,
  Loader2,
  Map as MapIcon,
  Pause,
  Plane,
  Play,
  Radio,
  Route,
  Square,
  Tags,
  Target,
  Workflow,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { fleetApi } from '@/lib/api/fleet';
import type { Algorithm, Broker, BrokerMode, Task } from '@/lib/fleet/types';
import { ALGORITHMS, DEFAULT_SIM_SPEED, ENTITY_PALETTE, SIM_SPEEDS } from '@/lib/fleet/constants';
import { filterTasksForPlanning, planDroneRoutes, planRoutes, type DroneRoute, type RobotRoute } from '@/lib/fleet/simRoutes';
import { useProjectData } from '@/lib/fleet/hooks/useProjectData';
import { useSimulation } from '@/lib/fleet/hooks/useSimulation';
import { useDroneSimulation } from '@/lib/fleet/hooks/useDroneSimulation';
import { useBrokerTopics, type AssignmentMsg } from '@/lib/fleet/hooks/useBrokerTopics';
import { useVdaPublisher } from '@/lib/fleet/hooks/useVdaPublisher';
import { useLiveTelemetry } from '@/lib/fleet/hooks/useLiveTelemetry';
import { useUagvFlow } from '@/lib/fleet/hooks/useUagvFlow';
import { useUavFlow } from '@/lib/fleet/hooks/useUavFlow';
import { FLEET_THEME } from '@/components/fleet/theme';
import { EnvironmentView } from '@/components/fleet/EnvironmentView';
import { RobotsPanel } from '@/components/fleet/RobotsPanel';
import { DronesPanel } from '@/components/fleet/DronesPanel';
import { CategoriesPanel } from '@/components/fleet/CategoriesPanel';
import { TasksPanel } from '@/components/fleet/TasksPanel';
import { EnvironmentPanel } from '@/components/fleet/EnvironmentPanel';
import { CoordinatorPanel } from '@/components/fleet/CoordinatorPanel';
import { FlowView } from '@/components/fleet/FlowView';
import { ModeToggle } from '@/components/fleet/ModeToggle';

type Placing = 'robot' | 'drone' | 'task' | 'obstacle' | null;
type PanelTab = 'robots' | 'drones' | 'categories' | 'tasks' | 'environment' | 'coordinator';
type View = 'map' | 'flow';

const PANEL_TABS: { id: PanelTab; label: string; Icon: typeof Cpu }[] = [
  { id: 'robots', label: 'Robots', Icon: Cpu },
  { id: 'drones', label: 'Drones', Icon: Plane },
  { id: 'categories', label: 'Categories', Icon: Tags },
  { id: 'tasks', label: 'Tasks', Icon: Target },
  { id: 'environment', label: 'Environment', Icon: ImageIcon },
  { id: 'coordinator', label: 'Coordinator', Icon: Radio },
];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function Workspace({ projectId }: { projectId: string }) {
  const { data: session } = useSession();
  const {
    project,
    robots,
    drones,
    tasks,
    categories,
    environment,
    loading,
    error,
    addRobot,
    editRobot,
    removeRobot,
    addDrone,
    editDrone,
    removeDrone,
    addTask,
    editTask,
    removeTask,
    reassign,
    reassignDrones,
    startSequence,
    completeSequenceTask,
    advanceSequence,
    stopSequence,
    addCategory,
    editCategory,
    removeCategory,
    applyAssignment,
    saveEnvironment,
    toggleObstacle,
    refreshRobots,
  } = useProjectData(projectId);

  const [running, setRunning] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [placing, setPlacing] = useState<Placing>(null);
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [algorithm, setAlgorithm] = useState<Algorithm>('astar');
  const [routes, setRoutes] = useState<Record<string, RobotRoute>>({});
  const [droneRoutes, setDroneRoutes] = useState<Record<string, DroneRoute>>({});
  const [simSpeed, setSimSpeed] = useState<number>(() =>
    (SIM_SPEEDS as readonly number[]).includes(DEFAULT_SIM_SPEED) ? DEFAULT_SIM_SPEED : 1,
  );
  const [panelTab, setPanelTab] = useState<PanelTab>('robots');
  const [view, setView] = useState<View>('map');

  const [broker, setBroker] = useState<Broker | null>(null);
  const [creatingBroker, setCreatingBroker] = useState(false);
  useEffect(() => {
    fleetApi
      .getBroker(projectId)
      .then(setBroker)
      .catch(() => setBroker(null));
  }, [projectId]);

  useEffect(() => {
    if (project) {
      try {
        localStorage.setItem('cubot-ide-last-project', project.id);
      } catch {}
    }
  }, [project]);

  const isLive = broker?.mode === 'live';

  const onRobotSequenceTaskComplete = useCallback(
    (task: Task) => {
      if (task.assigned_robot_id) void completeSequenceTask('robots', task.assigned_robot_id);
    },
    [completeSequenceTask],
  );
  const onDroneSequenceTaskComplete = useCallback(
    (task: Task) => {
      if (task.assigned_drone_id) void completeSequenceTask('drones', task.assigned_drone_id);
    },
    [completeSequenceTask],
  );

  const bounds = useMemo(
    () => ({ width: environment?.width ?? 0, height: environment?.height ?? 0 }),
    [environment?.width, environment?.height],
  );
  const sim = useSimulation(robots, tasks, routes, running && !isLive, bounds, simSpeed, onRobotSequenceTaskComplete);
  const simRef = useRef(sim);
  simRef.current = sim;

  const droneSim = useDroneSimulation(drones, tasks, droneRoutes, running && !isLive, simSpeed, onDroneSequenceTaskComplete);

  const { liveById, connectedIds: liveConnectedSerials } = useLiveTelemetry(broker, isLive);

  const unknownSerialTries = useRef<Record<string, number>>({});
  const robotRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isLive || robotRefreshTimer.current) return;
    const known = new Set(robots.map((r) => r.serial_number));
    const unknown = Object.keys(liveById).filter((s) => !known.has(s) && (unknownSerialTries.current[s] ?? 0) < 3);
    if (!unknown.length) return;
    for (const s of unknown) unknownSerialTries.current[s] = (unknownSerialTries.current[s] ?? 0) + 1;
    robotRefreshTimer.current = setTimeout(() => {
      robotRefreshTimer.current = null;
      void refreshRobots();
    }, 1500);
  }, [isLive, robots, liveById, refreshRobots]);
  useEffect(
    () => () => {
      if (robotRefreshTimer.current) clearTimeout(robotRefreshTimer.current);
    },
    [],
  );
  const { vehicles: vdaVehicles } = useUagvFlow(isLive ? broker : null);
  const { liveById: liveDroneById, connectedIds: liveDroneConnectedSerials } = useUavFlow(broker, isLive);

  const liveConnectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of robots) if (liveConnectedSerials.has(r.serial_number)) ids.add(r.id);
    return ids;
  }, [robots, liveConnectedSerials]);
  const liveDroneConnectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of drones) if (liveDroneConnectedSerials.has(d.serial_number)) ids.add(d.id);
    return ids;
  }, [drones, liveDroneConnectedSerials]);

  const displayRobots = useMemo(() => {
    if (isLive) {
      return robots.map((r) => {
        const live = liveById[r.serial_number];
        if (!live) return r;
        return { ...r, position: { ...r.position, x: live.x, y: live.y }, heading: live.heading, status: live.status };
      });
    }
    return running ? sim.robots : robots;
  }, [isLive, robots, liveById, running, sim.robots]);

  const displayDrones = useMemo(() => {
    if (isLive) {
      return drones.map((d) => {
        const live = liveDroneById[d.serial_number];
        if (!live) return d;
        return { ...d, position: { x: live.x, y: live.y, z: live.z }, status: live.status };
      });
    }
    return running ? droneSim.drones : drones;
  }, [isLive, drones, liveDroneById, running, droneSim.drones]);

  const displayTasks = useMemo(() => {
    if (!running) return tasks;
    const droneDone = new Set(droneSim.tasks.filter((t) => t.status === 'done').map((t) => t.id));
    return sim.tasks.map((t) => (droneDone.has(t.id) ? { ...t, status: 'done' as const } : t));
  }, [running, tasks, sim.tasks, droneSim.tasks]);

  const taskIdsSig = useMemo(
    () =>
      tasks
        .map((t) => t.id)
        .sort()
        .join('|'),
    [tasks],
  );
  const sequenceSig = useMemo(
    () =>
      [...robots, ...drones]
        .map((v) => `${v.id}:${v.sequence_status}:${v.sequence_cursor}`)
        .sort()
        .join('|'),
    [robots, drones],
  );
  const plannedTasksSig = useRef<string | null>(null);
  const planInputs = useRef({ robots, drones, environment, algorithm });
  planInputs.current = { robots, drones, environment, algorithm };

  useEffect(() => {
    const env = planInputs.current.environment;
    if (!running || !env) return;
    const sig = `${taskIdsSig}##${sequenceSig}`;
    if (plannedTasksSig.current === sig) return;
    let cancelled = false;
    void (async () => {
      const { robots: baseRobots, drones: baseDrones, algorithm: algo } = planInputs.current;
      const live = simRef.current;
      const planningTasks = filterTasksForPlanning(live.tasks, baseRobots, baseDrones);
      try {
        const [next, nextDrone] = await Promise.all([
          planRoutes(live.robots, planningTasks, env, algo),
          planDroneRoutes(baseDrones, planningTasks, env),
        ]);
        if (!cancelled) {
          setRoutes(next);
          setDroneRoutes(nextDrone);
          plannedTasksSig.current = sig;
        }
      } catch (err) {
        if (!cancelled) toast.error(`Replanning failed: ${errorMessage(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskIdsSig, sequenceSig, running, environment, algorithm]);

  const onAssign = useCallback((m: AssignmentMsg) => applyAssignment(m.task_id, m.robot_id, m.eta_s), [applyAssignment]);
  const brokerTopics = useBrokerTopics(broker, onAssign);

  useVdaPublisher(broker, displayRobots, running && !isLive, projectId);

  const handleCreateBroker = useCallback(async () => {
    setCreatingBroker(true);
    try {
      setBroker(await fleetApi.createBroker(projectId));
    } catch (err) {
      toast.error(`Could not create broker: ${errorMessage(err)}`);
    } finally {
      setCreatingBroker(false);
    }
  }, [projectId]);

  const handleModeChange = useCallback(
    async (mode: BrokerMode) => {
      try {
        setBroker(await fleetApi.updateBroker(projectId, { mode }));
      } catch (err) {
        toast.error(`Could not switch mode: ${errorMessage(err)}`);
      }
    },
    [projectId],
  );

  const handleAutoAssignChange = useCallback(
    async (auto_assign: boolean) => {
      try {
        setBroker(await fleetApi.updateBroker(projectId, { auto_assign }));
      } catch (err) {
        toast.error(`Could not change assignment: ${errorMessage(err)}`);
      }
    },
    [projectId],
  );

  const handleDispatchToggle = useCallback(
    async (dispatch_active: boolean) => {
      try {
        setBroker(await fleetApi.updateBroker(projectId, { dispatch_active }));
      } catch (err) {
        toast.error(`Could not toggle dispatch: ${errorMessage(err)}`);
      }
    },
    [projectId],
  );

  const liveRobotsRef = useRef(displayRobots);
  liveRobotsRef.current = displayRobots;
  const { publishLoc } = brokerTopics;
  const hasBroker = broker !== null;
  useEffect(() => {
    if (!running || !hasBroker || isLive) return;
    const timer = setInterval(() => {
      for (const r of liveRobotsRef.current) {
        publishLoc(r.id, { x: r.position.x, y: r.position.y, z: r.position.z, heading: r.heading, status: r.status });
      }
    }, 125);
    return () => clearInterval(timer);
  }, [running, hasBroker, isLive, publishLoc]);

  const paths = useMemo(() => {
    const out: Record<string, { x: number; y: number }[]> = {};
    for (const r of Object.values(routes)) {
      if (r.points.length > 1) out[r.robotId] = r.points;
    }
    return out;
  }, [routes]);

  const taskColors = useMemo(() => {
    const colorByRobot = new Map(robots.map((r) => [r.id, r.color]));
    const out: Record<string, string> = {};
    for (const route of Object.values(routes)) {
      const color = colorByRobot.get(route.robotId);
      if (!color) continue;
      for (const cp of route.checkpoints) out[cp.taskId] = color;
    }
    return out;
  }, [routes, robots]);

  const handlePick = useCallback(
    (cell: { x: number; y: number }) => {
      if (placing === 'robot') {
        void addRobot({
          name: `Robot ${robots.length + 1}`,
          position: { x: cell.x, y: cell.y, z: 0 },
          color: ENTITY_PALETTE[robots.length % ENTITY_PALETTE.length],
        });
      } else if (placing === 'drone') {
        void addDrone({
          name: `Drone ${drones.length + 1}`,
          position: { x: cell.x, y: cell.y, z: 2 },
          color: ENTITY_PALETTE[drones.length % ENTITY_PALETTE.length],
        });
      } else if (placing === 'task') {
        void addTask({ name: `Task ${tasks.length + 1}`, position: { x: cell.x, y: cell.y, z: 0 }, priority: 1 });
      } else if (placing === 'obstacle') {
        toggleObstacle(cell.x, cell.y);
      }
    },
    [placing, robots.length, drones.length, tasks.length, addRobot, addDrone, addTask, toggleObstacle],
  );

  const togglePlacing = (kind: NonNullable<Placing>) => {
    setView('map');
    setPlacing((cur) => (cur === kind ? null : kind));
  };

  const selectRobot = useCallback((id: string | null) => {
    setSelectedRobotId((cur) => (cur === null || id === null || cur === id ? id : cur));
  }, []);
  const selectDrone = useCallback((id: string | null) => {
    setSelectedDroneId((cur) => (cur === null || id === null || cur === id ? id : cur));
  }, []);

  const handleRobotMove = useCallback(
    (robotId: string, cell: { x: number; y: number }) => {
      const robot = robots.find((r) => r.id === robotId);
      if (!robot) return;
      if (environment?.obstacles?.[cell.y]?.[cell.x] === 1) return;
      if (robot.position.x === cell.x && robot.position.y === cell.y) return;
      void editRobot(robotId, { position: { x: cell.x, y: cell.y, z: robot.position.z } });
    },
    [robots, environment, editRobot],
  );

  const toggleSimulate = useCallback(async () => {
    if (running) {
      setRunning(false);
      setRoutes({});
      setDroneRoutes({});
      plannedTasksSig.current = null;
      return;
    }
    if (!environment) return;
    setPlacing(null);
    setPlanning(true);
    try {
      const [next, nextDrone] = await Promise.all([
        planRoutes(robots, tasks, environment, algorithm),
        planDroneRoutes(drones, tasks, environment),
      ]);
      setRoutes(next);
      setDroneRoutes(nextDrone);
      plannedTasksSig.current = `${taskIdsSig}##${sequenceSig}`;
      setRunning(true);
    } catch (err) {
      toast.error(`Planning failed: ${errorMessage(err)}`);
    } finally {
      setPlanning(false);
    }
  }, [running, environment, robots, drones, tasks, algorithm, taskIdsSig, sequenceSig]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPlacing(null);
      setSelectedRobotId(null);
      setSelectedDroneId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const editingDisabled = running || planning;
  const canDragRobots = !editingDisabled && !isLive;
  const selectedRobot = robots.find((r) => r.id === selectedRobotId) ?? null;
  const openTasks = tasks.filter((t) => t.status !== 'done').length;
  const ready = !loading && !!environment && !!project;

  const tabCount = (tab: PanelTab): number | null => {
    if (tab === 'robots') return robots.length;
    if (tab === 'drones') return drones.length;
    if (tab === 'categories') return categories.length;
    if (tab === 'tasks') return tasks.length;
    return null;
  };

  return (
    <div className="flex h-screen flex-col bg-[#080808] text-foreground" style={FLEET_THEME}>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#0a0a0a] px-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/cubot.svg" alt="CuBot" width={28} height={28} className="h-7 w-7 object-contain" />
          <span className="text-sm font-semibold text-white/80">CuBot</span>
        </Link>
        <span className="text-white/15">/</span>
        <span className="font-mono text-xs text-white/35">Fleet</span>
        <span className="max-w-56 truncate text-sm text-white/85" title={project?.name}>
          {project?.name ?? '…'}
        </span>
        {project && (
          <span
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
              project.dimension === '3d' ? 'border-violet-400/30 text-violet-300' : 'border-emerald-400/30 text-emerald-300'
            }`}
            title="Workspace dimension"
          >
            {project.dimension === '3d' ? <Box size={10} /> : <Square size={10} />}
            {project.dimension}
          </span>
        )}

        {ready && (
          <div className="ml-3 flex items-center gap-1">
            <div className="inline-flex rounded-md border border-white/[0.08] p-0.5">
              {(
                [
                  ['map', 'Map', MapIcon],
                  ['flow', 'VDA flow', Workflow],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                    view === id ? 'bg-white/[0.08] text-white' : 'text-white/45 hover:text-white/75'
                  }`}
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className={`h-8 text-xs ${placing === 'obstacle' ? 'bg-white/[0.08] text-white' : 'text-white/60'}`}
              onClick={() => togglePlacing('obstacle')}
              disabled={editingDisabled}
              title="Toggle obstacle cells"
            >
              <BrickWall size={14} /> Obstacles
            </Button>
            <div className="flex items-center gap-1 text-white/45" title="Path planning algorithm">
              <Route size={14} />
              <select
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value as Algorithm)}
                disabled={editingDisabled}
                className="rounded border border-white/[0.08] bg-transparent px-1 py-1 text-[11px] text-white/70 disabled:opacity-40"
              >
                {ALGORITHMS.map((a) => (
                  <option key={a.value} value={a.value} className="bg-[#111]">
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {ready && (
          <div className="mx-auto flex items-center gap-1.5">
            {broker && <ModeToggle mode={broker.mode} onChange={(m) => void handleModeChange(m)} disabled={running} />}
            {broker && (
              <Button
                size="sm"
                variant="outline"
                className={`h-8 text-xs ${broker.dispatch_active ? 'border-emerald-400/50 text-emerald-200' : ''}`}
                onClick={() => void handleDispatchToggle(!broker.dispatch_active)}
                title={
                  broker.dispatch_active
                    ? 'Stop coordinator dispatch'
                    : broker.auto_assign
                      ? 'Start coordinator dispatch'
                      : 'Send the assigned tasks to the robots'
                }
              >
                <Radio size={14} /> {broker.dispatch_active ? 'Dispatching' : broker.auto_assign ? 'Dispatch off' : 'Execute'}
              </Button>
            )}
            {!isLive && (
              <>
                {!running ? (
                  <Button
                    size="sm"
                    className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                    onClick={() => void toggleSimulate()}
                    disabled={planning}
                  >
                    {planning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    {planning ? 'Planning…' : 'Simulate'}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void toggleSimulate()}>
                    <Pause size={14} /> Pause
                  </Button>
                )}
                <div className="ml-1 flex items-center gap-1 text-white/45" title="Simulation speed">
                  <Gauge size={14} />
                  <select
                    value={simSpeed}
                    onChange={(e) => setSimSpeed(Number(e.target.value))}
                    className="rounded border border-white/[0.08] bg-transparent px-1 py-1 text-[11px] text-white/70"
                  >
                    {SIM_SPEEDS.map((s) => (
                      <option key={s} value={s} className="bg-[#111]">
                        {s}×
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        )}

        <div className={`flex items-center gap-2 ${ready ? '' : 'ml-auto'}`}>
          <Link href="/dashboard" title="Dashboard">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white/70">
              <Home size={15} />
            </Button>
          </Link>
          {session?.user?.image && (
            <Image
              src={session.user.image}
              alt={session.user.name ?? 'User'}
              width={26}
              height={26}
              className="rounded-full border border-white/10"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </header>

      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          {error ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="inline-flex items-center gap-2 text-[12px] text-red-300">
                <AlertCircle size={14} /> {error}
              </span>
              <Link href="/dashboard" className="text-[11px] text-white/45 underline-offset-4 hover:text-white/75 hover:underline">
                Back to dashboard
              </Link>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-white/35">
              <Loader2 size={13} className="animate-spin" /> Loading workspace
            </span>
          )}
        </div>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={70} minSize={35}>
            {view === 'flow' ? (
              <FlowView broker={broker} robots={robots} drones={drones} />
            ) : (
              <div className="flex h-full flex-col bg-[#080808]">
                <div className="relative min-h-0 flex-1">
                  {placing && (
                    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-white/10 bg-[#0d0d10]/95 px-3 py-1.5 text-[11px] text-emerald-200 shadow">
                      {placing === 'obstacle' ? 'Click cells to toggle obstacles' : `Click the map to place a ${placing}`}
                      <span className="text-white/30">· Esc to stop</span>
                      <button onClick={() => setPlacing(null)} className="text-white/40 hover:text-white/80" aria-label="Stop placing">
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  {!placing && selectedRobot && canDragRobots && (
                    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-white/10 bg-[#0d0d10]/95 px-3 py-1.5 text-[11px] text-violet-200 shadow">
                      Edit mode · drag {selectedRobot.name} to move it
                      <span className="text-white/30">· Esc to deselect</span>
                      <button onClick={() => setSelectedRobotId(null)} className="text-white/40 hover:text-white/80" aria-label="Deselect robot">
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  <EnvironmentView
                    dimension={project.dimension}
                    environment={environment}
                    robots={displayRobots}
                    drones={displayDrones}
                    tasks={displayTasks}
                    paths={running ? paths : undefined}
                    taskColors={running ? taskColors : undefined}
                    selectedRobotId={selectedRobotId}
                    selectedDroneId={selectedDroneId}
                    onPick={placing && !running ? handlePick : undefined}
                    onRobotSelect={editingDisabled ? undefined : selectRobot}
                    onRobotMove={canDragRobots ? handleRobotMove : undefined}
                    onDroneSelect={editingDisabled ? undefined : selectDrone}
                  />
                </div>
                <div className="flex h-8 shrink-0 items-center gap-4 border-t border-white/[0.08] bg-[#0a0a0a] px-3 font-mono text-[10px] uppercase tracking-wider text-white/35">
                  <span>
                    {environment.width}×{environment.height} grid
                  </span>
                  <span>{robots.length} robots</span>
                  <span>{drones.length} drones</span>
                  <span>{openTasks} open tasks</span>
                  {running && !isLive && (
                    <span className="ml-auto inline-flex items-center gap-1.5 text-emerald-300/80">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                      Simulating · {ALGORITHMS.find((a) => a.value === algorithm)?.label ?? algorithm}
                    </span>
                  )}
                  {isLive && (
                    <span className="ml-auto inline-flex items-center gap-1.5 text-orange-300/90">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
                      Live · {liveConnectedIds.size}/{robots.length} connected
                    </span>
                  )}
                </div>
              </div>
            )}
          </ResizablePanel>

          <ResizableHandle className="w-px bg-white/[0.06]" />

          <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
            <div className="flex h-full flex-col bg-[#0a0a0a]">
              <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-white/[0.08] px-2">
                {PANEL_TABS.map(({ id, label, Icon }) => {
                  const active = panelTab === id;
                  const count = tabCount(id);
                  return (
                    <button
                      key={id}
                      onClick={() => setPanelTab(id)}
                      title={label}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
                        active ? 'bg-white/[0.07] text-white' : 'text-white/45 hover:text-white/70'
                      }`}
                    >
                      <Icon size={12} />
                      {active && <span>{label}</span>}
                      {count !== null ? (
                        <span className="font-mono text-[10px] tabular-nums text-white/35">{count}</span>
                      ) : id === 'coordinator' ? (
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${brokerTopics.connected ? 'bg-emerald-400' : 'bg-white/20'}`} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="min-h-0 flex-1">
                {panelTab === 'robots' && (
                  <RobotsPanel
                    robots={robots}
                    categories={categories}
                    tasks={tasks}
                    selectedId={selectedRobotId}
                    placing={placing === 'robot'}
                    onSelect={selectRobot}
                    onPlace={() => togglePlacing('robot')}
                    onEdit={editRobot}
                    onDelete={removeRobot}
                    onStartSequence={(rid) => startSequence('robots', rid)}
                    onAdvanceSequence={(rid) => advanceSequence('robots', rid)}
                    onStopSequence={(rid) => stopSequence('robots', rid)}
                    liveConnectedIds={isLive ? liveConnectedIds : undefined}
                  />
                )}
                {panelTab === 'drones' && (
                  <DronesPanel
                    drones={drones}
                    categories={categories}
                    tasks={tasks}
                    selectedId={selectedDroneId}
                    placing={placing === 'drone'}
                    onSelect={selectDrone}
                    onPlace={() => togglePlacing('drone')}
                    onEdit={editDrone}
                    onDelete={removeDrone}
                    onReassign={reassignDrones}
                    onStartSequence={(did) => startSequence('drones', did)}
                    onAdvanceSequence={(did) => advanceSequence('drones', did)}
                    onStopSequence={(did) => stopSequence('drones', did)}
                    liveConnectedIds={isLive ? liveDroneConnectedIds : undefined}
                  />
                )}
                {panelTab === 'categories' && (
                  <CategoriesPanel categories={categories} onAdd={addCategory} onEdit={editCategory} onDelete={removeCategory} />
                )}
                {panelTab === 'tasks' && (
                  <TasksPanel
                    tasks={tasks}
                    robots={robots}
                    categories={categories}
                    placing={placing === 'task'}
                    onPlace={() => togglePlacing('task')}
                    onReassign={reassign}
                    onEdit={editTask}
                    onDelete={removeTask}
                  />
                )}
                {panelTab === 'environment' && <EnvironmentPanel environment={environment} onSave={saveEnvironment} />}
                {panelTab === 'coordinator' && (
                  <CoordinatorPanel
                    broker={broker}
                    connected={brokerTopics.connected}
                    status={brokerTopics.status}
                    locs={brokerTopics.locs}
                    robots={robots}
                    tasks={tasks}
                    creating={creatingBroker}
                    onCreate={() => void handleCreateBroker()}
                    onModeChange={(m) => void handleModeChange(m)}
                    onDispatchToggle={(a) => void handleDispatchToggle(a)}
                    onAutoAssignChange={(a) => void handleAutoAssignChange(a)}
                    vehicles={vdaVehicles}
                  />
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

export default function FleetPageContent() {
  const searchParams = useSearchParams();
  const fromQuery = searchParams.get('project') || '';
  const [projectId, setProjectId] = useState(fromQuery);
  const [resolved, setResolved] = useState(!!fromQuery);

  useEffect(() => {
    if (fromQuery) {
      setProjectId(fromQuery);
      setResolved(true);
      return;
    }
    let stored = '';
    try {
      stored = localStorage.getItem('cubot-ide-last-project') || '';
    } catch {}
    setProjectId(stored);
    setResolved(true);
  }, [fromQuery]);

  if (!resolved) {
    return <div className="flex h-screen items-center justify-center bg-[#080808] text-white/40">Loading...</div>;
  }

  if (!projectId) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#080808] text-center" style={FLEET_THEME}>
        <span className="text-[12px] text-white/60">No fleet project selected.</span>
        <Link href="/dashboard" className="text-[11px] text-white/45 underline-offset-4 hover:text-white/75 hover:underline">
          Open one from the dashboard
        </Link>
      </div>
    );
  }

  return <Workspace key={projectId} projectId={projectId} />;
}

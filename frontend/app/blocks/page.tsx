'use client';

// CuBot Blocks — visual automation IDE for a simulated (or real) robot cell.
//
// Program flow: graph (React Flow) → compile() → Interpreter on the World
// simulation, optionally mirrored to a serial-connected controller. The same
// compiled program is exported to Python and Arduino firmware.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  FolderOpen,
  Gauge,
  Home,
  LayoutTemplate,
  Pause,
  Play,
  RotateCcw,
  Save,
  SkipForward,
  Square,
  Usb,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useProject } from '@/contexts/project-context';
import { blocksApi } from '@/lib/api/blocks';
import { tidyNodes } from '@/lib/blocks/autolayout';
import { compile } from '@/lib/blocks/compiler';
import { generateFirmware, generatePython } from '@/lib/blocks/codegen';
import type { Value } from '@/lib/blocks/expression';
import { Interpreter, type LogEntry, type TelemetryEntry } from '@/lib/blocks/interpreter';
import { BLOCK_BY_TYPE, CATEGORY_BY_ID, defaultData, migrateLegacyNode, nodeHeight } from '@/lib/blocks/registry';
import { SerialLink } from '@/lib/blocks/serial';
import { buildTemplateGraph, type Template } from '@/lib/blocks/templates';
import type { Pose, ProgramDocument, SceneConfig } from '@/lib/blocks/types';
import { useWorldLoop } from '@/lib/blocks/useWorld';
import { DEFAULT_POSES, DEFAULT_SCENE, World } from '@/lib/blocks/workcell';
import {
  anchorPose,
  cloneLayout,
  createStation,
  DEFAULT_LAYOUT,
  freeSpot,
  modelDims,
  parseLayout,
  posesForLayout,
  STATION_KINDS,
  syncPoses,
  uniquePoseName,
  validateLayout,
  type CellLayout,
  type ModelSource,
  type Station,
  type StationKind,
} from '@/lib/blocks/layout';
import { BlocksCanvasContext, FlowNode } from '@/components/blocks/FlowNode';
import { BlockPalette } from '@/components/blocks/BlockPalette';
import { Inspector } from '@/components/blocks/Inspector';
import { PosesPanel } from '@/components/blocks/PosesPanel';
import { CellPanel } from '@/components/blocks/CellPanel';
import { EnvironmentPanel } from '@/components/blocks/EnvironmentPanel';
import { ConsolePanel } from '@/components/blocks/ConsolePanel';
import { TemplateGallery } from '@/components/blocks/TemplateGallery';
import { CodeDialog, type CodeFile } from '@/components/blocks/CodeDialog';

const WorkcellView = dynamic(() => import('@/components/blocks/WorkcellView'), { ssr: false });

const nodeTypes = Object.fromEntries(Object.keys(BLOCK_BY_TYPE).map((t) => [t, FlowNode]));

type RunState = 'idle' | 'running' | 'paused';
type SideTab = 'properties' | 'cell' | 'environment' | 'poses';

const EDGE_COLORS: Record<string, string> = { true: '#4ade80', false: '#f87171', body: '#a78bfa' };

const STARTER = buildTemplateGraph([{ t: 'home' }, { t: 'end' }]);

function serializeNodes(nodes: Node[]) {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type ?? 'end',
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    data: n.data as Record<string, unknown>,
  }));
}

function serializeEdges(edges: Edge[]) {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
  }));
}

function loadNodes(raw: { id: string; type: string; position?: { x: number; y: number }; data?: Record<string, unknown> }[]): Node[] {
  return raw.map((n) => {
    const { type, data } = migrateLegacyNode(n.type || 'end', n.data ?? {});
    return { id: n.id, type, position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 }, data };
  });
}

function BlocksIDE() {
  const { data: session } = useSession();
  const { currentProject, loadProject } = useProject();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [world] = useState(() => new World());
  useWorldLoop(world);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(STARTER.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(STARTER.edges);
  const [poses, setPoses] = useState<Pose[]>(DEFAULT_POSES);
  const [scene, setScene] = useState<SceneConfig>(DEFAULT_SCENE);
  const [layout, setLayout] = useState<CellLayout>(() => cloneLayout(DEFAULT_LAYOUT));
  const [stationId, setStationId] = useState<string | null>(null);
  const [programName, setProgramName] = useState('Untitled program');
  const [programId, setProgramId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'offline'>('offline');

  const [runState, setRunState] = useState<RunState>('idle');
  const [stepping, setStepping] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryEntry[]>([]);
  const [variables, setVariables] = useState<Record<string, Value>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>('properties');
  const [simSpeed, setSimSpeed] = useState(1);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [serial, setSerial] = useState<SerialLink | null>(null);
  const [serialLog, setSerialLog] = useState<{ dir: 'tx' | 'rx'; line: string }[]>([]);

  const interpreterRef = useRef<Interpreter | null>(null);
  const logId = useRef(0);
  const loadedRef = useRef(false);
  // 'pending' = the next snapshot is the freshly loaded program (save baseline).
  const baseline = useRef<'waiting' | 'pending' | 'set'>('waiting');
  const savedSnapshot = useRef('');
  const fileInput = useRef<HTMLInputElement>(null);

  const running = runState !== 'idle';
  const compiled = useMemo(() => compile(nodes, edges, poses), [nodes, edges, poses]);
  const problemsByNode = useMemo(() => {
    const m = new Map<string, typeof compiled.problems>();
    compiled.problems.forEach((p) => p.nodeId && m.set(p.nodeId, [...(m.get(p.nodeId) ?? []), p]));
    return m;
  }, [compiled]);
  const errorCount = compiled.problems.filter((p) => p.severity === 'error').length;

  const appendLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLogs((l) => [...l.slice(-499), { ...entry, id: ++logId.current }]);
  }, []);

  // ── Project loading ──────────────────────────────────────────────────────
  useEffect(() => {
    if (currentProject) return;
    const pid = new URLSearchParams(window.location.search).get('project') || localStorage.getItem('cubot-ide-last-project');
    if (pid) loadProject(pid).catch(() => console.warn('Failed to load project for blocks page:', pid));
  }, [currentProject, loadProject]);

  const applyDocument = useCallback(
    (doc: {
      name: string;
      nodes: Node[];
      edges: Edge[];
      poses: Pose[];
      scene: SceneConfig;
      layout?: CellLayout | null;
      trail?: boolean;
    }) => {
      const nextLayout = cloneLayout(doc.layout ?? DEFAULT_LAYOUT);
      setNodes(doc.nodes);
      setEdges(doc.edges);
      setPoses(doc.poses);
      setScene(doc.scene);
      setLayout(nextLayout);
      setStationId(null);
      setProgramName(doc.name);
      setSelectedId(null);
      world.layout = nextLayout;
      world.reset(doc.scene);
      world.trailEnabled = !!doc.trail;
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    },
    [setNodes, setEdges, world, fitView],
  );

  useEffect(() => {
    if (!currentProject || loadedRef.current) return;
    loadedRef.current = true;
    blocksApi
      .getPrograms(currentProject.id)
      .then((programs) => {
        const latest = [...programs].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];
        baseline.current = 'pending';
        if (!latest) {
          setSaveState('dirty');
          setGalleryOpen(true);
          return;
        }
        setProgramId(latest.id ?? null);
        applyDocument({
          name: latest.name || 'Untitled program',
          nodes: latest.nodes.length ? loadNodes(latest.nodes) : STARTER.nodes,
          edges: latest.nodes.length ? latest.edges.map((e) => ({ ...e })) : STARTER.edges,
          poses: latest.poses?.length ? latest.poses : DEFAULT_POSES,
          scene: latest.settings?.scene ?? DEFAULT_SCENE,
          layout: parseLayout(latest.settings?.layout),
        });
        setSaveState('saved');
      })
      .catch((e) => {
        toast.error(`Could not load block programs: ${e.message}`);
        setSaveState('offline');
      });
  }, [currentProject, applyDocument]);

  // ── Saving ───────────────────────────────────────────────────────────────
  const snapshot = useMemo(
    () =>
      JSON.stringify({
        name: programName,
        nodes: serializeNodes(nodes),
        edges: serializeEdges(edges),
        poses,
        settings: { scene, layout },
      }),
    [programName, nodes, edges, poses, scene, layout],
  );

  const save = useCallback(async () => {
    if (!currentProject) {
      toast.error('Open a project from the dashboard to save programs.');
      return;
    }
    const body = JSON.parse(snapshot);
    setSaveState('saving');
    try {
      if (programId) {
        await blocksApi.updateProgram(programId, body);
      } else {
        const created = await blocksApi.createProgram({ project_id: currentProject.id, ...body });
        setProgramId(created.id ?? null);
      }
      savedSnapshot.current = snapshot;
      setSaveState('saved');
    } catch (e) {
      setSaveState('dirty');
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  }, [currentProject, programId, snapshot]);

  useEffect(() => {
    if (!currentProject || baseline.current === 'waiting') return;
    if (baseline.current === 'pending') {
      baseline.current = 'set';
      savedSnapshot.current = snapshot;
      return;
    }
    if (snapshot === savedSnapshot.current) return;
    setSaveState('dirty');
    const t = setTimeout(save, 1500);
    return () => clearTimeout(t);
  }, [snapshot, currentProject, save]);

  // ── Editing ──────────────────────────────────────────────────────────────
  const deleteNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((s) => (s === id ? null : s));
    },
    [setNodes, setEdges],
  );

  const updateField = useCallback(
    (id: string, key: string, value: string | number) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, [key]: value } } : n))),
    [setNodes],
  );

  const newId = () => `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

  const duplicateNode = useCallback(
    (id: string) => {
      const src = nodes.find((n) => n.id === id);
      if (!src) return;
      const copy: Node = { ...src, id: newId(), position: { x: src.position.x + 40, y: src.position.y + 40 }, data: { ...src.data }, selected: false };
      setNodes((ns) => [...ns, copy]);
      setSelectedId(copy.id);
    },
    [nodes, setNodes],
  );

  // Adds a block below the selected one and wires its free "next" output.
  const addBlock = useCallback(
    (type: string, at?: { x: number; y: number }) => {
      const anchor = nodes.find((n) => n.id === selectedId) ?? [...nodes].sort((a, b) => b.position.y - a.position.y)[0];
      const id = newId();
      const below = anchor ? nodeHeight(anchor.type ?? '', (anchor.data ?? {}) as Record<string, unknown>) + 40 : 0;
      const position = at ?? (anchor ? { x: anchor.position.x, y: anchor.position.y + below } : { x: 0, y: 0 });
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type, position, data: defaultData(type), selected: true }]);
      if (!at && anchor) {
        const port = BLOCK_BY_TYPE[anchor.type ?? '']?.outputs.find((o) => o.id === 'next');
        const taken = edges.some((e) => e.source === anchor.id && (e.sourceHandle ?? 'next') === 'next');
        if (port && !taken) setEdges((es) => [...es, { id: `e${anchor.id}-${id}`, source: anchor.id, sourceHandle: 'next', target: id }]);
      }
      setSelectedId(id);
      setSideTab('properties');
    },
    [nodes, edges, selectedId, setNodes, setEdges],
  );

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((es) =>
        // One connection per output: a new one replaces the old.
        addEdge({ ...c, id: `e${c.source}-${c.sourceHandle}-${c.target}` }, es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)))),
      ),
    [setEdges],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow/type');
      if (!type || !BLOCK_BY_TYPE[type]) return;
      const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addBlock(type, { x: p.x - 115, y: p.y - 20 });
    },
    [screenToFlowPosition, addBlock],
  );

  const styledEdges = useMemo(
    () =>
      edges.map((e) => {
        const color = EDGE_COLORS[e.sourceHandle ?? ''] ?? 'rgba(255,255,255,0.35)';
        const live = activeNodeId !== null && e.target === activeNodeId;
        return {
          ...e,
          type: 'smoothstep',
          pathOptions: { borderRadius: 16 },
          animated: live,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
          style: { stroke: color, strokeWidth: live ? 2.5 : 1.75 },
        };
      }),
    [edges, activeNodeId],
  );

  // ── Running ──────────────────────────────────────────────────────────────
  const run = useCallback(
    async (stepMode = false) => {
      if (running) return;
      if (!compiled.ok) {
        toast.error(`Fix ${errorCount} problem${errorCount === 1 ? '' : 's'} before running (see Problems).`);
        return;
      }
      world.reset(scene, true);
      world.speed = simSpeed;
      setLogs([]);
      setTelemetry([]);
      setVariables({});
      const interp = new Interpreter(world, compiled, poses, {
        onActive: setActiveNodeId,
        onLog: appendLog,
        onTelemetry: (t) => setTelemetry((list) => [...list.slice(-499), { ...t, id: ++logId.current }]),
        onVariables: setVariables,
      });
      interp.stepping = stepMode;
      setStepping(stepMode);
      interpreterRef.current = interp;
      world.onFault((message) => {
        appendLog({ time: world.time, level: 'error', message });
        interp.stop();
      });
      setRunState('running');
      const result = await interp.run();
      interpreterRef.current = null;
      world.onFault(null);
      world.paused = false;
      setRunState('idle');
      setStepping(false);
      if (result.status === 'fault') {
        toast.error(result.message);
        if (result.nodeId) setSelectedId(result.nodeId);
      } else if (result.status === 'done') {
        toast.success('Program finished');
      }
    },
    [running, compiled, errorCount, world, scene, simSpeed, poses, appendLog],
  );

  const stop = useCallback(() => {
    interpreterRef.current?.stop();
    world.abortAll();
    world.paused = false;
    void world.setConveyor(false);
  }, [world]);

  const togglePause = () => {
    world.paused = !world.paused;
    setRunState(world.paused ? 'paused' : 'running');
  };

  const toggleStepping = () => {
    const interp = interpreterRef.current;
    if (!interp) return run(true);
    interp.setStepping(!stepping);
    setStepping(!stepping);
  };

  useEffect(() => {
    world.speed = simSpeed;
  }, [simSpeed, world]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void run();
      } else if (e.key === 'Escape' && running) {
        stop();
      } else if (!typing && e.key === 'F10' && stepping) {
        e.preventDefault();
        interpreterRef.current?.step();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, run, stop, running, stepping]);

  // ── Hardware ─────────────────────────────────────────────────────────────
  const toggleHardware = async () => {
    if (serial) {
      world.link = null;
      await serial.disconnect();
      setSerial(null);
      toast.info('Controller disconnected');
      return;
    }
    if (!SerialLink.supported()) {
      toast.error('Web Serial is not available in this browser. Use Chrome or Edge on desktop.');
      return;
    }
    const link = new SerialLink();
    link.onLine = (dir, line) => setSerialLog((l) => [...l.slice(-299), { dir, line }]);
    link.onClose = () => {
      world.link = null;
      setSerial(null);
    };
    try {
      await link.connect();
      // Bring the arm to the simulator's current pose before mirroring.
      await link.send(`J ${world.joints.map((q) => q.toFixed(1)).join(' ')} 3.00`);
      world.link = link;
      setSerial(link);
      toast.success('Controller connected — motion, gripper and outputs are mirrored to the arm');
    } catch (e) {
      await link.disconnect().catch(() => undefined);
      if ((e as Error).name !== 'NotFoundError') toast.error(`Connection failed: ${(e as Error).message}`);
    }
  };

  // ── Environment ──────────────────────────────────────────────────────────
  const layoutIssues = useMemo(() => validateLayout(layout, poses), [layout, poses]);
  const issueByStation = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const i of layoutIssues) if (m.get(i.stationId) !== 'error') m.set(i.stationId, i.severity);
    return m;
  }, [layoutIssues]);

  const commitLayout = useCallback(
    (next: CellLayout) => {
      setLayout(next);
      world.setLayout(next);
    },
    [world],
  );

  const updateStation = useCallback(
    (id: string, patch: Partial<Station>) => {
      if (running) return;
      const from = layout.stations.find((s) => s.id === id);
      if (!from) return;
      const to = { ...from, ...patch };
      setPoses((ps) => syncPoses(ps, from, to));
      commitLayout({ stations: layout.stations.map((s) => (s.id === id ? to : s)) });
    },
    [layout, running, commitLayout],
  );

  const addStation = (kind: StationKind, base?: Station) => {
    if (running) return;
    const fresh = createStation(kind, layout, poses);
    const s: Station = base
      ? { ...base, id: fresh.id, name: `${base.name} copy`, pose: fresh.pose, ...freeSpot(layout, kind) }
      : { ...fresh, ...freeSpot(layout, kind) };
    const pose = anchorPose(s);
    if (pose) setPoses((ps) => [...ps, pose]);
    commitLayout({ stations: [...layout.stations, s] });
    setStationId(s.id);
    toast.success(`Added ${STATION_KINDS[kind].label.toLowerCase()}${pose ? ` with pose ${pose.name}` : ''}`);
  };

  const importModel = (model: ModelSource) => {
    if (running) return;
    const name = model.file.replace(/\.[^.]+$/, '');
    const fresh = createStation('model', layout, poses);
    const draft: Station = { ...fresh, name, pose: uniquePoseName(name, new Set(poses.map((p) => p.name))), model };
    const s: Station = { ...draft, ...freeSpot(layout, 'model', draft) };
    const pose = anchorPose(s);
    if (pose) setPoses((ps) => [...ps, pose]);
    commitLayout({ stations: [...layout.stations, s] });
    setStationId(s.id);
    const { w, d, h } = modelDims(s);
    toast.success(`Imported ${model.file}`, {
      description: `${Math.round(w)} × ${Math.round(d)} × ${Math.round(h)} mm${pose ? ` · pose ${pose.name} on top` : ''}. Check the units if the size looks wrong.`,
    });
  };

  const removeStation = (id: string) => {
    if (running) return;
    const s = layout.stations.find((t) => t.id === id);
    if (!s) return;
    commitLayout({ stations: layout.stations.filter((t) => t.id !== id) });
    setStationId(null);
    toast(`Removed ${s.name}`, {
      description: s.pose && poses.some((p) => p.name === s.pose) ? `Pose ${s.pose} was kept — delete it in Poses if no block uses it.` : undefined,
      action: { label: 'Undo', onClick: () => commitLayout({ stations: [...layout.stations] }) },
    });
  };

  const applyEnvironment = (next: CellLayout, title: string) => {
    if (running) return;
    const owned = posesForLayout(next).filter((p) => p.name !== 'HOME');
    const names = new Set(owned.map((p) => p.name));
    setPoses((ps) => [...ps.filter((p) => !names.has(p.name)), ...owned]);
    commitLayout(cloneLayout(next));
    setStationId(null);
    toast.success(`Environment “${title}” loaded`, {
      description: owned.length ? `Poses set: ${owned.map((p) => p.name).join(', ')}` : undefined,
    });
  };

  const resetStationPose = (id: string) => {
    const s = layout.stations.find((t) => t.id === id);
    const pose = s && anchorPose(s);
    if (!pose) return;
    setPoses((ps) => (ps.some((p) => p.name === pose.name) ? ps.map((p) => (p.name === pose.name ? pose : p)) : [...ps, pose]));
  };

  // ── Templates & files ────────────────────────────────────────────────────
  const loadTemplate = (t: Template) => {
    if (running) stop();
    const graph = buildTemplateGraph(t.steps);
    applyDocument({
      name: t.title,
      nodes: graph.nodes,
      edges: graph.edges,
      poses: t.layout ? posesForLayout(t.layout) : DEFAULT_POSES,
      scene: t.scene,
      layout: t.layout,
      trail: t.trail,
    });
    setGalleryOpen(false);
    setLogs([]);
    setTelemetry([]);
    toast.success(`Loaded “${t.title}” — press Run`);
  };

  const projectFile = (): ProgramDocument & { nodes: unknown; edges: unknown } => ({
    version: 2,
    name: programName,
    poses,
    settings: { scene, layout },
    nodes: serializeNodes(nodes),
    edges: serializeEdges(edges),
  });

  const importFile = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text());
      if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('not a CuBot Blocks file');
      applyDocument({
        name: String(doc.name ?? file.name.replace(/\.json$/, '')),
        nodes: loadNodes(doc.nodes),
        edges: doc.edges,
        poses: Array.isArray(doc.poses) && doc.poses.length ? doc.poses : DEFAULT_POSES,
        scene: doc.settings?.scene ?? DEFAULT_SCENE,
        layout: parseLayout(doc.settings?.layout),
      });
      toast.success(`Imported ${file.name}`);
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
  };

  const slug = programName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'program';
  const codeFiles: CodeFile[] = codeOpen
    ? [
        {
          id: 'python',
          label: 'Python',
          filename: `${slug}.py`,
          description: 'Standalone program: IK, serial controller, MQTT and OpenCV vision. Try --dry-run first.',
          content: compiled.ok ? generatePython(compiled, poses, programName) : '',
        },
        {
          id: 'firmware',
          label: 'Arduino firmware',
          filename: 'cubot_controller.ino',
          description: 'Servo-arm controller speaking the CuBot serial protocol (used by Python and hardware mode).',
          content: generateFirmware(),
        },
        {
          id: 'json',
          label: 'Project file',
          filename: `${slug}.cubot.json`,
          description: 'Program, poses, scene and environment. Import it with the folder button.',
          content: JSON.stringify(projectFile(), null, 2),
        },
      ]
    : [];

  const selectNode = (id: string) => {
    setSelectedId(id);
    setSideTab('properties');
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    const n = nodes.find((x) => x.id === id);
    if (n) fitView({ nodes: [n], duration: 300, maxZoom: 1.2 });
  };

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const canvasState = useMemo(
    () => ({ activeNodeId, problemsByNode, onDelete: deleteNode, onFieldChange: updateField, poses, running }),
    [activeNodeId, problemsByNode, deleteNode, updateField, poses, running],
  );

  const saveLabel = { saved: 'Saved', dirty: 'Unsaved', saving: 'Saving…', offline: 'Not saved (no project)' }[saveState];

  return (
    <div className="flex h-screen flex-col bg-[#080808] text-foreground">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#0a0a0a] px-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <img src="/cubot.svg" alt="CuBot" className="h-7 w-7 object-contain" />
          <span className="text-sm font-semibold text-white/80">CuBot</span>
        </Link>
        <span className="text-white/15">/</span>
        <span className="font-mono text-xs text-white/35">Blocks</span>
        <input
          value={programName}
          onChange={(e) => setProgramName(e.target.value)}
          className="w-56 rounded border border-transparent bg-transparent px-2 py-1 text-sm text-white/85 hover:border-white/10 focus:border-white/20 focus:outline-none"
        />
        <span className={`text-[10px] ${saveState === 'dirty' ? 'text-amber-300/70' : 'text-white/30'}`}>{saveLabel}</span>

        <div className="ml-4 flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 text-xs text-white/70" onClick={() => setGalleryOpen(true)}>
            <LayoutTemplate size={14} /> Templates
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs text-white/70" onClick={() => setCodeOpen(true)}>
            <Code2 size={14} /> Export
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 px-0 text-white/60" title="Import project file" onClick={() => fileInput.current?.click()}>
            <FolderOpen size={14} />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 px-0 text-white/60" title="Save (⌘S)" onClick={() => void save()}>
            <Save size={14} />
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* Run controls */}
        <div className="mx-auto flex items-center gap-1.5">
          <div
            className={`mr-2 flex items-center gap-1.5 text-[11px] ${errorCount ? 'text-red-300' : 'text-emerald-300/80'}`}
            title={errorCount ? 'See the Problems tab' : 'Program compiles'}
          >
            {errorCount ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
            {errorCount ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : 'Ready'}
          </div>
          {!running ? (
            <Button size="sm" className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-500" onClick={() => void run()} title="Run (⌘↵)">
              <Play size={14} /> Run
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={togglePause}>
              {runState === 'paused' ? <Play size={14} /> : <Pause size={14} />}
              {runState === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className={`h-8 text-xs ${stepping ? 'border-sky-400/50 text-sky-200' : ''}`}
            onClick={() => void toggleStepping()}
            title="Run one block at a time"
          >
            <SkipForward size={14} /> {stepping ? 'Stepping' : 'Step'}
          </Button>
          {stepping && (
            <Button size="sm" className="h-8 bg-sky-600 text-xs text-white hover:bg-sky-500" onClick={() => interpreterRef.current?.step()} title="Next block (F10)">
              Next
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 bg-red-600 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-40"
            onClick={stop}
            disabled={!running}
            title="Emergency stop (Esc)"
          >
            <Square size={13} fill="currentColor" /> STOP
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-white/60"
            disabled={running}
            onClick={() => {
              world.reset(scene);
              setActiveNodeId(null);
            }}
            title="Reset the cell: robot home, parts cleared"
          >
            <RotateCcw size={14} /> Reset cell
          </Button>
          <div className="ml-1 flex items-center gap-1 text-white/45" title="Simulation speed">
            <Gauge size={14} />
            <select
              value={simSpeed}
              onChange={(e) => setSimSpeed(Number(e.target.value))}
              className="rounded border border-white/[0.08] bg-transparent px-1 py-1 text-[11px] text-white/70"
            >
              {[0.5, 1, 2, 5, 10].map((s) => (
                <option key={s} value={s} className="bg-[#111]">
                  {s}×
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          className={`h-8 text-xs ${serial ? 'border-emerald-400/50 text-emerald-200' : ''}`}
          onClick={() => void toggleHardware()}
          disabled={running}
          title="Mirror the program to a real arm over USB (Web Serial)"
        >
          <Usb size={14} /> {serial ? 'Arm connected' : 'Connect arm'}
        </Button>
        <Link href="/dashboard" title="Dashboard">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white/70">
            <Home size={15} />
          </Button>
        </Link>
        {session?.user?.image && (
          <Image src={session.user.image} alt={session.user.name ?? 'User'} width={26} height={26} className="rounded-full border border-white/10" />
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <BlockPalette onAdd={(t) => addBlock(t)} />

        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={58} minSize={30}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={72} minSize={30}>
                <BlocksCanvasContext.Provider value={canvasState}>
                  <div className="h-full" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
                    <ReactFlow
                      nodes={nodes}
                      edges={styledEdges}
                      onNodesChange={onNodesChange}
                      onEdgesChange={onEdgesChange}
                      onConnect={onConnect}
                      onNodeClick={(_, n) => {
                        setSelectedId(n.id);
                        setSideTab('properties');
                      }}
                      onPaneClick={() => setSelectedId(null)}
                      nodeTypes={nodeTypes}
                      nodesDraggable={!running}
                      nodesConnectable={!running}
                      elementsSelectable
                      deleteKeyCode={running ? null : ['Delete', 'Backspace']}
                      onNodesDelete={(ns) => ns.forEach((n) => n.id === selectedId && setSelectedId(null))}
                      fitView
                      fitViewOptions={{ padding: 0.2 }}
                      snapToGrid
                      snapGrid={[10, 10]}
                      // Double-clicking text in an on-node field must not zoom the canvas.
                      zoomOnDoubleClick={false}
                      minZoom={0.2}
                      proOptions={{ hideAttribution: true }}
                      colorMode="dark"
                    >
                      <Background variant={BackgroundVariant.Dots} gap={18} size={1.3} color="#ffffff" style={{ opacity: 0.1 }} />
                      <Panel position="top-left">
                        <button
                          onClick={() => {
                            setNodes((ns) => tidyNodes(ns, edges));
                            setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 30);
                          }}
                          disabled={running}
                          className="flex items-center gap-1.5 rounded-md border border-white/10 bg-[#0d0d10]/90 px-2.5 py-1 text-[11px] text-white/65 shadow hover:border-white/25 hover:text-white disabled:opacity-40"
                          title="Arrange the blocks: sequences top to bottom, branches side by side, loop bodies indented"
                        >
                          <Wand2 size={12} /> Tidy
                        </button>
                      </Panel>
                      <Controls className="!border-white/10 !bg-[#0a0a0a]" />
                      <MiniMap
                        pannable
                        zoomable
                        nodeColor={(n) => CATEGORY_BY_ID[BLOCK_BY_TYPE[n.type ?? '']?.category ?? 'flow']?.accent ?? '#555'}
                        className="!border !border-white/10 !bg-[#0a0a0a]"
                        maskColor="rgba(0,0,0,0.6)"
                      />
                    </ReactFlow>
                  </div>
                </BlocksCanvasContext.Provider>
              </ResizablePanel>
              <ResizableHandle className="h-px bg-white/[0.06]" />
              <ResizablePanel defaultSize={28} minSize={10}>
                <ConsolePanel
                  logs={logs}
                  problems={compiled.problems}
                  variables={variables}
                  telemetry={telemetry}
                  serial={serial ? serialLog : null}
                  onClear={() => {
                    setLogs([]);
                    setTelemetry([]);
                    setSerialLog([]);
                  }}
                  onSelectNode={selectNode}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-white/[0.06]" />

          <ResizablePanel defaultSize={42} minSize={24}>
            <ResizablePanelGroup direction="vertical" className="bg-[#0a0a0a]">
              <ResizablePanel defaultSize={52} minSize={20}>
                <div className="relative h-full">
                  <WorkcellView
                    world={world}
                    layout={layout}
                    editing={sideTab === 'environment' && !running}
                    selectedId={stationId}
                    issues={issueByStation}
                    onSelect={setStationId}
                    onChange={updateStation}
                    onDelete={removeStation}
                  />
                  <div className="pointer-events-none absolute left-3 top-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${runState === 'running' ? 'animate-pulse bg-emerald-400' : runState === 'paused' ? 'bg-amber-400' : 'bg-white/30'}`}
                    />
                    {serial ? 'Simulation + real arm' : 'Simulation'} · {runState}
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle className="h-px bg-white/[0.06]" />
              <ResizablePanel defaultSize={48} minSize={20}>
                <div className="flex h-full flex-col">
                  <div className="flex h-8 shrink-0 items-center gap-1 border-b border-t border-white/[0.08] px-2">
                    {(
                      [
                        ['properties', 'Properties'],
                        ['cell', 'Cell & I/O'],
                        ['environment', 'Environment'],
                        ['poses', 'Poses'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setSideTab(id)}
                        className={`rounded px-2 py-1 text-[11px] ${sideTab === id ? 'bg-white/[0.07] text-white' : 'text-white/45 hover:text-white/70'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {sideTab === 'properties' && (
                      <Inspector
                        node={selectedNode}
                        poses={poses}
                        problems={selectedNode ? (problemsByNode.get(selectedNode.id) ?? []) : []}
                        variables={compiled.variables}
                        disabled={running}
                        onChange={updateField}
                        onDelete={deleteNode}
                        onDuplicate={duplicateNode}
                      />
                    )}
                    {sideTab === 'cell' && (
                      <CellPanel
                        world={world}
                        running={running}
                        scene={scene}
                        onSceneChange={(s) => {
                          setScene(s);
                          world.scene = { ...s };
                        }}
                      />
                    )}
                    {sideTab === 'environment' && (
                      <EnvironmentPanel
                        layout={layout}
                        poses={poses}
                        issues={layoutIssues}
                        selectedId={stationId}
                        disabled={running}
                        onSelect={setStationId}
                        onAdd={(k) => addStation(k)}
                        onChange={updateStation}
                        onDelete={removeStation}
                        onDuplicate={(id) => {
                          const s = layout.stations.find((t) => t.id === id);
                          if (s) addStation(s.kind, s);
                        }}
                        onApply={applyEnvironment}
                        onResetPose={resetStationPose}
                        onImportModel={importModel}
                      />
                    )}
                    {sideTab === 'poses' && <PosesPanel world={world} poses={poses} disabled={running} onChange={setPoses} />}
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <TemplateGallery open={galleryOpen} onOpenChange={setGalleryOpen} onLoad={loadTemplate} />
      {codeOpen && (
        <CodeDialog
          open={codeOpen}
          onOpenChange={setCodeOpen}
          files={codeFiles}
          blocked={compiled.ok ? null : `The program has ${errorCount} error(s). Fix them (see Problems) to generate Python.`}
        />
      )}
    </div>
  );
}

export default function BlocksPage() {
  return (
    <ReactFlowProvider>
      <BlocksIDE />
    </ReactFlowProvider>
  );
}

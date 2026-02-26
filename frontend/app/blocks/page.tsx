'use client';

import { useCallback, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { useArmStatusWebSocket } from '@/hooks/useArmStatusWebSocket';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Node,
  MiniMap,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Play,
  Square,
  Home,
  Settings,
  Trash2,
  RotateCcw,
  GripVertical,
  Save,
  Download,
  Upload,
  Search,
  MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  blockCategories,
  initialNodes as defaultNodes,
  initialEdges as defaultEdges,
} from '@/lib/mock-data';
import { blocksApi, type ArmState } from '@/lib/api/blocks';
import { toast } from 'sonner';
import { useProject } from '@/contexts/project-context';

// Dynamic import for 3D component (client-side only)
const ArmVisualization = dynamic(
  () => import('@/components/blocks/ArmVisualization'),
  { ssr: false }
);

// Import node components
import {
  StartNode,
  EndNode,
  ForNode,
  WhileNode,
  IfNode,
  MovePositionNode,
  MoveJointNode,
  GetPositionNode,
  DelayNode,
  DefaultNode,
} from '@/components/blocks/nodes';

const nodeTypes = {
  start: StartNode,
  end: EndNode,
  for: ForNode,
  while: WhileNode,
  if: IfNode,
  ifelse: IfNode,
  move_position: MovePositionNode,
  move_joint: MoveJointNode,
  get_position: GetPositionNode,
  delay: DelayNode,
  millis: DefaultNode,
};

export default function BlocksPage() {
  const { data: session } = useSession();
  const { currentProject, loadProject } = useProject();
  const projectId = currentProject?.id || 'default';

  // Load project from URL param or localStorage (same pattern as IDE page)
  useEffect(() => {
    if (currentProject) return; // Already loaded
    const urlParams = new URLSearchParams(window.location.search);
    const pid = urlParams.get('project') || localStorage.getItem('cubot-ide-last-project');
    if (pid) {
      loadProject(pid).catch(() => {
        console.warn('Failed to load project for blocks page:', pid);
      });
    }
  }, [currentProject, loadProject]);
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['control', 'loops', 'logic', 'robotics']);
  const [armState, setArmState] = useState<ArmState>({
    position: { x: 0, y: 0, z: 0 },
    joints: [0, 0, 0, 0, 0, 0],
    is_moving: false,
  });
  const [currentProgramId, setCurrentProgramId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [blockSearch, setBlockSearch] = useState('');
  const [isProgramRunning, setIsProgramRunning] = useState(false);

  // Delete node handler
  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    toast.success('Block deleted');
  }, [setNodes, setEdges]);

  // Update node data handler (for controlled inputs inside nodes)
  const onDataChange = useCallback((nodeId: string, updates: Record<string, any>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...updates } } : node
      )
    );
  }, [setNodes]);

  // Save program function
  const saveProgram = useCallback(async () => {
    if (!currentProject) {
      toast.error('No project loaded');
      return;
    }
    if (nodes.length === 0) {
      toast.error('No blocks to save');
      return;
    }

    setIsSaving(true);
    try {
      const programData = {
        project_id: projectId,
        name: 'Block Program',
        nodes: nodes.map(node => {
          // Filter node data to exclude React/XYFlow internal properties
          const cleanData = { ...node.data };
          delete (cleanData as any).onDelete; // Remove callback function

          const blockNode = {
            id: node.id,
            type: node.type || 'default',
            position: {
              x: Number(node.position.x) || 0,
              y: Number(node.position.y) || 0
            },
            data: cleanData,
          };
          return blockNode;
        }),
        edges: edges.map(edge => {
          const blockEdge: any = {
            id: edge.id,
            source: edge.source,
            target: edge.target,
          };
          if (edge.sourceHandle) blockEdge.sourceHandle = edge.sourceHandle;
          if (edge.targetHandle) blockEdge.targetHandle = edge.targetHandle;
          if (edge.style) {
            blockEdge.style = edge.style;
          }
          return blockEdge;
        }),
      };

      console.log('Saving program:', { currentProgramId, programData });
      console.log('Program data JSON:', JSON.stringify(programData, null, 2));

      if (currentProgramId) {
        const result = await blocksApi.updateProgram(currentProgramId, programData);
        console.log('Program updated:', result);
        console.log('Result JSON:', JSON.stringify(result, null, 2));
        toast.success('Workflow saved');
      } else {
        const newProgram = await blocksApi.createProgram(programData);
        console.log('Program created:', newProgram);
        console.log('Created program JSON:', JSON.stringify(newProgram, null, 2));
        setCurrentProgramId(newProgram.id!);
        toast.success('Workflow saved');
      }
    } catch (error: any) {
      console.error('Failed to save program:', error);
      const errorDetail = error?.response?.data?.detail || error?.message || 'Unknown error';
      console.error('Error details:', errorDetail);
      toast.error(`Failed to save: ${errorDetail}`);
    } finally {
      setIsSaving(false);
    }
  }, [nodes, edges, currentProgramId]);

  // Load initial arm state and saved program on mount
  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const state = await blocksApi.getArmState();
        setArmState({
          position: { ...state.position },
          joints: [...state.joints],
          is_moving: state.is_moving,
        });
      } catch (error) {
        console.error('Failed to load initial arm state:', error);
      }
    };

    const loadSavedProgram = async () => {
      if (!currentProject) return; // Wait until real project is loaded
      try {
        // Try to load the most recent program for the current project
        const programs = await blocksApi.getPrograms(projectId);
        console.log('Loaded programs from backend:', JSON.stringify(programs, null, 2));

        if (programs.length > 0) {
          const lastProgram = programs[0]; // Get the first (most recent) program
          setCurrentProgramId(lastProgram.id!);
          console.log('Selected program:', lastProgram.id);

          if (lastProgram.nodes && lastProgram.nodes.length > 0) {
            console.log('Setting nodes:', JSON.stringify(lastProgram.nodes, null, 2));
            // Convert backend nodes to XYFlow nodes with proper structure
            const convertedNodes = lastProgram.nodes.map((node: any) => ({
              id: node.id,
              type: node.type || 'default',
              position: { x: node.position?.x || 0, y: node.position?.y || 0 },
              data: { ...node.data, onDelete: deleteNode, onDataChange },
            }));
            setNodes(convertedNodes);
          }
          if (lastProgram.edges && lastProgram.edges.length > 0) {
            console.log('Setting edges:', JSON.stringify(lastProgram.edges, null, 2));
            // Convert backend edges to XYFlow edges with proper structure
            const convertedEdges = lastProgram.edges.map((edge: any) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              sourceHandle: edge.sourceHandle,
              targetHandle: edge.targetHandle,
              style: edge.style || { strokeWidth: 2 },
            }));
            setEdges(convertedEdges);
          }

          console.log('Loaded and converted saved program:', lastProgram.id);
        } else {
          console.log(`No saved programs found for project ${projectId}`);
        }
      } catch (error: any) {
        const errorDetail = error?.response?.data?.detail || error?.message || 'Unknown error';
        console.error('Failed to load saved program:', errorDetail);
      }
    };

    loadInitialState();
    loadSavedProgram();
  }, [setNodes, setEdges, projectId, currentProject, deleteNode]);

  // WebSocket for arm status updates (opens when program is running)
  useArmStatusWebSocket({
    enabled: isProgramRunning,
    projectId: projectId,
    onStateChange: setArmState,
    onError: (error) => {
      console.error('Arm status error:', error);
      toast.error(error);
    },
  });

  // Log when arm state changes
  useEffect(() => {
    console.log('Arm state updated:', armState);
  }, [armState]);

  // Auto-save on changes (debounced) - only depends on nodes and edges, not saveProgram
  useEffect(() => {
    if (!currentProject || nodes.length === 0) return;

    const debounceTimer = setTimeout(async () => {
      setIsSaving(true);
      try {
        const programData = {
          project_id: projectId,
          name: 'Block Program',
          nodes: nodes.map(node => {
            // Filter node data to exclude React/XYFlow internal properties
            const cleanData = { ...node.data };
            delete (cleanData as any).onDelete; // Remove callback function

            const blockNode = {
              id: node.id,
              type: node.type || 'default',
              position: {
                x: Number(node.position.x) || 0,
                y: Number(node.position.y) || 0
              },
              data: cleanData,
            };
            return blockNode;
          }),
          edges: edges.map(edge => {
            const blockEdge: any = {
              id: edge.id,
              source: edge.source,
              target: edge.target,
            };
            if (edge.sourceHandle) blockEdge.sourceHandle = edge.sourceHandle;
            if (edge.targetHandle) blockEdge.targetHandle = edge.targetHandle;
            if (edge.style) {
              blockEdge.style = edge.style;
            }
            return blockEdge;
          }),
        };

        console.log('Auto-saving program:', { currentProgramId, nodeCount: nodes.length, edgeCount: edges.length });
        console.log('Auto-save program data:', JSON.stringify(programData, null, 2));

        if (currentProgramId) {
          const result = await blocksApi.updateProgram(currentProgramId, programData);
          console.log('Auto-save successful:', result);
          console.log('Auto-save result JSON:', JSON.stringify(result, null, 2));
        } else {
          const newProgram = await blocksApi.createProgram(programData);
          console.log('New program created:', newProgram.id);
          console.log('New auto-save program JSON:', JSON.stringify(newProgram, null, 2));
          setCurrentProgramId(newProgram.id!);
        }
      } catch (error: any) {
        console.error('Failed to auto-save program:', error);
        const errorDetail = error?.response?.data?.detail || error?.message || 'Unknown error';
        console.error('Error details:', errorDetail);
      } finally {
        setIsSaving(false);
      }
    }, 2000);

    return () => clearTimeout(debounceTimer);
  }, [nodes, edges, currentProgramId]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, style: { strokeWidth: 2 } }, eds)),
    [setEdges]
  );

  const onDragStart = (event: React.DragEvent, nodeType: string, label: string) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.setData('application/reactflow/label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow/type');
      const label = event.dataTransfer.getData('application/reactflow/label');

      if (!type) return;

      const reactFlowBounds = event.currentTarget.getBoundingClientRect();
      const position = {
        x: event.clientX - reactFlowBounds.left - 75,
        y: event.clientY - reactFlowBounds.top - 20,
      };

      const newNode: Node = {
        id: `${Date.now()}`,
        type,
        position,
        data: { label, onDelete: deleteNode, onDataChange },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes, deleteNode]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const clearCanvas = () => {
    setNodes([]);
    setEdges([]);
    setCurrentProgramId(null);
  };

  const resetCanvas = () => {
    setNodes(defaultNodes);
    setEdges(defaultEdges);
    setCurrentProgramId(null);
  };

  const runProgram = async () => {
    toast.info('Running program...');
    setIsProgramRunning(true);

    try {
      // Reset arm to starting position
      await blocksApi.resetArm();

      // Find the start node
      const startNode = nodes.find(node => node.type === 'start');
      if (!startNode) {
        toast.error('No START block found');
        setIsProgramRunning(false);
        return;
      }

      // Execute blocks in sequence
      await executeNode(startNode.id);

      toast.success('Program executed successfully');
    } catch (error) {
      console.error('Program execution error:', error);
      toast.error('Failed to run program');
    } finally {
      setIsProgramRunning(false);
    }
  };

  const executeNode = async (nodeId: string): Promise<void> => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Execute the current node
    switch (node.type) {
      case 'move_position': {
        const x = (node.data.x as number) ?? 0;
        const y = (node.data.y as number) ?? 0;
        const z = (node.data.z as number) ?? 0;

        toast.info(`Moving to position (${x}, ${y}, ${z})`);
        await blocksApi.moveArmPosition(x, y, z);

        let isMoving = true;
        while (isMoving) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const state = await blocksApi.getArmState();
          setArmState({ position: { ...state.position }, joints: [...state.joints], is_moving: state.is_moving });
          isMoving = state.is_moving;
        }
        toast.success(`Reached position (${x}, ${y}, ${z})`);
        break;
      }

      case 'move_joint': {
        const joint = (node.data.joint as number) ?? 1;
        const angle = (node.data.angle as number) ?? 0;

        toast.info(`Moving joint ${joint} to ${angle}°`);
        await blocksApi.moveArmJoint(joint, angle);

        let isMoving = true;
        while (isMoving) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const state = await blocksApi.getArmState();
          setArmState({ position: { ...state.position }, joints: [...state.joints], is_moving: state.is_moving });
          isMoving = state.is_moving;
        }
        toast.success(`Joint ${joint} reached ${angle}°`);
        break;
      }

      case 'delay': {
        const ms = (node.data.ms as number) ?? 1000;
        toast.info(`Waiting ${ms}ms...`);
        await new Promise(resolve => setTimeout(resolve, ms));
        break;
      }

      case 'for': {
        const count = (node.data.count as number) ?? 10;
        const nextEdge = edges.find(e => e.source === nodeId);
        if (nextEdge) {
          for (let i = 0; i < count; i++) {
            toast.info(`Loop iteration ${i + 1}/${count}`);
            await executeNode(nextEdge.target);
          }
          return;
        }
        break;
      }

      case 'end':
        toast.success('Reached END block');
        return;
    }

    // Find and execute the next connected node
    const nextEdge = edges.find(e => e.source === nodeId);
    if (nextEdge) {
      await executeNode(nextEdge.target);
    }
  };

  const stopProgram = () => {
    setIsProgramRunning(false);
    toast.info('Program stopped');
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Top Bar */}
      <header className="h-14 border-b border-white/[0.08] flex items-center justify-between px-4 bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <img src="/cubot.svg" alt="CuBot" className="w-8 h-8 object-contain" />

            <span className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">CuBot</span>
          </Link>
          <span className="text-white/[0.12]">·</span>
          <span className="text-xs text-white/30 font-mono">Blocks</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-black border border-white/80 text-white hover:bg-white/10 hover:border-white"
            onClick={saveProgram}
            disabled={isSaving}
          >
            <Save size={14} />
            {isSaving ? 'SAVING...' : 'SAVE'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-black border border-white/20"
            onClick={runProgram}
          >
            <Play size={14} />
            RUN
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-black border border-white/20"
            onClick={stopProgram}
          >
            <Square size={14} />
            STOP
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-black border border-white/20"
            onClick={resetCanvas}
          >
            <RotateCcw size={14} />
            RESET
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-black border border-white/20"
            onClick={clearCanvas}
          >
            <Trash2 size={14} />
            CLEAR
          </Button>
          {isSaving && (
            <span className="text-[10px] text-white/40 flex items-center gap-1">
              <Save size={12} className="animate-pulse" />
              Saving
            </span>
          )}
          <Link href="/dashboard" title="Back to Dashboard">
            <Button variant="ghost" size="icon" className="text-white/40 hover:text-white/60">
              <Home size={16} />
            </Button>
          </Link>
          {session?.user?.image && (
            <Image
              src={session.user.image}
              alt={session.user.name ?? 'User'}
              width={28}
              height={28}
              className="rounded-full border border-white/10"
            />
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Block Categories Sidebar */}
        <aside className="w-64 border-r border-white/[0.08] flex flex-col bg-[#0a0a0a]">
          <div className="p-3 border-b border-white/[0.08] space-y-2">
            <span className="font-black text-xs block text-white/60">BLOCKS</span>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/20" />
              <input
                type="text"
                placeholder="Search..."
                value={blockSearch}
                onChange={(e) => setBlockSearch(e.target.value.toLowerCase())}
                className="w-full pl-8 pr-2 py-1.5 text-xs bg-white/[0.03] border border-white/[0.08] rounded focus:outline-none focus:border-white/20 text-foreground placeholder:text-white/20"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="py-1">
              {blockCategories.map((category) => {
                const filteredBlocks = blockSearch
                  ? category.blocks.filter(b => b.label.toLowerCase().includes(blockSearch))
                  : category.blocks;

                if (blockSearch && filteredBlocks.length === 0) return null;

                return (
                  <div key={category.id} className="border-b border-white/[0.04]">
                    <button
                      onClick={() => toggleCategory(category.id)}
                      className="w-full px-3 py-2 flex items-center justify-between font-black text-xs hover:bg-white/[0.03] transition-colors text-white/60"
                    >
                      <span>{category.name}</span>
                      <span className="text-white/30">
                        {expandedCategories.includes(category.id) ? '−' : '+'}
                      </span>
                    </button>
                    {expandedCategories.includes(category.id) && (
                      <div className="px-2 pb-2 space-y-1.5">
                        {filteredBlocks.map((block) => (
                          <div
                            key={block.type}
                            draggable
                            onDragStart={(e) => onDragStart(e, block.type, block.label)}
                            className={`${block.color} px-2 py-1.5 flex items-center gap-1.5 cursor-grab active:cursor-grabbing text-xs font-semibold hover:opacity-80 transition-opacity rounded border border-white/10`}
                          >
                            <GripVertical size={12} className="opacity-40" />
                            <span>{block.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </aside>

        {/* Resizable Canvas and Arm Visualization */}
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* React Flow Canvas */}
          <ResizablePanel defaultSize={65} minSize={30}>
            <div className="h-full bg-[#080808]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                deleteKeyCode={['Delete', 'Backspace']}
                onDrop={onDrop}
                onDragOver={onDragOver}
                nodeTypes={nodeTypes}
                fitView
                snapToGrid
                snapGrid={[15, 15]}
                defaultEdgeOptions={{
                  style: {
                    strokeWidth: 2.5,
                    stroke: 'var(--primary)',
                    opacity: 0.8,
                  },
                  type: 'bezier',
                  animated: true,
                  markerEnd: { type: 'arrow' },
                }}
              >
                <Controls className="border border-white/[0.10] bg-[#0a0a0a] shadow-xl rounded-lg" />
                <Background gap={20} size={2} color="#ffffff" style={{ opacity: 0.15 }} />
                <MiniMap
                  nodeColor={(node) => {
                    switch (node.type) {
                      case 'start': return '#10b981';
                      case 'end': return '#ef4444';
                      case 'if':
                      case 'ifelse': return '#0ea5e9';
                      case 'for':
                      case 'while': return '#f59e0b';
                      case 'move_position':
                      case 'move_joint':
                      case 'get_position': return '#8b5cf6';
                      case 'delay': return '#84cc16';
                      default: return '#6b7280';
                    }
                  }}
                  className="border border-white/[0.10] bg-[#0a0a0a] shadow-xl rounded-lg"
                  style={{ backgroundColor: '#0a0a0a' }}
                />
              </ReactFlow>
            </div>
          </ResizablePanel>

          {/* Arm Visualization Sidebar */}
          <ResizableHandle withHandle className="w-px bg-white/[0.06] hover:bg-white/[0.15] transition-colors" />
          <ResizablePanel defaultSize={35} minSize={20} maxSize={60}>
            <div className="h-full flex flex-col bg-[#0a0a0a]">
              <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-black text-sm">ARM STATE</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs ${armState.is_moving ? 'bg-amber-400/10 border border-amber-400/30 text-amber-300' : 'bg-emerald-400/10 border border-emerald-400/30 text-emerald-300'}`}>
                    <span className={`w-2 h-2 rounded-full ${armState.is_moving ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></span>
                    {armState.is_moving ? 'MOVING' : 'READY'}
                  </div>
                </div>
              </div>
              <div className="flex-1">
                <ArmVisualization position={armState.position} joints={armState.joints} />
              </div>
              <div className="p-3 border-t border-white/[0.08]">
                <ScrollArea className="h-full max-h-48">
                  <div className="text-xs space-y-1 font-mono pr-3">
                    <div className="font-bold mb-2">POSITION:</div>
                    <div>X: {armState.position.x.toFixed(2)}</div>
                    <div>Y: {armState.position.y.toFixed(2)}</div>
                    <div>Z: {armState.position.z.toFixed(2)}</div>
                    
                    <div className="font-bold mt-2 mb-1">JOINTS:</div>
                    {armState.joints.map((angle, i) => (
                      <div key={i}>J{i + 1}: {angle.toFixed(1)}°</div>
                    ))}
                    
                    <div className="font-bold mt-3 mb-1">QUICK TEST:</div>
                    <div className="flex gap-1 flex-wrap mb-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2"
                        onClick={async () => {
                          try {
                            console.log('Moving J1 to 45°...');
                            const result = await blocksApi.moveArmJoint(1, 45);
                            console.log('Move result:', result);
                            const state = await blocksApi.getArmState();
                            console.log('New arm state:', state);
                            // Force new object references
                            setArmState({
                              position: { ...state.position },
                              joints: [...state.joints],
                              is_moving: state.is_moving
                            });
                            toast.success('J1 → 45°');
                          } catch (error) {
                            console.error('Failed to move joint:', error);
                            toast.error('Failed to move joint');
                          }
                        }}
                      >
                        J1:45°
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2"
                        onClick={async () => {
                          try {
                            console.log('Moving J2 to 30°...');
                            await blocksApi.moveArmJoint(2, 30);
                            const state = await blocksApi.getArmState();
                            console.log('New arm state:', state);
                            // Force new object references
                            setArmState({
                              position: { ...state.position },
                              joints: [...state.joints],
                              is_moving: state.is_moving
                            });
                            toast.success('J2 → 30°');
                          } catch (error) {
                            console.error('Failed to move joint:', error);
                            toast.error('Failed to move joint');
                          }
                        }}
                      >
                        J2:30°
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2"
                        onClick={async () => {
                          try {
                            console.log('Resetting arm...');
                            await blocksApi.resetArm();
                            const state = await blocksApi.getArmState();
                            console.log('New arm state:', state);
                            // Force new object references
                            setArmState({
                              position: { ...state.position },
                              joints: [...state.joints],
                              is_moving: state.is_moving
                            });
                            toast.success('Arm reset');
                          } catch (error) {
                            console.error('Failed to reset:', error);
                            toast.error('Failed to reset');
                          }
                        }}
                      >
                        Reset
                      </Button>
                    </div>
                    
                    <div className="text-[9px] font-bold mb-1 text-emerald-600 dark:text-emerald-400">IK POSITIONS:</div>
                    <div className="flex gap-1 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2"
                        onClick={async () => {
                          try {
                            console.log('Moving to forward position...');
                            await blocksApi.moveArmPosition(0, 2, 1.5);
                            const state = await blocksApi.getArmState();
                            setArmState({
                              position: { ...state.position },
                              joints: [...state.joints],
                              is_moving: state.is_moving
                            });
                            toast.success('Forward');
                          } catch (error: any) {
                            console.error('Failed:', error);
                            toast.error(error.message || 'Unreachable');
                          }
                        }}
                      >
                        Forward
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2"
                        onClick={async () => {
                          try {
                            console.log('Moving to up position...');
                            await blocksApi.moveArmPosition(0, 3, 0);
                            const state = await blocksApi.getArmState();
                            setArmState({
                              position: { ...state.position },
                              joints: [...state.joints],
                              is_moving: state.is_moving
                            });
                            toast.success('Up');
                          } catch (error: any) {
                            console.error('Failed:', error);
                            toast.error(error.message || 'Unreachable');
                          }
                        }}
                      >
                        Up
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2"
                        onClick={async () => {
                          try {
                            console.log('Moving to side position...');
                            await blocksApi.moveArmPosition(1.5, 1.5, 0);
                            const state = await blocksApi.getArmState();
                            setArmState({
                              position: { ...state.position },
                              joints: [...state.joints],
                              is_moving: state.is_moving
                            });
                            toast.success('Side');
                          } catch (error: any) {
                            console.error('Failed:', error);
                            toast.error(error.message || 'Unreachable');
                          }
                        }}
                      >
                        Side
                      </Button>
                    </div>
                    
                    <div className="font-bold mt-3 mb-1 text-amber-600 dark:text-amber-400">LIMITATIONS:</div>
                    <div className="text-[10px] leading-relaxed space-y-1 text-muted-foreground">
                      <div>• Joint Range: -180° to +180°</div>
                      <div>• Position Range: ±5 units</div>
                      <div>• Max Reach: ~3.2 units</div>
                      <div>• 6-DOF arm with IK</div>
                      <div>• No collision detection</div>
                      <div>• Simplified kinematics</div>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

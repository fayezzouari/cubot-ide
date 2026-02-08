'use client';

import { useCallback, useState, useEffect } from 'react';
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
  Handle,
  Position,
  NodeProps,
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

// Dynamic import for 3D component (client-side only)
const ArmVisualization = dynamic(
  () => import('@/components/blocks/ArmVisualization'),
  { ssr: false }
);

// Custom node components
function StartNode({ data }: NodeProps) {
  return (
    <div className="px-6 py-3 bg-emerald-100 dark:bg-emerald-900/50 border-2 border-emerald-600 dark:border-emerald-400 text-emerald-800 dark:text-emerald-200 font-bold text-sm min-w-[120px] text-center shadow-md">
      <div>{data.label as string}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-emerald-600 dark:bg-emerald-400 border-2 border-background"
      />
    </div>
  );
}

function EndNode({ data }: NodeProps) {
  return (
    <div className="px-6 py-3 bg-rose-100 dark:bg-rose-900/50 border-2 border-rose-600 dark:border-rose-400 text-rose-800 dark:text-rose-200 font-bold text-sm min-w-[120px] text-center shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-rose-600 dark:bg-rose-400 border-2 border-background"
      />
      <div>{data.label as string}</div>
    </div>
  );
}

function ForNode({ data }: NodeProps) {
  return (
    <div className="bg-amber-100 dark:bg-amber-900/50 border-2 border-amber-600 dark:border-amber-400 text-amber-900 dark:text-amber-100 min-w-[150px] shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-amber-600 dark:bg-amber-400 border-2 border-background"
      />
      <div className="px-4 py-2 border-b border-amber-300 dark:border-amber-600 font-bold text-sm bg-amber-200/50 dark:bg-amber-800/50">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium">
        <div className="flex items-center gap-2">
          <span>i = 0 to</span>
          <input
            type="number"
            defaultValue={10}
            className="w-12 px-1 py-0.5 bg-white dark:bg-amber-950 border border-amber-400 dark:border-amber-500 text-amber-900 dark:text-amber-100 text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-amber-600 dark:bg-amber-400 border-2 border-background"
      />
    </div>
  );
}

function WhileNode({ data }: NodeProps) {
  return (
    <div className="bg-amber-100 dark:bg-amber-900/50 border-2 border-amber-600 dark:border-amber-400 text-amber-900 dark:text-amber-100 min-w-[150px] shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-amber-600 dark:bg-amber-400 border-2 border-background"
      />
      <div className="px-4 py-2 border-b border-amber-300 dark:border-amber-600 font-bold text-sm bg-amber-200/50 dark:bg-amber-800/50">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium">
        <div className="flex items-center gap-2">
          <span>condition:</span>
          <input
            type="text"
            defaultValue="true"
            className="flex-1 px-1 py-0.5 bg-white dark:bg-amber-950 border border-amber-400 dark:border-amber-500 text-amber-900 dark:text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-amber-600 dark:bg-amber-400 border-2 border-background"
      />
    </div>
  );
}

function IfNode({ data }: NodeProps) {
  return (
    <div className="bg-sky-100 dark:bg-sky-900/50 border-2 border-sky-600 dark:border-sky-400 text-sky-900 dark:text-sky-100 min-w-[150px] shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-sky-600 dark:bg-sky-400 border-2 border-background"
      />
      <div className="px-4 py-2 border-b border-sky-300 dark:border-sky-600 font-bold text-sm bg-sky-200/50 dark:bg-sky-800/50">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium">
        <div className="flex items-center gap-2">
          <span>if</span>
          <input
            type="text"
            defaultValue="x > 0"
            className="flex-1 px-1 py-0.5 bg-white dark:bg-sky-950 border border-sky-400 dark:border-sky-500 text-sky-900 dark:text-sky-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="w-3 h-3 bg-sky-600 dark:bg-sky-400 border-2 border-background"
        style={{ left: '30%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="w-3 h-3 bg-sky-600 dark:bg-sky-400 border-2 border-background"
        style={{ left: '70%' }}
      />
    </div>
  );
}

function MovePositionNode({ data }: NodeProps) {
  return (
    <div className="bg-violet-100 dark:bg-violet-900/50 border-2 border-violet-600 dark:border-violet-400 text-violet-900 dark:text-violet-100 min-w-[180px] shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-violet-600 dark:bg-violet-400 border-2 border-background"
      />
      <div className="px-4 py-2 border-b border-violet-300 dark:border-violet-600 font-bold text-sm bg-violet-200/50 dark:bg-violet-800/50">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-6">X:</span>
          <input
            type="number"
            defaultValue={0}
            step="0.01"
            min="-5"
            max="5"
            className="flex-1 px-1 py-0.5 bg-white dark:bg-violet-950 border border-violet-400 dark:border-violet-500 text-violet-900 dark:text-violet-100 text-center focus:outline-none focus:ring-1 focus:ring-violet-500"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6">Y:</span>
          <input
            type="number"
            defaultValue={0}
            step="0.01"
            min="-5"
            max="5"
            className="flex-1 px-1 py-0.5 bg-white dark:bg-violet-950 border border-violet-400 dark:border-violet-500 text-violet-900 dark:text-violet-100 text-center focus:outline-none focus:ring-1 focus:ring-violet-500"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6">Z:</span>
          <input
            type="number"
            defaultValue={0}
            step="0.01"
            min="-5"
            max="5"
            className="flex-1 px-1 py-0.5 bg-white dark:bg-violet-950 border border-violet-400 dark:border-violet-500 text-violet-900 dark:text-violet-100 text-center focus:outline-none focus:ring-1 focus:ring-violet-500"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="text-[9px] text-violet-600 dark:text-violet-300 mt-1 opacity-70">
          Range: ±5 units
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-violet-600 dark:bg-violet-400 border-2 border-background"
      />
    </div>
  );
}

function MoveJointNode({ data }: NodeProps) {
  return (
    <div className="bg-violet-100 dark:bg-violet-900/50 border-2 border-violet-600 dark:border-violet-400 text-violet-900 dark:text-violet-100 min-w-[180px] shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-violet-600 dark:bg-violet-400 border-2 border-background"
      />
      <div className="px-4 py-2 border-b border-violet-300 dark:border-violet-600 font-bold text-sm bg-violet-200/50 dark:bg-violet-800/50">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium space-y-1.5">
        <div className="flex items-center gap-2">
          <span>JOINT:</span>
          <select
            defaultValue="1"
            className="flex-1 px-1 py-0.5 bg-white dark:bg-violet-950 border border-violet-400 dark:border-violet-500 text-violet-900 dark:text-violet-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
            onClick={(e) => e.stopPropagation()}
          >
            <option value="1">Joint 1</option>
            <option value="2">Joint 2</option>
            <option value="3">Joint 3</option>
            <option value="4">Joint 4</option>
            <option value="5">Joint 5</option>
            <option value="6">Joint 6</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span>ANGLE:</span>
          <input
            type="number"
            defaultValue={0}
            step="1"
            min="-180"
            max="180"
            className="flex-1 px-1 py-0.5 bg-white dark:bg-violet-950 border border-violet-400 dark:border-violet-500 text-violet-900 dark:text-violet-100 text-center focus:outline-none focus:ring-1 focus:ring-violet-500"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="text-[10px]">°</span>
        </div>
        <div className="text-[9px] text-violet-600 dark:text-violet-300 mt-1 opacity-70">
          Range: -180° to +180°
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-violet-600 dark:bg-violet-400 border-2 border-background"
      />
    </div>
  );
}

function GetPositionNode({ data }: NodeProps) {
  return (
    <div className="bg-indigo-100 dark:bg-indigo-900/50 border-2 border-indigo-600 dark:border-indigo-400 text-indigo-900 dark:text-indigo-100 min-w-[180px] shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-indigo-600 dark:bg-indigo-400 border-2 border-background"
      />
      <div className="px-4 py-2 border-b border-indigo-300 dark:border-indigo-600 font-bold text-sm bg-indigo-200/50 dark:bg-indigo-800/50">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium">
        <div className="flex items-center gap-2">
          <span>Returns current X, Y, Z position</span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-indigo-600 dark:bg-indigo-400 border-2 border-background"
      />
    </div>
  );
}

function DelayNode({ data }: NodeProps) {
  return (
    <div className="bg-lime-100 dark:bg-lime-900/50 border-2 border-lime-600 dark:border-lime-400 text-lime-900 dark:text-lime-100 min-w-[150px] shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-lime-600 dark:bg-lime-400 border-2 border-background"
      />
      <div className="px-4 py-2 border-b border-lime-300 dark:border-lime-600 font-bold text-sm bg-lime-200/50 dark:bg-lime-800/50">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium">
        <div className="flex items-center gap-2">
          <span>MS:</span>
          <input
            type="number"
            defaultValue={1000}
            className="flex-1 px-1 py-0.5 bg-white dark:bg-lime-950 border border-lime-400 dark:border-lime-500 text-lime-900 dark:text-lime-100 text-center focus:outline-none focus:ring-1 focus:ring-lime-500"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-lime-600 dark:bg-lime-400 border-2 border-background"
      />
    </div>
  );
}

function DefaultNode({ data }: NodeProps) {
  return (
    <div className="px-6 py-3 bg-slate-100 dark:bg-slate-800 border-2 border-slate-400 dark:border-slate-500 text-slate-800 dark:text-slate-200 font-bold text-sm min-w-[120px] text-center shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-slate-500 border-2 border-background"
      />
      <div>{data.label as string}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-slate-500 border-2 border-background"
      />
    </div>
  );
}

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

  // Load arm state
  useEffect(() => {
    const loadArmState = async () => {
      try {
        const state = await blocksApi.getArmState();
        setArmState(state);
      } catch (error) {
        console.error('Failed to load arm state:', error);
      }
    };
    loadArmState();

    // Poll arm state every 500ms
    const interval = setInterval(loadArmState, 500);
    return () => clearInterval(interval);
  }, []);

  // Auto-save on changes
  useEffect(() => {
    const saveProgram = async () => {
      if (nodes.length === 0) return;
      
      setIsSaving(true);
      try {
        const programData = {
          project_id: 'default', // You can make this dynamic
          name: 'Block Program',
          nodes: nodes.map(node => ({
            id: node.id,
            type: node.type || 'default',
            position: node.position,
            data: node.data,
          })),
          edges: edges.map(edge => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle || undefined,
            targetHandle: edge.targetHandle || undefined,
            style: edge.style,
          })),
        };

        if (currentProgramId) {
          await blocksApi.updateProgram(currentProgramId, programData);
        } else {
          const newProgram = await blocksApi.createProgram(programData);
          setCurrentProgramId(newProgram.id!);
        }
      } catch (error) {
        console.error('Failed to save program:', error);
      } finally {
        setIsSaving(false);
      }
    };

    const debounceTimer = setTimeout(saveProgram, 1000);
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
        data: { label },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
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
    // Simulate running through blocks and updating arm
    try {
      await blocksApi.resetArm();
      const state = await blocksApi.getArmState();
      setArmState(state);
      toast.success('Program executed successfully');
    } catch (error) {
      toast.error('Failed to run program');
    }
  };

  const stopProgram = () => {
    toast.info('Program stopped');
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Top Bar */}
      <header className="h-14 border-b-4 border-foreground flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary border-2 border-foreground flex items-center justify-center">
              <span className="text-primary-foreground font-black text-sm">⚙</span>
            </div>
            <span className="font-serif text-xl font-black">CUBOT BLOCKS</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="border-2 border-foreground font-black" onClick={runProgram}>
            <Play size={14} />
            RUN
          </Button>
          <Button variant="outline" size="sm" className="border-2 border-foreground font-black" onClick={stopProgram}>
            <Square size={14} />
            STOP
          </Button>
          <Button variant="outline" size="sm" className="border-2 border-foreground font-black" onClick={resetCanvas}>
            <RotateCcw size={14} />
            RESET
          </Button>
          <Button variant="outline" size="sm" className="border-2 border-foreground font-black" onClick={clearCanvas}>
            <Trash2 size={14} />
            CLEAR
          </Button>
          {isSaving && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Save size={12} className="animate-pulse" />
              Saving...
            </span>
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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Block Categories Sidebar */}
        <aside className="w-64 border-r-4 border-foreground flex flex-col">
          <div className="p-3 border-b-2 border-foreground">
            <span className="font-black text-sm">BLOCKS</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="py-2">
              {blockCategories.map((category) => (
                <div key={category.id} className="border-b border-muted">
                  <button
                    onClick={() => toggleCategory(category.id)}
                    className="w-full px-4 py-3 flex items-center justify-between font-black text-sm hover:bg-muted transition-colors"
                  >
                    <span>{category.name}</span>
                    <span className="text-muted-foreground">
                      {expandedCategories.includes(category.id) ? '−' : '+'}
                    </span>
                  </button>
                  {expandedCategories.includes(category.id) && (
                    <div className="px-3 pb-3 space-y-2">
                      {category.blocks.map((block) => (
                        <div
                          key={block.type}
                          draggable
                          onDragStart={(e) => onDragStart(e, block.type, block.label)}
                          className={`${block.color} border-2 px-3 py-2 flex items-center gap-2 cursor-grab active:cursor-grabbing font-medium text-sm shadow-sm hover:shadow-md transition-all`}
                        >
                          <GripVertical size={14} className="opacity-60" />
                          <span>{block.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Resizable Canvas and Arm Visualization */}
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* React Flow Canvas */}
          <ResizablePanel defaultSize={65} minSize={30}>
            <div className="h-full">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onDrop={onDrop}
                onDragOver={onDragOver}
                nodeTypes={nodeTypes}
                fitView
                snapToGrid
                snapGrid={[15, 15]}
                defaultEdgeOptions={{
                  style: { strokeWidth: 2, stroke: 'var(--muted-foreground)' },
                  type: 'smoothstep',
                }}
              >
                <Controls className="border border-border bg-background shadow-sm" />
                <Background gap={20} size={1} color="var(--muted-foreground)" style={{ opacity: 0.3 }} />
              </ReactFlow>
            </div>
          </ResizablePanel>

          {/* Arm Visualization Sidebar */}
          <ResizableHandle withHandle className="border-l-4 border-foreground" />
          <ResizablePanel defaultSize={35} minSize={20} maxSize={60}>
            <div className="h-full flex flex-col">
              <div className="p-3 border-b-2 border-foreground flex items-center justify-between">
                <span className="font-black text-sm">ARM VISUALIZATION</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${armState.is_moving ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'}`}>
                    {armState.is_moving ? 'MOVING' : 'READY'}
                  </span>
                </div>
              </div>
              <div className="flex-1">
                <ArmVisualization position={armState.position} joints={armState.joints} />
              </div>
              <div className="p-3 border-t-2 border-foreground bg-muted/50">
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
                    
                    <div className="font-bold mt-3 mb-1 text-amber-600 dark:text-amber-400">LIMITATIONS:</div>
                    <div className="text-[10px] leading-relaxed space-y-1 text-muted-foreground">
                      <div>• Joint Range: -180° to +180°</div>
                      <div>• Position Range: ±5 units</div>
                      <div>• Max Reach: ~4 units</div>
                      <div>• 6-DOF arm simulation</div>
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

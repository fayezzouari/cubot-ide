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

  // Delete node handler
  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    toast.success('Block deleted');
  }, [setNodes, setEdges]);

  // Load arm state
  useEffect(() => {
    const loadArmState = async () => {
      try {
        const state = await blocksApi.getArmState();
        console.log('Loaded arm state:', state);
        // Force a new object to trigger re-render
        setArmState({
          position: { ...state.position },
          joints: [...state.joints],
          is_moving: state.is_moving
        });
      } catch (error) {
        console.error('Failed to load arm state:', error);
      }
    };
    loadArmState();

    // Poll arm state every 500ms
    const interval = setInterval(loadArmState, 500);
    return () => clearInterval(interval);
  }, []);

  // Log when arm state changes
  useEffect(() => {
    console.log('Arm state updated:', armState);
  }, [armState]);

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
        data: { label, onDelete: deleteNode },
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
    
    try {
      // Reset arm to starting position
      await blocksApi.resetArm();
      
      // Find the start node
      const startNode = nodes.find(node => node.type === 'start');
      if (!startNode) {
        toast.error('No START block found');
        return;
      }
      
      // Execute blocks in sequence
      await executeNode(startNode.id);
      
      toast.success('Program executed successfully');
    } catch (error) {
      console.error('Program execution error:', error);
      toast.error('Failed to run program');
    }
  };

  const executeNode = async (nodeId: string): Promise<void> => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Execute the current node
    switch (node.type) {
      case 'move_position': {
        // Get X, Y, Z values from the node's DOM inputs
        const nodeElement = document.querySelector(`[data-id="${nodeId}"]`);
        if (nodeElement) {
          const inputs = nodeElement.querySelectorAll('input[type="number"]');
          const x = parseFloat((inputs[0] as HTMLInputElement)?.value || '0');
          const y = parseFloat((inputs[1] as HTMLInputElement)?.value || '0');
          const z = parseFloat((inputs[2] as HTMLInputElement)?.value || '0');
          
          toast.info(`Moving to position (${x}, ${y}, ${z})`);
          
          // Start the movement
          await blocksApi.moveArmPosition(x, y, z);
          
          // Poll arm state until movement is complete
          let isMoving = true;
          while (isMoving) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms
            const state = await blocksApi.getArmState();
            // Force new object references to trigger re-render
            setArmState({
              position: { ...state.position },
              joints: [...state.joints],
              is_moving: state.is_moving
            });
            isMoving = state.is_moving;
          }
          
          toast.success(`Reached position (${x}, ${y}, ${z})`);
        }
        break;
      }
      
      case 'move_joint': {
        // Get joint and angle values from the node's DOM inputs
        const nodeElement = document.querySelector(`[data-id="${nodeId}"]`);
        if (nodeElement) {
          const select = nodeElement.querySelector('select') as HTMLSelectElement;
          const input = nodeElement.querySelector('input[type="number"]') as HTMLInputElement;
          const joint = parseInt(select?.value || '1');
          const angle = parseFloat(input?.value || '0');
          
          toast.info(`Moving joint ${joint} to ${angle}°`);
          
          // Start the movement
          await blocksApi.moveArmJoint(joint, angle);
          
          // Poll arm state until movement is complete
          let isMoving = true;
          while (isMoving) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms
            const state = await blocksApi.getArmState();
            // Force new object references to trigger re-render
            setArmState({
              position: { ...state.position },
              joints: [...state.joints],
              is_moving: state.is_moving
            });
            isMoving = state.is_moving;
          }
          
          toast.success(`Joint ${joint} reached ${angle}°`);
        }
        break;
      }
      
      case 'delay': {
        // Get delay value from the node's DOM input
        const nodeElement = document.querySelector(`[data-id="${nodeId}"]`);
        if (nodeElement) {
          const input = nodeElement.querySelector('input[type="number"]') as HTMLInputElement;
          const ms = parseInt(input?.value || '1000');
          
          toast.info(`Waiting ${ms}ms...`);
          await new Promise(resolve => setTimeout(resolve, ms));
        }
        break;
      }
      
      case 'for': {
        // Get loop count from the node's DOM input
        const nodeElement = document.querySelector(`[data-id="${nodeId}"]`);
        if (nodeElement) {
          const input = nodeElement.querySelector('input[type="number"]') as HTMLInputElement;
          const count = parseInt(input?.value || '10');
          
          // Find the next node in the loop
          const nextEdge = edges.find(e => e.source === nodeId);
          if (nextEdge) {
            for (let i = 0; i < count; i++) {
              toast.info(`Loop iteration ${i + 1}/${count}`);
              await executeNode(nextEdge.target);
            }
            return; // Don't continue after loop
          }
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
    toast.info('Program stopped');
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Top Bar */}
      <header className="h-14 border-b border-white/[0.08] flex items-center justify-between px-4 bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-white/5 border border-white/10 flex items-center justify-center rounded">
              <span className="text-foreground font-black text-sm">⚙</span>
            </div>
            <span className="font-black text-sm">BLOCKS</span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
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
          <Button variant="ghost" size="icon" className="text-white/40 hover:text-white/60">
            <Settings size={16} />
          </Button>
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-white/40 hover:text-white/60">
              <Home size={16} />
            </Button>
          </Link>
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

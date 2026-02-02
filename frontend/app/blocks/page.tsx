'use client';

import { useCallback, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  blockCategories,
  initialNodes as defaultNodes,
  initialEdges as defaultEdges,
} from '@/lib/mock-data';

// Custom node components
function StartNode({ data }: NodeProps) {
  return (
    <div className="px-6 py-3 bg-green-500 border-4 border-foreground text-foreground font-black text-sm min-w-[120px] text-center">
      <div>{data.label as string}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
    </div>
  );
}

function EndNode({ data }: NodeProps) {
  return (
    <div className="px-6 py-3 bg-red-500 border-4 border-foreground text-foreground font-black text-sm min-w-[120px] text-center">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
      <div>{data.label as string}</div>
    </div>
  );
}

function ForNode({ data }: NodeProps) {
  return (
    <div className="bg-orange-500 border-4 border-foreground text-foreground min-w-[150px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
      <div className="px-4 py-2 border-b-2 border-foreground font-black text-sm">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-bold">
        <div className="flex items-center gap-2">
          <span>i = 0 to</span>
          <input
            type="number"
            defaultValue={10}
            className="w-12 px-1 py-0.5 bg-background border-2 border-foreground text-foreground text-center"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
    </div>
  );
}

function WhileNode({ data }: NodeProps) {
  return (
    <div className="bg-orange-500 border-4 border-foreground text-foreground min-w-[150px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
      <div className="px-4 py-2 border-b-2 border-foreground font-black text-sm">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-bold">
        <div className="flex items-center gap-2">
          <span>condition:</span>
          <input
            type="text"
            defaultValue="true"
            className="flex-1 px-1 py-0.5 bg-background border-2 border-foreground text-foreground"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
    </div>
  );
}

function IfNode({ data }: NodeProps) {
  return (
    <div className="bg-blue-500 border-4 border-foreground text-foreground min-w-[150px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
      <div className="px-4 py-2 border-b-2 border-foreground font-black text-sm">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-bold">
        <div className="flex items-center gap-2">
          <span>if</span>
          <input
            type="text"
            defaultValue="x > 0"
            className="flex-1 px-1 py-0.5 bg-background border-2 border-foreground text-foreground"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="w-3 h-3 bg-foreground border-2 border-background"
        style={{ left: '30%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="w-3 h-3 bg-foreground border-2 border-background"
        style={{ left: '70%' }}
      />
    </div>
  );
}

function GpioWriteNode({ data }: NodeProps) {
  return (
    <div className="bg-purple-500 border-4 border-foreground text-foreground min-w-[150px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
      <div className="px-4 py-2 border-b-2 border-foreground font-black text-sm">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-bold space-y-1">
        <div className="flex items-center gap-2">
          <span>PIN:</span>
          <input
            type="number"
            defaultValue={13}
            className="w-12 px-1 py-0.5 bg-background border-2 border-foreground text-foreground text-center"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex items-center gap-2">
          <span>VALUE:</span>
          <select
            defaultValue="HIGH"
            className="flex-1 px-1 py-0.5 bg-background border-2 border-foreground text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <option value="HIGH">HIGH</option>
            <option value="LOW">LOW</option>
          </select>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
    </div>
  );
}

function GpioReadNode({ data }: NodeProps) {
  return (
    <div className="bg-purple-500 border-4 border-foreground text-foreground min-w-[150px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
      <div className="px-4 py-2 border-b-2 border-foreground font-black text-sm">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-bold">
        <div className="flex items-center gap-2">
          <span>PIN:</span>
          <input
            type="number"
            defaultValue={2}
            className="w-12 px-1 py-0.5 bg-background border-2 border-foreground text-foreground text-center"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
    </div>
  );
}

function DelayNode({ data }: NodeProps) {
  return (
    <div className="bg-yellow-500 border-4 border-foreground text-foreground min-w-[150px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
      <div className="px-4 py-2 border-b-2 border-foreground font-black text-sm">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-bold">
        <div className="flex items-center gap-2">
          <span>MS:</span>
          <input
            type="number"
            defaultValue={1000}
            className="flex-1 px-1 py-0.5 bg-background border-2 border-foreground text-foreground text-center"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
    </div>
  );
}

function DefaultNode({ data }: NodeProps) {
  return (
    <div className="px-6 py-3 bg-muted border-4 border-foreground text-foreground font-black text-sm min-w-[120px] text-center">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-foreground border-2 border-background"
      />
      <div>{data.label as string}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-foreground border-2 border-background"
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
  gpio_write: GpioWriteNode,
  gpio_read: GpioReadNode,
  delay: DelayNode,
  millis: DefaultNode,
};

export default function BlocksPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['control', 'loops', 'logic']);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, style: { strokeWidth: 3 } }, eds)),
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
  };

  const resetCanvas = () => {
    setNodes(defaultNodes);
    setEdges(defaultEdges);
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
          <Button variant="outline" size="sm" className="border-2 border-foreground font-black">
            <Play size={14} />
            RUN
          </Button>
          <Button variant="outline" size="sm" className="border-2 border-foreground font-black">
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
                          className={`${block.color} border-2 border-foreground px-3 py-2 flex items-center gap-2 cursor-grab active:cursor-grabbing font-bold text-sm text-foreground hover:opacity-90 transition-opacity`}
                        >
                          <GripVertical size={14} />
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

        {/* React Flow Canvas */}
        <main className="flex-1">
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
              style: { strokeWidth: 3, stroke: 'var(--foreground)' },
              type: 'smoothstep',
            }}
          >
            <Controls className="border-2 border-foreground bg-background" />
            <Background gap={15} size={1} color="var(--muted-foreground)" />
          </ReactFlow>
        </main>
      </div>
    </div>
  );
}

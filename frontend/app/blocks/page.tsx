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

function GpioWriteNode({ data }: NodeProps) {
  return (
    <div className="bg-violet-100 dark:bg-violet-900/50 border-2 border-violet-600 dark:border-violet-400 text-violet-900 dark:text-violet-100 min-w-[150px] shadow-md">
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
          <span>PIN:</span>
          <input
            type="number"
            defaultValue={13}
            className="w-12 px-1 py-0.5 bg-white dark:bg-violet-950 border border-violet-400 dark:border-violet-500 text-violet-900 dark:text-violet-100 text-center focus:outline-none focus:ring-1 focus:ring-violet-500"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex items-center gap-2">
          <span>VALUE:</span>
          <select
            defaultValue="HIGH"
            className="flex-1 px-1 py-0.5 bg-white dark:bg-violet-950 border border-violet-400 dark:border-violet-500 text-violet-900 dark:text-violet-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
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
        className="w-3 h-3 bg-violet-600 dark:bg-violet-400 border-2 border-background"
      />
    </div>
  );
}

function GpioReadNode({ data }: NodeProps) {
  return (
    <div className="bg-violet-100 dark:bg-violet-900/50 border-2 border-violet-600 dark:border-violet-400 text-violet-900 dark:text-violet-100 min-w-[150px] shadow-md">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-violet-600 dark:bg-violet-400 border-2 border-background"
      />
      <div className="px-4 py-2 border-b border-violet-300 dark:border-violet-600 font-bold text-sm bg-violet-200/50 dark:bg-violet-800/50">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium">
        <div className="flex items-center gap-2">
          <span>PIN:</span>
          <input
            type="number"
            defaultValue={2}
            className="w-12 px-1 py-0.5 bg-white dark:bg-violet-950 border border-violet-400 dark:border-violet-500 text-violet-900 dark:text-violet-100 text-center focus:outline-none focus:ring-1 focus:ring-violet-500"
            onClick={(e) => e.stopPropagation()}
          />
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
              style: { strokeWidth: 2, stroke: 'var(--muted-foreground)' },
              type: 'smoothstep',
            }}
          >
            <Controls className="border border-border bg-background shadow-sm" />
            <Background gap={20} size={1} color="var(--muted-foreground)" style={{ opacity: 0.3 }} />
          </ReactFlow>
        </main>
      </div>
    </div>
  );
}

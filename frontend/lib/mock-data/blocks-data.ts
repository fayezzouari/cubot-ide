import { Node, Edge } from '@xyflow/react';

// Block category definition
export interface BlockDefinition {
  type: string;
  label: string;
  color: string;
}

export interface BlockCategory {
  id: string;
  name: string;
  blocks: BlockDefinition[];
}

// Block categories for the sidebar
export const blockCategories: BlockCategory[] = [
  {
    id: 'control',
    name: 'CONTROL',
    blocks: [
      { type: 'start', label: 'START', color: 'bg-white/[0.03] border border-blue-500/30 border-l-[3px] border-l-blue-500 text-blue-400' },
      { type: 'end', label: 'END', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-white/30 text-white/60' },
    ],
  },
  {
    id: 'loops',
    name: 'LOOPS',
    blocks: [
      { type: 'for', label: 'FOR LOOP', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-amber-400 text-white/60' },
      { type: 'while', label: 'WHILE', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-amber-400 text-white/60' },
    ],
  },
  {
    id: 'logic',
    name: 'LOGIC',
    blocks: [
      { type: 'if', label: 'IF', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-cyan-400 text-white/60' },
      { type: 'ifelse', label: 'IF/ELSE', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-cyan-400 text-white/60' },
    ],
  },
  {
    id: 'robotics',
    name: 'ROBOTICS',
    blocks: [
      { type: 'move_position', label: 'MOVE POSITION', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-violet-400 text-white/60' },
      { type: 'move_joint', label: 'MOVE JOINT', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-violet-400 text-white/60' },
      { type: 'get_position', label: 'GET POSITION', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-violet-400 text-white/60' },
    ],
  },
  {
    id: 'delay',
    name: 'TIMING',
    blocks: [
      { type: 'delay', label: 'DELAY', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-emerald-400 text-white/60' },
      { type: 'millis', label: 'MILLIS', color: 'bg-white/[0.03] border border-white/[0.08] border-l-[3px] border-l-emerald-400 text-white/60' },
    ],
  },
];

// Initial nodes for demo workspace
export const initialNodes: Node[] = [
  {
    id: '1',
    type: 'start',
    position: { x: 250, y: 50 },
    data: { label: 'START' },
  },
  {
    id: '2',
    type: 'for',
    position: { x: 225, y: 150 },
    data: { label: 'FOR LOOP' },
  },
  {
    id: '3',
    type: 'move_position',
    position: { x: 225, y: 280 },
    data: { label: 'MOVE POSITION' },
  },
  {
    id: '4',
    type: 'delay',
    position: { x: 225, y: 450 },
    data: { label: 'DELAY' },
  },
  {
    id: '5',
    type: 'end',
    position: { x: 250, y: 580 },
    data: { label: 'END' },
  },
];

// Initial edges connecting the demo nodes
export const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', style: { strokeWidth: 2 } },
  { id: 'e2-3', source: '2', target: '3', style: { strokeWidth: 2 } },
  { id: 'e3-4', source: '3', target: '4', style: { strokeWidth: 2 } },
  { id: 'e4-5', source: '4', target: '5', style: { strokeWidth: 2 } },
];

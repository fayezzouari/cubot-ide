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

export const initialNodes: Node[] = [];

export const initialEdges: Edge[] = [];

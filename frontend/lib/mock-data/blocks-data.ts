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
      { type: 'start', label: 'START', color: 'bg-emerald-100 dark:bg-emerald-900/50 border-emerald-600 dark:border-emerald-400 text-emerald-800 dark:text-emerald-200' },
      { type: 'end', label: 'END', color: 'bg-rose-100 dark:bg-rose-900/50 border-rose-600 dark:border-rose-400 text-rose-800 dark:text-rose-200' },
    ],
  },
  {
    id: 'loops',
    name: 'LOOPS',
    blocks: [
      { type: 'for', label: 'FOR LOOP', color: 'bg-amber-100 dark:bg-amber-900/50 border-amber-600 dark:border-amber-400 text-amber-800 dark:text-amber-200' },
      { type: 'while', label: 'WHILE', color: 'bg-amber-100 dark:bg-amber-900/50 border-amber-600 dark:border-amber-400 text-amber-800 dark:text-amber-200' },
    ],
  },
  {
    id: 'logic',
    name: 'LOGIC',
    blocks: [
      { type: 'if', label: 'IF', color: 'bg-sky-100 dark:bg-sky-900/50 border-sky-600 dark:border-sky-400 text-sky-800 dark:text-sky-200' },
      { type: 'ifelse', label: 'IF/ELSE', color: 'bg-sky-100 dark:bg-sky-900/50 border-sky-600 dark:border-sky-400 text-sky-800 dark:text-sky-200' },
    ],
  },
  {
    id: 'gpio',
    name: 'GPIO',
    blocks: [
      { type: 'gpio_write', label: 'GPIO WRITE', color: 'bg-violet-100 dark:bg-violet-900/50 border-violet-600 dark:border-violet-400 text-violet-800 dark:text-violet-200' },
      { type: 'gpio_read', label: 'GPIO READ', color: 'bg-violet-100 dark:bg-violet-900/50 border-violet-600 dark:border-violet-400 text-violet-800 dark:text-violet-200' },
    ],
  },
  {
    id: 'delay',
    name: 'TIMING',
    blocks: [
      { type: 'delay', label: 'DELAY', color: 'bg-lime-100 dark:bg-lime-900/50 border-lime-600 dark:border-lime-400 text-lime-800 dark:text-lime-200' },
      { type: 'millis', label: 'MILLIS', color: 'bg-lime-100 dark:bg-lime-900/50 border-lime-600 dark:border-lime-400 text-lime-800 dark:text-lime-200' },
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
    type: 'gpio_write',
    position: { x: 225, y: 280 },
    data: { label: 'GPIO WRITE' },
  },
  {
    id: '4',
    type: 'delay',
    position: { x: 225, y: 420 },
    data: { label: 'DELAY' },
  },
  {
    id: '5',
    type: 'end',
    position: { x: 250, y: 550 },
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

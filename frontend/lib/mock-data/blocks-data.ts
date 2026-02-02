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
      { type: 'start', label: 'START', color: 'bg-green-500' },
      { type: 'end', label: 'END', color: 'bg-red-500' },
    ],
  },
  {
    id: 'loops',
    name: 'LOOPS',
    blocks: [
      { type: 'for', label: 'FOR LOOP', color: 'bg-orange-500' },
      { type: 'while', label: 'WHILE', color: 'bg-orange-500' },
    ],
  },
  {
    id: 'logic',
    name: 'LOGIC',
    blocks: [
      { type: 'if', label: 'IF', color: 'bg-blue-500' },
      { type: 'ifelse', label: 'IF/ELSE', color: 'bg-blue-500' },
    ],
  },
  {
    id: 'gpio',
    name: 'GPIO',
    blocks: [
      { type: 'gpio_write', label: 'GPIO WRITE', color: 'bg-purple-500' },
      { type: 'gpio_read', label: 'GPIO READ', color: 'bg-purple-500' },
    ],
  },
  {
    id: 'delay',
    name: 'TIMING',
    blocks: [
      { type: 'delay', label: 'DELAY', color: 'bg-yellow-500' },
      { type: 'millis', label: 'MILLIS', color: 'bg-yellow-500' },
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
  { id: 'e1-2', source: '1', target: '2', style: { strokeWidth: 3 } },
  { id: 'e2-3', source: '2', target: '3', style: { strokeWidth: 3 } },
  { id: 'e3-4', source: '3', target: '4', style: { strokeWidth: 3 } },
  { id: 'e4-5', source: '4', target: '5', style: { strokeWidth: 3 } },
];

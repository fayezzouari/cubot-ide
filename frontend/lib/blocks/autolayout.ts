// Tidy layout for a flow graph, derived from its compiled structure.
//
// Sequences run top to bottom; if/else branches sit side by side; loop bodies
// are indented one column to the right. Spacing uses each node's rendered
// height, so nodes never overlap. Blocks that are not reachable from Start are
// stacked in a column to the right of the program.

import type { Edge, Node } from '@xyflow/react';
import { compile, type Stmt } from './compiler';
import { BLOCKS, defaultData, NODE_METRICS, nodeHeight } from './registry';
import type { Pose } from './types';

const COL = NODE_METRICS.width + 48;

// The compiler skips blocks whose fields do not compile (a typo, an untaught
// pose). Structure only depends on types and connections, so lay out a copy
// with default field values and every default pose available.
const LAYOUT_POSES: Pose[] = [
  ...new Set(BLOCKS.flatMap((b) => b.fields.filter((f) => f.kind === 'pose').map((f) => String(f.default)))),
].map((name) => ({ name, x: 0, y: 300, z: 400 }));
const GAP = 40;

type Pos = { x: number; y: number };

export function layoutGraph(nodes: Node[], edges: Edge[]): Map<string, Pos> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const h = (id: string) => {
    const n = byId.get(id);
    return n ? nodeHeight(n.type ?? '', (n.data ?? {}) as Record<string, unknown>) : NODE_METRICS.header;
  };
  const out = new Map<string, Pos>();

  // Returns the width (columns) and height (px) of the laid-out sequence.
  const place = (list: Stmt[], col: number, y: number): { width: number; height: number } => {
    let cur = y;
    let width = 1;
    for (const s of list) {
      out.set(s.nodeId, { x: col * COL, y: cur });
      cur += h(s.nodeId) + GAP;
      if (s.kind === 'if') {
        const a = place(s.then, col, cur);
        const b = place(s.else, col + a.width, cur);
        width = Math.max(width, a.width + b.width);
        cur += Math.max(a.height, b.height);
      } else if (s.kind === 'for' || s.kind === 'while') {
        const body = place(s.body, col + 1, cur);
        width = Math.max(width, 1 + body.width);
        cur += body.height;
      }
    }
    return { width, height: cur - y };
  };

  const start = nodes.find((n) => n.type === 'start');
  let width = 1;
  if (start) {
    out.set(start.id, { x: 0, y: 0 });
    const skeleton = nodes.map((n) => ({ ...n, data: defaultData(n.type ?? '') }));
    const program = compile(skeleton, edges, LAYOUT_POSES);
    width = place(program.body, 0, h(start.id) + GAP).width;
  }

  let y = 0;
  for (const n of nodes) {
    if (out.has(n.id)) continue;
    out.set(n.id, { x: (width + 0.5) * COL, y });
    y += h(n.id) + GAP;
  }
  return out;
}

export function tidyNodes(nodes: Node[], edges: Edge[]): Node[] {
  const pos = layoutGraph(nodes, edges);
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
}

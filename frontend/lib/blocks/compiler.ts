// Compiles the flow graph into a structured program.
//
// Graph rules:
//   * one Start block; execution follows connections from it
//   * If/else: both branches continue at the first block they share
//   * Repeat/While: the "loop" branch runs until it ends (or links back to the
//     loop block); then execution continues from "done"
//   * any other cycle is an error — loops must be explicit
//
// The result feeds the interpreter and all code generators.

import type { Edge, Node } from '@xyflow/react';
import { parse, variablesOf, type Ast } from './expression';
import { BLOCK_BY_TYPE, BUILTIN_VARIABLES } from './registry';
import type { Pose } from './types';

export interface Problem {
  nodeId?: string;
  severity: 'error' | 'warning';
  message: string;
}

// Field values after compilation: numbers/expressions become ASTs, text stays a
// template string, selects/idents stay strings.
export type CompiledFields = Record<string, Ast | string>;

export type Stmt =
  | { kind: 'block'; nodeId: string; type: string; f: CompiledFields }
  | { kind: 'if'; nodeId: string; cond: Ast; condSrc: string; then: Stmt[]; else: Stmt[] }
  | { kind: 'for'; nodeId: string; count: Ast; countSrc: string; var: string; body: Stmt[] }
  | { kind: 'while'; nodeId: string; cond: Ast; condSrc: string; body: Stmt[] }
  | { kind: 'end'; nodeId: string };

export interface CompiledProgram {
  body: Stmt[];
  problems: Problem[];
  variables: string[]; // user variables assigned anywhere in the program
  ok: boolean;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function compile(nodes: Node[], edges: Edge[], poses: Pose[]): CompiledProgram {
  const problems: Problem[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const poseNames = new Set(poses.map((p) => p.name));
  const assigned = new Set<string>();
  const referenced: { name: string; nodeId: string }[] = [];

  // ── Edges: one connection per output port ───────────────────────────────
  const out = new Map<string, string>();
  for (const e of edges) {
    const src = byId.get(e.source);
    if (!src || !byId.has(e.target)) continue;
    const def = BLOCK_BY_TYPE[src.type ?? ''];
    const port = e.sourceHandle || def?.outputs[0]?.id || 'next';
    const key = `${e.source}:${port}`;
    if (out.has(key) && out.get(key) !== e.target) {
      problems.push({
        nodeId: e.source,
        severity: 'error',
        message: `Output "${port}" has more than one connection. Use If/else to branch.`,
      });
      continue;
    }
    out.set(key, e.target);
  }
  const next = (id: string, port: string) => out.get(`${id}:${port}`) ?? null;

  // ── Fields ───────────────────────────────────────────────────────────────
  const compileFields = (node: Node): CompiledFields | null => {
    const def = BLOCK_BY_TYPE[node.type ?? ''];
    const data = (node.data ?? {}) as Record<string, unknown>;
    const f: CompiledFields = {};
    let ok = true;
    for (const field of def.fields) {
      const raw = data[field.key] ?? field.default;
      const src = String(raw).trim();
      const fail = (msg: string) => {
        problems.push({ nodeId: node.id, severity: 'error', message: `${def.label} · ${field.label}: ${msg}` });
        ok = false;
      };
      switch (field.kind) {
        case 'number':
        case 'expr':
          try {
            const ast = parse(src);
            variablesOf(ast).forEach((name) => referenced.push({ name, nodeId: node.id }));
            f[field.key] = ast;
          } catch (err) {
            fail((err as Error).message);
          }
          break;
        case 'ident':
          if (!IDENT.test(src)) fail(`"${src}" is not a valid variable name`);
          f[field.key] = src;
          break;
        case 'pose':
          if (!poseNames.has(src)) fail(`pose "${src}" is not taught. Add it in the Poses tab.`);
          f[field.key] = src;
          break;
        case 'text':
          for (const m of src.matchAll(PLACEHOLDER)) referenced.push({ name: m[1], nodeId: node.id });
          f[field.key] = String(raw);
          break;
        default:
          f[field.key] = src;
      }
    }
    return ok ? f : null;
  };

  const recordAssignments = (type: string, f: CompiledFields) => {
    if (type === 'set_var' || type === 'change_var' || type === 'read_input') assigned.add(f.var as string);
    if (type === 'get_position') ['x', 'y', 'z'].forEach((a) => assigned.add(`${f.prefix}_${a}`));
  };

  // ── Structure ────────────────────────────────────────────────────────────
  // Nodes reachable from `from` without expanding through `stop` nodes, in BFS
  // order.
  const reach = (from: string | null, stop: Set<string>): string[] => {
    if (!from) return [];
    const seen = new Set<string>([from]);
    const order = [from];
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      if (stop.has(id)) continue;
      const def = BLOCK_BY_TYPE[byId.get(id)?.type ?? ''];
      for (const port of def?.outputs ?? []) {
        const t = next(id, port.id);
        if (t && !seen.has(t)) {
          seen.add(t);
          order.push(t);
        }
      }
    }
    return order;
  };

  const visited = new Set<string>();

  const chain = (first: string | null, stop: Set<string>, path: Set<string>): Stmt[] => {
    const stmts: Stmt[] = [];
    let cur = first;
    while (cur && !stop.has(cur)) {
      const node = byId.get(cur)!;
      const type = node.type ?? '';
      const def = BLOCK_BY_TYPE[type];
      if (path.has(cur)) {
        problems.push({
          nodeId: cur,
          severity: 'error',
          message: `${def?.label ?? 'Block'} is reached again through a cycle. Use a Repeat or While block for loops.`,
        });
        break;
      }
      path = new Set(path).add(cur);
      visited.add(cur);
      if (!def) {
        problems.push({ nodeId: cur, severity: 'error', message: `Unknown block type "${type}"` });
        break;
      }
      if (type === 'start') {
        problems.push({ nodeId: cur, severity: 'error', message: 'Start cannot be the target of a connection.' });
        break;
      }
      const f = compileFields(node);

      if (type === 'if') {
        const t = next(cur, 'true');
        const e = next(cur, 'false');
        const reachT = new Set(reach(t, stop));
        const merge = reach(e, stop).find((id) => reachT.has(id)) ?? null;
        const inner = merge ? new Set(stop).add(merge) : stop;
        const thenB = chain(t, inner, path);
        const elseB = chain(e, inner, path);
        if (!t && !e) problems.push({ nodeId: cur, severity: 'warning', message: 'If/else has no branches connected.' });
        if (f) stmts.push({ kind: 'if', nodeId: cur, cond: f.condition as Ast, condSrc: String(node.data.condition ?? ''), then: thenB, else: elseB });
        cur = merge;
        continue;
      }
      if (type === 'for' || type === 'while') {
        const bodyFirst = next(cur, 'body');
        if (!bodyFirst) problems.push({ nodeId: cur, severity: 'warning', message: `${def.label} has nothing connected to "loop".` });
        if (f && type === 'for') assigned.add(f.var as string);
        const body = chain(bodyFirst, new Set(stop).add(cur), path);
        if (f && type === 'for') {
          stmts.push({ kind: 'for', nodeId: cur, count: f.count as Ast, countSrc: String(node.data.count ?? ''), var: f.var as string, body });
        } else if (f) {
          stmts.push({ kind: 'while', nodeId: cur, cond: f.condition as Ast, condSrc: String(node.data.condition ?? ''), body });
        }
        cur = next(cur, 'next');
        continue;
      }
      if (type === 'end') {
        stmts.push({ kind: 'end', nodeId: cur });
        break;
      }
      if (f) {
        recordAssignments(type, f);
        stmts.push({ kind: 'block', nodeId: cur, type, f });
      }
      if (type === 'alarm') break;
      cur = next(cur, 'next');
    }
    return stmts;
  };

  // ── Entry ────────────────────────────────────────────────────────────────
  const starts = nodes.filter((n) => n.type === 'start');
  let body: Stmt[] = [];
  if (starts.length === 0) {
    problems.push({ severity: 'error', message: 'Add a Start block — the program has no entry point.' });
  } else {
    starts.slice(1).forEach((n) =>
      problems.push({ nodeId: n.id, severity: 'error', message: 'Only one Start block is allowed.' }),
    );
    visited.add(starts[0].id);
    body = chain(next(starts[0].id, 'next'), new Set(), new Set([starts[0].id]));
    if (body.length === 0) {
      problems.push({ nodeId: starts[0].id, severity: 'warning', message: 'Nothing is connected to Start.' });
    }
  }

  for (const n of nodes) {
    if (!visited.has(n.id) && n.type !== 'start') {
      problems.push({
        nodeId: n.id,
        severity: 'warning',
        message: `${BLOCK_BY_TYPE[n.type ?? '']?.label ?? 'Block'} is not reachable from Start and will not run.`,
      });
    }
  }

  const known = new Set([...assigned, ...BUILTIN_VARIABLES.map((v) => v.name)]);
  const reported = new Set<string>();
  for (const r of referenced) {
    const key = `${r.nodeId}:${r.name}`;
    if (!known.has(r.name) && !reported.has(key)) {
      reported.add(key);
      problems.push({
        nodeId: r.nodeId,
        severity: 'error',
        message: `Variable "${r.name}" is never set. Add a Set variable block or check the spelling.`,
      });
    }
  }

  return {
    body,
    problems,
    variables: [...assigned].sort(),
    ok: !problems.some((p) => p.severity === 'error'),
  };
}

export function interpolate(template: string, lookup: (name: string) => unknown): string {
  return template.replace(PLACEHOLDER, (_, name) => {
    const v = lookup(name);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    return v === undefined ? `{${name}}` : String(v);
  });
}

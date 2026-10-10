// A small, safe expression language used by block fields.
//
//   numbers      120, -3.5
//   strings      "red", 'ok'
//   booleans     true, false
//   variables    count, part_color, tcp.x
//   operators    + - * / %   == != < <= > >=   && || !   and or not
//   functions    abs min max round floor ceil sqrt sin cos (degrees) clamp random
//
// Expressions are parsed once (so syntax errors surface in the Problems panel
// before a run) and evaluated against a variable scope. No `eval`.

export type Value = number | string | boolean;
export type Scope = (name: string) => Value | undefined;

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '(', ')', ','];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (Number.isNaN(v)) throw new ExpressionError(`Invalid number "${src.slice(i, j)}"`);
      out.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new ExpressionError('Unterminated string');
      out.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === 'and') out.push({ t: 'op', v: '&&' });
      else if (word === 'or') out.push({ t: 'op', v: '||' });
      else if (word === 'not') out.push({ t: 'op', v: '!' });
      else out.push({ t: 'id', v: word });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExpressionError(`Unexpected character "${c}"`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

export type Ast =
  | { k: 'lit'; v: Value }
  | { k: 'var'; name: string }
  | { k: 'un'; op: string; a: Ast }
  | { k: 'bin'; op: string; a: Ast; b: Ast }
  | { k: 'call'; fn: string; args: Ast[] };

const FUNCTIONS: Record<string, { arity: [number, number]; fn: (...a: number[]) => number }> = {
  abs: { arity: [1, 1], fn: Math.abs },
  min: { arity: [1, 8], fn: Math.min },
  max: { arity: [1, 8], fn: Math.max },
  round: { arity: [1, 1], fn: Math.round },
  floor: { arity: [1, 1], fn: Math.floor },
  ceil: { arity: [1, 1], fn: Math.ceil },
  sqrt: { arity: [1, 1], fn: Math.sqrt },
  sin: { arity: [1, 1], fn: (d) => Math.sin((d * Math.PI) / 180) },
  cos: { arity: [1, 1], fn: (d) => Math.cos((d * Math.PI) / 180) },
  clamp: { arity: [3, 3], fn: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) },
  random: { arity: [2, 2], fn: (lo, hi) => lo + Math.random() * (hi - lo) },
};

// Precedence climbing parser.
const BINARY: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

export function parse(src: string): Ast {
  if (!src.trim()) throw new ExpressionError('Expression is empty');
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExpressionError(`Expected "${v}"`);
    p++;
  };

  const primary = (): Ast => {
    const tok = toks[p++];
    if (!tok) throw new ExpressionError('Unexpected end of expression');
    if (tok.t === 'num' || tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'id') {
      if (tok.v === 'true') return { k: 'lit', v: true };
      if (tok.v === 'false') return { k: 'lit', v: false };
      if (isOp('(')) {
        p++;
        const def = FUNCTIONS[tok.v];
        if (!def) throw new ExpressionError(`Unknown function "${tok.v}"`);
        const args: Ast[] = [];
        if (!isOp(')')) {
          args.push(expr(0));
          while (isOp(',')) {
            p++;
            args.push(expr(0));
          }
        }
        expect(')');
        if (args.length < def.arity[0] || args.length > def.arity[1]) {
          throw new ExpressionError(`${tok.v}() takes ${def.arity[0]}–${def.arity[1]} arguments`);
        }
        return { k: 'call', fn: tok.v, args };
      }
      return { k: 'var', name: tok.v };
    }
    if (tok.v === '(') {
      const e = expr(0);
      expect(')');
      return e;
    }
    if (tok.v === '-' || tok.v === '!') return { k: 'un', op: tok.v, a: unary() };
    throw new ExpressionError(`Unexpected "${tok.v}"`);
  };

  const unary = (): Ast => primary();

  const expr = (minPrec: number): Ast => {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== 'op' || !(tok.v in BINARY)) break;
      const prec = BINARY[tok.v];
      if (prec < minPrec) break;
      p++;
      const right = expr(prec + 1);
      left = { k: 'bin', op: tok.v, a: left, b: right };
    }
    return left;
  };

  const ast = expr(0);
  if (p < toks.length) {
    const t = toks[p];
    throw new ExpressionError(`Unexpected "${'v' in t ? t.v : ''}"`);
  }
  return ast;
}

export function variablesOf(ast: Ast, out = new Set<string>()): Set<string> {
  switch (ast.k) {
    case 'var':
      out.add(ast.name);
      break;
    case 'un':
      variablesOf(ast.a, out);
      break;
    case 'bin':
      variablesOf(ast.a, out);
      variablesOf(ast.b, out);
      break;
    case 'call':
      ast.args.forEach((a) => variablesOf(a, out));
      break;
  }
  return out;
}

const num = (v: Value, ctx: string): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new ExpressionError(`"${v}" is not a number (in ${ctx})`);
  return n;
};

export function evaluate(ast: Ast, scope: Scope): Value {
  switch (ast.k) {
    case 'lit':
      return ast.v;
    case 'var': {
      const v = scope(ast.name);
      if (v === undefined) throw new ExpressionError(`Unknown variable "${ast.name}"`);
      return v;
    }
    case 'un': {
      const a = evaluate(ast.a, scope);
      return ast.op === '-' ? -num(a, '-') : !truthy(a);
    }
    case 'call':
      return FUNCTIONS[ast.fn].fn(...ast.args.map((a) => num(evaluate(a, scope), ast.fn)));
    case 'bin': {
      if (ast.op === '&&') return truthy(evaluate(ast.a, scope)) && truthy(evaluate(ast.b, scope));
      if (ast.op === '||') return truthy(evaluate(ast.a, scope)) || truthy(evaluate(ast.b, scope));
      const a = evaluate(ast.a, scope);
      const b = evaluate(ast.b, scope);
      switch (ast.op) {
        case '==':
          return a === b || (typeof a !== 'string' && typeof b !== 'string' && num(a, '==') === num(b, '=='));
        case '!=':
          return !(a === b || (typeof a !== 'string' && typeof b !== 'string' && num(a, '!=') === num(b, '!=')));
        case '+':
          return typeof a === 'string' || typeof b === 'string' ? `${a}${b}` : num(a, '+') + num(b, '+');
        case '-':
          return num(a, '-') - num(b, '-');
        case '*':
          return num(a, '*') * num(b, '*');
        case '/': {
          const d = num(b, '/');
          if (d === 0) throw new ExpressionError('Division by zero');
          return num(a, '/') / d;
        }
        case '%':
          return num(a, '%') % num(b, '%');
        case '<':
          return num(a, '<') < num(b, '<');
        case '<=':
          return num(a, '<=') <= num(b, '<=');
        case '>':
          return num(a, '>') > num(b, '>');
        case '>=':
          return num(a, '>=') >= num(b, '>=');
      }
    }
  }
  throw new ExpressionError('Invalid expression');
}

export function truthy(v: Value): boolean {
  if (typeof v === 'string') return v.length > 0 && v !== 'false' && v !== '0';
  return Boolean(v);
}

// Translate an expression into Python / C source.
export function toSource(ast: Ast, lang: 'py' | 'c', mapVar: (n: string) => string): string {
  const go = (a: Ast, parentPrec: number): string => {
    switch (a.k) {
      case 'lit':
        if (typeof a.v === 'string') return JSON.stringify(a.v);
        if (typeof a.v === 'boolean') return lang === 'py' ? (a.v ? 'True' : 'False') : a.v ? 'true' : 'false';
        return String(a.v);
      case 'var':
        return mapVar(a.name);
      case 'un':
        if (a.op === '-') return `-${go(a.a, 7)}`;
        return lang === 'py' ? `not ${go(a.a, 7)}` : `!${go(a.a, 7)}`;
      case 'call': {
        const args = a.args.map((x) => go(x, 0)).join(', ');
        if (lang === 'py') {
          const py: Record<string, string> = {
            abs: 'abs', min: 'min', max: 'max', round: 'round',
            floor: 'math.floor', ceil: 'math.ceil', sqrt: 'math.sqrt',
            sin: 'sin_deg', cos: 'cos_deg', clamp: 'clamp', random: 'random.uniform',
          };
          return `${py[a.fn]}(${args})`;
        }
        return `${a.fn}(${args})`;
      }
      case 'bin': {
        const prec = BINARY[a.op];
        let op = a.op;
        if (lang === 'py' && op === '&&') op = 'and';
        if (lang === 'py' && op === '||') op = 'or';
        const s = `${go(a.a, prec)} ${op} ${go(a.b, prec + 1)}`;
        return prec < parentPrec ? `(${s})` : s;
      }
    }
  };
  return go(ast, 0);
}

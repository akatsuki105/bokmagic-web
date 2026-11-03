// スクリプトを実行せずに命令木をたどり、アセットを読み込む呼び出しの引数を拾う (VM ではない)
// - ローカル変数への定数の代入を追い、if/switch の節をまたいで食い違えば「不明」(null) にする
// - if/switch の条件が定数で決まるなら、通る節だけを実行する
// - 定数で呼ぶスクリプト呼び出し (0x70) は、引数を束縛して中まで展開する
// - 値がメモリ参照や式で決まるものは null

import { ControlType, InsnType, type Instruction } from "./bokcc/instruction.ts";
import { decodeScript, type ScriptDirectory } from "./script.ts";

// アセットを読み込むサブルーチン (src/vm_commands.s)
export const SUB_LOAD_TILESET = 0x11D4; // Cmd_LoadTileSet, .t BG, .d タイルセット, .c 部品IDの列, .s 読み込み先, .m タイルマップ (読み込み先をその loadOffset にする)
export const SUB_LOAD_TILEMAP = 0x7A27; // Cmd_LoadTileMap, .d タイルマップ, .t BG の構成, .n レイヤ数, .i / .c レイヤの並び
export const SUB_MAP_PLTT = 0x4AE5; // Entity4AE5_Create, EntityCreate で呼ばれる, .p BG パレットの列 (最大4)
export const SUB_CREATE_BG = 0xB4B4; // Cmd_CreateBG, EntityCreate で呼ばれる, .i BG 番号, .p BG の優先度, .d タイルマップ
export const SUB_LOAD_COLLISION = 0x30AD; // Map_LoadMapScripted, .p 当たり判定マップ

const OP_ASSIGN = 22; // "=" (bokcc/instruction.ts の OPERATORS)
const CLAUSE_ELSE = 0x65; // 'e'
const CLAUSE_DEFAULT = 0x64; // 'd'

// 演算子 (bokcc/instruction.ts の OPERATORS の番号) を定数に当てる, 代入と未知のものは undefined
const UNARY: Record<number, (a: number) => number> = { 1: (a) => -a, 2: (a) => Number(!a), 3: (a) => ~a };
const BINARY: Record<number, (a: number, b: number) => number> = {
  4: (a, b) => a + b,
  5: (a, b) => a - b,
  6: (a, b) => a * b,
  7: (a, b) => (b === 0 ? NaN : Math.trunc(a / b)),
  8: (a, b) => (b === 0 ? NaN : a % b),
  9: (a, b) => a << b,
  10: (a, b) => a >> b,
  11: (a, b) => Number(a === b),
  12: (a, b) => Number(a !== b),
  13: (a, b) => Number(a < b),
  14: (a, b) => Number(a <= b),
  15: (a, b) => Number(a > b),
  16: (a, b) => Number(a >= b),
  17: (a, b) => a | b,
  18: (a, b) => a & b,
  19: (a, b) => a ^ b,
  20: (a, b) => Number(a || b),
  21: (a, b) => Number(a && b),
};
const MAX_DEPTH = 16; // スクリプト呼び出しを展開する深さの上限
const ROOT_LEVELS = 3; // 読み込み呼び出しを含むスクリプトから、起点として遡る呼び出し元の段数

export type LoadCall = {
  root: number; // 展開を始めたスクリプトID
  script: number; // 呼び出しが書かれているスクリプトID
  sub: number;
  address: number; // 呼び出し命令の ROM オフセット
  conditional: boolean; // if/switch の節の中にある
  args: Record<string, (number | null)[]>; // ラベルの文字 -> 値の列
};

type Value = number | null;
type Env = { vars: Value[]; params: Value[]; conditional: boolean };

// 2つの分岐を通った後の変数, 食い違ったら不明
const mergeVars = (a: Value[], b: Value[]) => a.map((v, i) => (v === b[i] ? v : null));

export class ScriptScanner {
  private trees = new Map<number, Instruction[]>(); // スクリプトID -> 命令木
  private calls: LoadCall[] = [];
  private root = 0;
  private stack: number[] = [];

  constructor(private rom: DataView, private dir: ScriptDirectory) {}

  private tree(id: number): Instruction[] | undefined {
    let t = this.trees.get(id);
    if (!t) {
      const s = this.dir.scripts[id - 1];
      if (!s) return undefined;
      t = decodeScript(this.rom, s);
      this.trees.set(id, t);
    }
    return t;
  }

  private value(i: Instruction | undefined, env: Env): Value {
    if (!i) return null;
    switch (i.insnType) {
      case InsnType.Constant:
        return i.value;
      case InsnType.Variable:
        return env.vars[i.value] ?? null;
      case InsnType.Parameter:
        return i.value === 0 ? null : env.params[i.value - 1] ?? null;
      case InsnType.Expression:
        return this.expression(i, env);
      default:
        return null;
    }
  }

  // 式 (逆ポーランド記法) を定数で評価する, 1つでも不明な値や未知の演算子があれば null
  private expression(i: Instruction, env: Env): Value {
    const stack: Value[] = [];
    for (const c of i.children) {
      if (c.insnType !== InsnType.Operator) {
        stack.push(this.value(c, env));
        continue;
      }
      if (UNARY[c.value]) {
        const a = stack.pop();
        stack.push(a === null || a === undefined ? null : UNARY[c.value](a));
      } else if (BINARY[c.value]) {
        const b = stack.pop(), a = stack.pop();
        const v = a === null || a === undefined || b === null || b === undefined ? null : BINARY[c.value](a, b);
        stack.push(v === null || Number.isNaN(v) ? null : v);
      } else {
        return null;
      }
    }
    return stack.length === 1 ? stack[0] ?? null : null;
  }

  private record(script: number, sub: number, i: Instruction, env: Env) {
    const args: Record<string, Value[]> = {};
    for (const c of i.children) {
      if (c.insnType === InsnType.Label) args[String.fromCharCode(c.value)] = c.children.map((v) => this.value(v, env)).map((v) => (v === null ? null : v & 0xFFFF));
    }
    this.calls.push({ root: this.root, script, sub, address: i.address, conditional: env.conditional, args });
  }

  private exec(script: number, list: Instruction[], env: Env) {
    for (const i of list) this.stmt(script, i, env);
  }

  // 節の本体を env の写しで実行して、終わった後の変数を返す
  private branch(script: number, body: Instruction | undefined, env: Env): Value[] {
    const e = { ...env, vars: [...env.vars], conditional: true };
    if (body) this.stmt(script, body, e);
    return e.vars;
  }

  private stmt(script: number, i: Instruction, env: Env) {
    switch (i.insnType) {
      case InsnType.Block:
        this.exec(script, i.children, env);
        return;
      case InsnType.Expression: {
        // 式の中のブロックやスクリプト呼び出しも実行されるので中を見る
        for (const c of i.children) if (c.insnType === InsnType.Block || c.insnType === InsnType.Call) this.stmt(script, c, env);
        const [lhs, rhs, op] = i.children;
        const assignsVar = lhs?.insnType === InsnType.Variable && i.children.some((c) => c.insnType === InsnType.Operator && c.value === OP_ASSIGN);
        if (assignsVar) env.vars[lhs.value] = i.children.length === 3 && op.value === OP_ASSIGN ? this.value(rhs, env) : null;
        return;
      }
      case InsnType.Call:
        this.call(i.value, i.children.map((c) => this.value(c, env)), env.conditional);
        return;
      case InsnType.Control:
        this.control(script, i, env);
        return;
    }
  }

  private control(script: number, i: Instruction, env: Env) {
    const head = this.value(i.children[0], env);
    switch (i.value) {
      case ControlType.If:
      case ControlType.Switch: {
        // If: [条件, 本体, 'i'[条件, 本体]..., 'e'[本体]], Switch: [値, 'c'[値, 本体]..., 'd'[本体]]
        // 節を [その節に入る条件 (null なら不明), 本体] に並べ直す, else / default は条件 1
        const clauses: [Value, Instruction | undefined][] = [];
        if (i.value === ControlType.If) clauses.push([head, i.children[1]]);
        for (const c of i.children) {
          if (c.insnType !== InsnType.Label) continue;
          const body = c.children[c.children.length - 1];
          if (c.value === CLAUSE_ELSE || c.value === CLAUSE_DEFAULT) {
            clauses.push([1, body]);
          } else if (i.value === ControlType.If) {
            clauses.push([this.value(c.children[0], env), body]);
          } else {
            const v = this.value(c.children[0], env);
            clauses.push([head === null || v === null ? null : Number(head === v), body]);
          }
        }
        // 条件が決まる間は通る節だけを実行し、不明な条件に当たったらそれ以降の節を全部通して変数を合流させる
        for (let k = 0; k < clauses.length; k++) {
          const [cond, body] = clauses[k];
          if (cond === 0) continue;
          if (cond !== null) {
            if (body) this.stmt(script, body, env);
            return;
          }
          const results = clauses.slice(k).map(([, b]) => this.branch(script, b, env));
          if (!clauses.slice(k).some(([c]) => c === 1)) results.push(env.vars); // どの節も通らない場合
          env.vars = results.reduce(mergeVars);
          return;
        }
        return;
      }
      case ControlType.SubroutineCall:
        if (head === SUB_LOAD_TILESET || head === SUB_LOAD_TILEMAP || head === SUB_LOAD_COLLISION) this.record(script, head, i, env);
        return;
      case ControlType.EntityCreate:
        if (head === SUB_MAP_PLTT || head === SUB_CREATE_BG) this.record(script, head, i, env);
        return;
    }
  }

  private call(id: number, args: Value[], conditional: boolean) {
    if (this.stack.length >= MAX_DEPTH || this.stack.includes(id)) return;
    const t = this.tree(id);
    if (!t) return;
    this.stack.push(id);
    this.exec(id, t, { vars: new Array(8).fill(null), params: args, conditional });
    this.stack.pop();
  }

  // root から展開して、そこから届く読み込み呼び出しを返す
  scan(root: number): LoadCall[] {
    this.calls = [];
    this.root = root;
    this.call(root, [], false);
    return this.calls;
  }

  // 展開の起点にするスクリプト
  // - 読み込み呼び出しを直接含むもの
  // - そこから定数で呼んでいる呼び出し元を ROOT_LEVELS 段まで遡ったもの (U33J は ID を引数で2-3段受け渡してから読み込む)
  // - LoadMap の行き先
  roots(): number[] {
    const roots = new Set<number>();
    const direct = new Set<number>();
    const callers = new Map<number, Set<number>>();
    const seen = new Set<number>();
    const visit = (id: number, i: Instruction) => {
      if (i.insnType === InsnType.Call) {
        const set = callers.get(i.value) ?? new Set<number>();
        callers.set(i.value, set);
        set.add(id);
      }
      if (i.insnType === InsnType.Control) {
        const head = i.children[0]?.insnType === InsnType.Constant ? i.children[0].value & 0xFFFFFF : null;
        if (i.value === ControlType.SubroutineCall && (head === SUB_LOAD_TILEMAP || head === SUB_LOAD_TILESET || head === SUB_LOAD_COLLISION)) direct.add(id);
        if (i.value === ControlType.EntityCreate && head === SUB_MAP_PLTT) direct.add(id);
        if (i.value === ControlType.LoadMap && head !== null) roots.add(head);
      }
      for (const c of i.children) visit(id, c);
    };
    for (const s of this.dir.scripts) {
      if (seen.has(s.offset)) continue;
      seen.add(s.offset);
      for (const t of this.tree(s.id) ?? []) visit(s.id, t);
    }
    let frontier = direct;
    for (const id of direct) roots.add(id);
    for (let level = 0; level < ROOT_LEVELS; level++) {
      const next = new Set<number>();
      for (const id of frontier) for (const c of callers.get(id) ?? []) if (!roots.has(c)) next.add(c);
      for (const id of next) roots.add(id);
      frontier = next;
    }
    return [...roots].sort((a, b) => a - b);
  }
}

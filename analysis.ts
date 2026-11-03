// ROM 全体を見ないと分からないもの (スクリプトの解析結果など) を ROM ごとに1回だけ計算して持つ

import type { ROMFile } from "./rom.ts";
import { decodeScript, parseScriptDirectory, type ScriptDirectory } from "./script.ts";
import { type LoadCall, ScriptScanner, SUB_CREATE_BG, SUB_LOAD_COLLISION, SUB_LOAD_TILEMAP, SUB_LOAD_TILESET, SUB_MAP_PLTT } from "./script_scan.ts";
import { InsnType, type Instruction } from "./bokcc/instruction.ts";
import { layerBGs } from "./tilemap.ts";

const cache = new WeakMap<ROMFile, Map<string, unknown>>();
const memo = <T>(rom: ROMFile, key: string, f: () => T): T => {
  let m = cache.get(rom);
  if (!m) cache.set(rom, m = new Map());
  if (!m.has(key)) m.set(key, f());
  return m.get(key) as T;
};

export const scriptDirectory = (rom: ROMFile): ScriptDirectory => memo(rom, "scriptDir", () => parseScriptDirectory(rom.data, rom.fs));

// スクリプトID -> そのスクリプトを定数で呼んでいるスクリプトID (0x70)
export const scriptCallers = (rom: ROMFile): Map<number, number[]> =>
  memo(rom, "callers", () => {
    const dir = scriptDirectory(rom);
    const callers = new Map<number, number[]>();
    const seen = new Set<number>();
    const visit = (from: number, i: Instruction) => {
      if (i.insnType === InsnType.Call) {
        const list = callers.get(i.value) ?? [];
        callers.set(i.value, list);
        if (!list.includes(from)) list.push(from);
      }
      for (const c of i.children) visit(from, c);
    };
    for (const s of dir.scripts) {
      if (seen.has(s.offset)) continue;
      seen.add(s.offset);
      for (const t of decodeScript(rom.data, s)) visit(s.id, t);
    }
    return callers;
  });

// スクリプトから拾った、1つのマップ (root のスクリプトから届く範囲) の読み込み内容
export type MapLoads = {
  root: number;
  calls: LoadCall[]; // 全部の読み込み (実行順)
  tilemaps: LoadCall[];
  tilesets: LoadCall[];
  pltts: LoadCall[];
  bgs: LoadCall[]; // Cmd_CreateBG, BG の優先度を決める
  collisions: LoadCall[];
};

export const mapLoads = (rom: ROMFile): MapLoads[] =>
  memo(rom, "mapLoads", () => {
    const scanner = new ScriptScanner(rom.data, scriptDirectory(rom));
    return scanner.roots().map((root) => {
      const calls = scanner.scan(root);
      return {
        root,
        calls,
        tilemaps: calls.filter((c) => c.sub === SUB_LOAD_TILEMAP),
        tilesets: calls.filter((c) => c.sub === SUB_LOAD_TILESET),
        pltts: calls.filter((c) => c.sub === SUB_MAP_PLTT),
        bgs: calls.filter((c) => c.sub === SUB_CREATE_BG),
        collisions: calls.filter((c) => c.sub === SUB_LOAD_COLLISION),
      };
    }).filter((m) => m.tilemaps.length > 0);
  });

// 当たり判定マップID -> それを読み込む呼び出し (同じ呼び出しが複数の起点から届いても1つにまとめる)
export const collisionLoads = (rom: ROMFile): Map<number, LoadCall[]> =>
  memo(rom, "collisionLoads", () => {
    const by = new Map<number, LoadCall[]>();
    for (const m of mapLoads(rom)) {
      for (const c of m.collisions) {
        const id = c.args.p?.[0];
        if (id === null || id === undefined) continue;
        const list = by.get(id) ?? [];
        by.set(id, list);
        if (!list.some((d) => d.address === c.address && d.args.n?.[0] === c.args.n?.[0])) list.push(c);
      }
    }
    return by;
  });

// Map タブの1項目: マップを読み込むスクリプト (root) と、そこで読み込むものの組 (場面) の一覧
// 場面は同時に画面に出る BG の組で、if/switch で読み込むタイルマップが変わるときや、同じ BG に読み直すときは別の場面にする
export type MapScene = {
  tilemaps: LoadCall[];
  tilesets: LoadCall[];
  bgs: LoadCall[];
  collisions: LoadCall[];
};
export type MapEntry = {
  root: number;
  loads: MapLoads;
  scenes: MapScene[];
  pltts: LoadCall[]; // BG パレット, 場面によらず root から届くもの全部 (同じものは1つ)
};

const tilemapID = (c: LoadCall) => c.args.d?.[0] ?? null;
const callKey = (c: LoadCall) => `${c.address}:${tilemapID(c)}`;

// Cmd_LoadTileMap が使う BG の番号
export const callBGs = (c: LoadCall): number[] => {
  const t = c.args.t?.[0];
  return t === null || t === undefined ? [] : [...layerBGs(t, c.args.n?.[0] ?? 1, c.args.i).values()];
};

// a が b を (定数のスクリプト呼び出しで) 間接的にでも呼んでいるか
const reaches = (rom: ROMFile, a: number, b: number): boolean => {
  const callers = scriptCallers(rom);
  const seen = new Set<number>();
  const stack = [b];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const c of callers.get(id) ?? []) {
      if (c === a) return true;
      if (!seen.has(c)) seen.add(c), stack.push(c);
    }
  }
  return false;
};

// タイルマップの読み込み呼び出し (呼び出し命令の位置とタイルマップID の組) ごとに、それを読み込むマップのスクリプトを1つ決める
// - その呼び出しを if/switch の外で読む起点があれば、その中で一番外側のもの (読み込みが一番多いもの, 同じなら呼び出し元)
//   部屋のスクリプトが「部屋の読み込みスクリプト」を呼び、パレットだけ呼び出し元で決めるような形があるので、内側ではなく外側を取る
// - if/switch の中でしか読まれないなら、読むタイルマップの種類が一番少ない起点 (いくつものマップに振り分けるだけのものを避ける)
const tilemapOwners = (rom: ROMFile): Map<string, MapLoads> =>
  memo(rom, "tilemapOwners", () => {
    const cands = new Map<string, MapLoads[]>();
    for (const m of mapLoads(rom)) {
      for (const c of m.tilemaps) {
        if (tilemapID(c) === null) continue;
        const list = cands.get(callKey(c)) ?? [];
        cands.set(callKey(c), list);
        if (!list.includes(m)) list.push(m);
      }
    }
    const owners = new Map<string, MapLoads>();
    const distinct = (m: MapLoads) => new Set(m.tilemaps.map(tilemapID)).size;
    for (const [key, list] of cands) {
      const uncond = list.filter((m) => m.tilemaps.some((c) => callKey(c) === key && !c.conditional));
      const sorted = uncond.length > 0 ? uncond.sort((a, b) => b.calls.length - a.calls.length || (reaches(rom, a.root, b.root) ? -1 : reaches(rom, b.root, a.root) ? 1 : a.root - b.root)) : list.sort((a, b) => distinct(a) - distinct(b) || a.calls.length - b.calls.length || a.root - b.root);
      owners.set(key, sorted[0]);
    }
    return owners;
  });

// 実行順に読み込みをたどって場面に分ける
// タイルマップの読み込みが今の場面で使っている BG を使うなら次の場面にする, その直前のタイルセットの読み込みも次の場面に入れる
// root が持ち主でないタイルマップの読み込み (呼び出し先の別のマップのもの) は入れず、当たり判定と Cmd_CreateBG は場面のタイルマップを指すものだけ入れる
const buildScenes = (m: MapLoads, owned: (c: LoadCall) => boolean): MapScene[] => {
  type Work = MapScene & { used: Set<number> };
  const scenes: Work[] = [];
  const fresh = (): Work => ({ tilemaps: [], tilesets: [], bgs: [], collisions: [], used: new Set() });
  let cur = fresh();
  let pending: LoadCall[] = []; // 前のタイルマップの読み込みより後の、タイルマップ以外の読み込み
  const flush = (to: Work, calls: LoadCall[]) => {
    for (const c of calls) {
      if (c.sub === SUB_LOAD_TILESET) to.tilesets.push(c);
      if (c.sub === SUB_CREATE_BG) to.bgs.push(c);
      if (c.sub === SUB_LOAD_COLLISION) to.collisions.push(c);
    }
  };
  for (const c of m.calls) {
    if (c.sub !== SUB_LOAD_TILEMAP) {
      if (c.sub !== SUB_MAP_PLTT) pending.push(c);
      continue;
    }
    if (!owned(c)) continue;
    const bgs = callBGs(c);
    if (cur.tilemaps.length > 0 && bgs.some((bg) => cur.used.has(bg))) {
      // 直前に続くタイルセットの読み込みは次の場面のもの
      let k = pending.length;
      while (k > 0 && pending[k - 1].sub === SUB_LOAD_TILESET) k--;
      flush(cur, pending.slice(0, k));
      scenes.push(cur);
      cur = fresh();
      pending = pending.slice(k);
    }
    flush(cur, pending);
    pending = [];
    cur.tilemaps.push(c);
    for (const bg of bgs) cur.used.add(bg);
  }
  flush(cur, pending);
  if (cur.tilemaps.length > 0) scenes.push(cur);

  // 場面のタイルマップを指していない当たり判定と Cmd_CreateBG を除き、同じ内容の場面は1つにする
  // if/else の両方で同じタイルマップを読み、当たり判定などはその後で1回だけ読む形があるので、
  // 場面に当たり判定や Cmd_CreateBG が無ければ root の読み込み全体からそのタイルマップを指すものを借りる
  const seen = new Set<string>();
  const out: MapScene[] = [];
  for (const s of scenes) {
    const ids = new Set(s.tilemaps.map(tilemapID));
    const refers = (v: number | null | undefined) => v === null || v === undefined || ids.has(v);
    const pointsTo = (v: number | null | undefined) => v !== null && v !== undefined && ids.has(v);
    const pick = (own: LoadCall[], sub: number, arg: string) => {
      const list = own.filter((c) => refers(c.args[arg]?.[0]));
      return list.length > 0 ? list : m.calls.filter((c) => c.sub === sub && pointsTo(c.args[arg]?.[0])).slice(0, 1);
    };
    // タイルセットも同じく、無ければ同じタイルマップを読む別の場面から借りる
    const tilesets = s.tilesets.filter((c) => refers(c.args.m?.[0]));
    const other = scenes.find((o) => o !== s && o.tilesets.length > 0 && o.tilemaps.some((c) => ids.has(tilemapID(c))));
    const scene: MapScene = {
      tilemaps: s.tilemaps,
      tilesets: tilesets.length > 0 || !other ? tilesets : other.tilesets.filter((c) => refers(c.args.m?.[0])),
      bgs: pick(s.bgs, SUB_CREATE_BG, "d"),
      collisions: pick(s.collisions, SUB_LOAD_COLLISION, "n"),
    };
    const sig = JSON.stringify([scene.tilemaps, scene.tilesets, scene.bgs, scene.collisions].map((l) => l.map((c) => c.args)));
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(scene);
  }
  return out;
};

export const mapEntries = (rom: ROMFile): MapEntry[] =>
  memo(rom, "mapEntries", () => {
    const owners = tilemapOwners(rom);
    const entries: MapEntry[] = [];
    for (const m of mapLoads(rom)) {
      const owned = (c: LoadCall) => owners.get(callKey(c)) === m;
      if (!m.tilemaps.some(owned)) continue;
      const pltts: LoadCall[] = [];
      for (const c of [...m.pltts].sort((a, b) => Number(a.conditional) - Number(b.conditional))) {
        if (!pltts.some((p) => JSON.stringify(p.args.p) === JSON.stringify(c.args.p))) pltts.push(c);
      }
      entries.push({ root: m.root, loads: m, scenes: buildScenes(m, owned), pltts });
    }
    return entries;
  });

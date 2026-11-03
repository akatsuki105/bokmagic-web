// ROM 全体を見ないと分からないもの (スクリプトの解析結果など) を ROM ごとに1回だけ計算して持つ

import type { ROMFile } from "./rom.ts";
import { decodeScript, parseScriptDirectory, type ScriptDirectory } from "./script.ts";
import { type LoadCall, ScriptScanner, SUB_LOAD_COLLISION, SUB_LOAD_TILEMAP, SUB_LOAD_TILESET, SUB_MAP_PLTT } from "./script_scan.ts";
import { InsnType, type Instruction } from "./bokcc/instruction.ts";

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
  tilemaps: LoadCall[];
  tilesets: LoadCall[];
  pltts: LoadCall[];
  collisions: LoadCall[];
};

export const mapLoads = (rom: ROMFile): MapLoads[] =>
  memo(rom, "mapLoads", () => {
    const scanner = new ScriptScanner(rom.data, scriptDirectory(rom));
    return scanner.roots().map((root) => {
      const calls = scanner.scan(root);
      return {
        root,
        tilemaps: calls.filter((c) => c.sub === SUB_LOAD_TILEMAP),
        tilesets: calls.filter((c) => c.sub === SUB_LOAD_TILESET),
        pltts: calls.filter((c) => c.sub === SUB_MAP_PLTT),
        collisions: calls.filter((c) => c.sub === SUB_LOAD_COLLISION),
      };
    }).filter((m) => m.tilemaps.length > 0);
  });

// タイルマップID -> それを読み込むマップ
export const mapLoadsByTilemap = (rom: ROMFile): Map<number, MapLoads[]> =>
  memo(rom, "mapLoadsByTilemap", () => {
    const by = new Map<number, MapLoads[]>();
    for (const m of mapLoads(rom)) {
      for (const c of m.tilemaps) {
        const id = c.args.d?.[0];
        if (id === null || id === undefined) continue;
        const list = by.get(id) ?? [];
        by.set(id, list);
        if (!list.includes(m)) list.push(m);
      }
    }
    // 複数のマップに振り分けるだけのスクリプトも起点になるので、そのマップ専用に近いもの
    // (読み込むタイルマップの種類が少なく、if/switch の外で読んでいるもの) を先にする
    const distinct = (m: MapLoads) => new Set(m.tilemaps.map((c) => c.args.d?.[0])).size;
    for (const [id, list] of by) {
      const conditional = (m: MapLoads) => Number(m.tilemaps.every((c) => c.args.d?.[0] !== id || c.conditional));
      list.sort((a, b) => distinct(a) - distinct(b) || conditional(a) - conditional(b) || a.root - b.root);
    }
    return by;
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

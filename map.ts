// Map タブ: スクリプトから拾った1つの場面 (analysis.ts の MapScene) を、ゲームと同じように BG に載せて重ねる

import type { ROMFile } from "./rom.ts";
import type { MapScene } from "./analysis.ts";
import type { LoadCall } from "./script_scan.ts";
import { bgDepth, DEFAULT_BG_PRIO, layerBGs, type LayerSource, layoutCharBase, parseTilemap, type Tilemap, tilemapFiles } from "./tilemap.ts";
import { partTiles, type TileSet } from "./tileset.ts";

// BG VRAM 全体 (キャラクタブロック 0-3, 64KB)
const VRAM_SIZE = 0x10000;

// BG 1つの状態
export type BgSlot = {
  bg: number;
  prio: number; // 小さいほど手前
  map: Tilemap;
  layer: number; // map.layers の番号
  charBase: number; // VRAM 上のバイト位置
  call: LoadCall; // 載せた Cmd_LoadTileMap
};

export type SceneState = {
  slots: BgSlot[]; // 奥 -> 手前
  vram: Uint8Array;
  maps: Map<number, Tilemap>;
};

const put = (vram: Uint8Array, offset: number, tiles: Uint8Array) => {
  const n = Math.min(tiles.length, VRAM_SIZE - offset);
  if (n > 0 && offset >= 0) vram.set(tiles.subarray(0, n), offset);
};

// 場面の読み込みを順に当てて、BG の割り当てと VRAM の中身を作る
// - Cmd_LoadTileSet: '.t' が BG0 なら VRAM の 0x8000、それ以外は '.s' (または '.m' のタイルマップの loadOffset) のタイルの位置 (Video_LoadTileSetParts)
// - Cmd_LoadTileMap: ファイル内のタイルは VBlank で転送されるので、タイルセットの読み込みの後に置く (Video_SetupBGLayout / Video_RequestBGTileData)
// - Cmd_CreateBG: '.i' の BG の優先度を '.p' にする
export const buildScene = (rom: ROMFile, scene: MapScene, ts: TileSet | undefined): SceneState => {
  const files = tilemapFiles(rom.fs);
  const maps = new Map<number, Tilemap>();
  const getMap = (id: number | null | undefined) => {
    if (id === null || id === undefined) return undefined;
    if (!maps.has(id)) {
      const f = files.find((f) => f.id === id);
      if (!f) return undefined;
      maps.set(id, parseTilemap(rom.data, f));
    }
    return maps.get(id);
  };

  const vram = new Uint8Array(VRAM_SIZE);
  for (const c of scene.tilesets) {
    if (!ts) break;
    const bg = c.args.t?.[0];
    let idx = c.args.s?.[0] ?? 0;
    const m = getMap(c.args.m?.[0]);
    if (m) idx = m.loadOffset;
    let offset = bg === 0 ? 0x8000 : (idx ?? 0) * 32;
    for (const pid of c.args.c ?? []) {
      const part = ts.parts.find((p) => p.id === pid);
      if (!part) continue;
      const tiles = partTiles(ts, part);
      put(vram, offset, tiles);
      offset += tiles.length;
    }
  }

  const slots = new Map<number, BgSlot>();
  for (const c of scene.tilemaps) {
    const map = getMap(c.args.d?.[0]);
    const t = c.args.t?.[0];
    if (!map || t === null || t === undefined) continue;
    const charBase = layoutCharBase(t);
    if (map.tiles) put(vram, charBase || map.loadOffset * 32, map.tiles);
    for (const [layer, bg] of layerBGs(t, c.args.n?.[0] ?? 1, c.args.i)) {
      if (!map.layers[layer]) continue;
      slots.set(bg, { bg, prio: DEFAULT_BG_PRIO[bg] ?? 0, map, layer, charBase, call: c });
    }
  }
  for (const c of scene.bgs) {
    const bg = c.args.i?.[0], p = c.args.p?.[0];
    const slot = bg === null || bg === undefined ? undefined : slots.get(bg);
    if (slot && p !== null && p !== undefined) slot.prio = p;
  }

  return { slots: [...slots.values()].sort((a, b) => bgDepth(b.bg, b.prio) - bgDepth(a.bg, a.prio)), vram, maps };
};

export const slotSource = (s: BgSlot, vram: Uint8Array): LayerSource => ({ map: s.map, layer: s.map.layers[s.layer], vram: vram.subarray(s.charBase) });

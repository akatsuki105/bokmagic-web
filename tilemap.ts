// BG のタイルマップ (DIR_TILE_MAP), see include/tilemap.h in boktai2 decomp
// ファイルは LZ77 で圧縮されていることがある (GetTilemapFile)

import { DIR_TILE_MAP, type FileEntry, FileSystem } from "./fs.ts";
import { decompressLZ77 } from "./lz77.ts";
import type { Rendered } from "./render.ts";

// TilemapLayer
export type TilemapLayer = {
  width: number; // メタタイル単位
  height: number;
  id: number;
  unk_6: number;
  mtmap: Uint16Array; // メタタイル番号, 16x16 メタタイルのブロック単位で並ぶ (mtmapIndex)
};

// TilemapFile
export type Tilemap = {
  id: number;
  compressed: boolean;
  size: number; // 展開後のバイト数
  tileCount: number;
  metatileCount: number;
  loadOffset: number; // タイルを読み込む VRAM 上の位置 (タイル単位), BgMapEntry のタイル番号はこれを足した値
  tiles?: Uint8Array; // ファイル内のタイル, tiles のオフセットが 0 なら無し (スクリプトがタイルセットから読む)
  metatiles: Uint16Array; // BgMapEntry[metatileCount * 4], 左上, 右上, 左下, 右下
  layers: TilemapLayer[];
};

export const tilemapFiles = (fs: FileSystem): FileEntry[] => fs.list(DIR_TILE_MAP);

// GetTilemapFile と同じく、先頭が "MP" なら非圧縮、そうでなければ LZ77 で展開する
// 展開先は gTilemapFileBufferHead で、本体はその4バイト後ろ (gTilemapFileBuffer) から始まる
export const parseTilemap = (rom: DataView, { id, offset }: FileEntry): Tilemap => {
  const bytes = new Uint8Array(rom.buffer, rom.byteOffset);
  const raw = bytes[offset] === 0x4D && bytes[offset + 1] === 0x50;
  const data = raw ? bytes.subarray(offset) : decompressLZ77(bytes.subarray(offset)).subarray(4);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (o: number) => v.getUint16(o, true);
  const u32 = (o: number) => v.getUint32(o, true);

  const layerCount = u16(0x04);
  const tileCount = u16(0x06);
  const metatileCount = u16(0x08);
  const layersOfs = u32(0x0C);
  const tilesOfs = u32(0x10);
  const metatilesOfs = u32(0x14);

  const layers: TilemapLayer[] = [];
  let end = metatilesOfs + metatileCount * 8;
  for (let i = 0; i < layerCount; i++) {
    const l = layersOfs + i * 12;
    const width = u16(l), height = u16(l + 2), mtOfs = u32(l + 8);
    const mtmap = new Uint16Array(width * height);
    for (let k = 0; k < mtmap.length; k++) mtmap[k] = u16(mtOfs + k * 2);
    layers.push({ width, height, id: u16(l + 4), unk_6: u16(l + 6), mtmap });
    end = Math.max(end, mtOfs + mtmap.length * 2);
  }
  const metatiles = new Uint16Array(metatileCount * 4);
  for (let k = 0; k < metatiles.length; k++) metatiles[k] = u16(metatilesOfs + k * 2);

  return {
    id,
    compressed: !raw,
    size: end,
    tileCount,
    metatileCount,
    loadOffset: u16(0x0A),
    tiles: tilesOfs ? data.slice(tilesOfs, tilesOfs + tileCount * 32) : undefined,
    metatiles,
    layers,
  };
};

// メタタイル座標 (mx, my) の mtmap の添字, Video_GenerateBGMapCore と同じく 16x16 メタタイルのブロックが横に width/16 個ずつ並ぶ
export const mtmapIndex = (layer: TilemapLayer, mx: number, my: number) => ((my >> 4) * (layer.width >> 4) + (mx >> 4)) * 256 + (my & 15) * 16 + (mx & 15);

// BG の VRAM (キャラクタブロック) 1つ分, BgMapEntry のタイル番号は10ビット
export const VRAM_TILES = 1024;

// tiles (タイル数 * 32 バイト) を VRAM の offset 枚目から書き込む, はみ出す分は捨てる
export const putTiles = (vram: Uint8Array, offset: number, tiles: Uint8Array) => {
  const n = Math.min(tiles.length, (VRAM_TILES - offset) * 32);
  if (n > 0) vram.set(tiles.subarray(0, n), offset * 32);
};

// BgMapEntry (bit0-9: タイル番号, bit10: xflip, bit11: yflip, bit12-15: パレット番号) 1つを (x, y) に描く
// colors は BG パレット 256 色 (RGBA8888), transparent0 なら色0 は描かない
const drawEntry = (out: Uint32Array, width: number, x: number, y: number, e: number, vram: Uint8Array, colors: Uint32Array, transparent0: boolean) => {
  const base = (e & 0x3FF) * 32;
  const hflip = (e & 0x400) !== 0, vflip = (e & 0x800) !== 0;
  const row = (e >> 12) * 16;
  for (let py = 0; py < 8; py++) {
    const sy = vflip ? 7 - py : py;
    for (let px = 0; px < 8; px++) {
      const sx = hflip ? 7 - px : px;
      const byte = vram[base + sy * 4 + (sx >> 1)];
      const c = (sx & 1) ? byte >> 4 : byte & 0xF;
      if (c === 0 && transparent0) continue;
      out[(y + py) * width + x + px] = colors[row + c];
    }
  }
};

// メタタイル1つ (16x16) を (x, y) に描く
const drawMetatile = (out: Uint32Array, width: number, x: number, y: number, map: Tilemap, mt: number, vram: Uint8Array, colors: Uint32Array, transparent0: boolean) => {
  for (let k = 0; k < 4; k++) {
    const e = map.metatiles[mt * 4 + k];
    if (e === undefined) continue;
    drawEntry(out, width, x + (k & 1) * 8, y + (k >> 1) * 8, e, vram, colors, transparent0);
  }
};

// 重ねて描くレイヤ1枚: タイルマップ (メタタイルの定義) とそのレイヤ、タイルを読む VRAM (BG のキャラクタブロックの先頭から)
export type LayerSource = { map: Tilemap; layer: TilemapLayer; vram: Uint8Array };

// レイヤを items の順 (奥 -> 手前) に重ねて描く, 大きさは一番大きいレイヤに合わせる
// transparent0 は一番奥のレイヤにだけ効き、それより手前のレイヤの色0 は常に透明
export const renderComposite = (items: LayerSource[], colors: Uint32Array, transparent0: boolean): Rendered => {
  const width = Math.max(16, ...items.map((s) => s.layer.width * 16)), height = Math.max(16, ...items.map((s) => s.layer.height * 16));
  const image = new ImageData(width, height);
  const out = new Uint32Array(image.data.buffer);
  items.forEach(({ map, layer, vram }, k) => {
    for (let my = 0; my < layer.height; my++) {
      for (let mx = 0; mx < layer.width; mx++) {
        drawMetatile(out, width, mx * 16, my * 16, map, layer.mtmap[mtmapIndex(layer, mx, my)], vram, colors, k > 0 || transparent0);
      }
    }
  });
  return { image, originX: 0, originY: 0 };
};

export const renderLayers = (map: Tilemap, layers: TilemapLayer[], vram: Uint8Array, colors: Uint32Array, transparent0: boolean): Rendered => renderComposite(layers.map((layer) => ({ map, layer, vram })), colors, transparent0);

// '.t' (BG の構成) が 0 と 6 のときは、その BG のキャラクタブロックを 2 (VRAM の 0x8000) にし、ファイル内のタイルも loadOffset によらずそこに置く
// それ以外はキャラクタブロック 0 で、タイルは loadOffset に置く (Video_SetupBGLayout)
export const layoutCharBase = (layout: number) => (layout === 0 || layout === 6 ? 0x8000 : 0);

// Cmd_LoadTileMap の '.t' (BG の構成) ごとに、レイヤを割り当てる BG の並び (Video_SetupBGLayout の分岐表)
// 1, 4, 5 は '.n' が 2 のときだけ2つ目の BG を使う
const LAYOUT_BGS: Record<number, number[]> = { 0: [0], 1: [2, 3], 2: [3], 3: [1], 4: [1, 3], 5: [2, 1], 6: [1], 7: [2, 3, 1] };
const LAYOUT_TWO = new Set([1, 4, 5]);

// レイヤ番号 -> BG 番号, indices は '.i' (k 番目の BG に載せるレイヤ番号, 無ければ k)
export const layerBGs = (layout: number, count: number, indices?: (number | null)[]): Map<number, number> => {
  const bgs = LAYOUT_BGS[layout] ?? [2];
  const n = LAYOUT_TWO.has(layout) ? (count === 2 ? 2 : 1) : bgs.length;
  const map = new Map<number, number>();
  for (let k = 0; k < n; k++) map.set(indices?.[k] ?? k, bgs[k]);
  return map;
};

// BG の優先度の既定値 (Video_InitBGMode, Cmd_CreateBG の '.p' の既定値と同じ), 小さいほど手前
export const DEFAULT_BG_PRIO: Record<number, number> = { 0: 0, 1: 1, 2: 3, 3: 1 };

// 奥にあるほど大きい値, 優先度が同じなら番号の小さい BG が手前 (GBA のハードウェアの規則)
export const bgDepth = (bg: number, prio: number) => prio * 4 + bg;

// メタタイルを番号順に cols 個ずつ並べる
export const renderMetatiles = (map: Tilemap, vram: Uint8Array, colors: Uint32Array, transparent0: boolean, cols = 16): Rendered => {
  const rows = Math.max(1, Math.ceil(map.metatileCount / cols));
  const width = cols * 16;
  const image = new ImageData(width, rows * 16);
  const out = new Uint32Array(image.data.buffer);
  for (let mt = 0; mt < map.metatileCount; mt++) drawMetatile(out, width, (mt % cols) * 16, Math.floor(mt / cols) * 16, map, mt, vram, colors, transparent0);
  return { image, originX: 0, originY: 0 };
};

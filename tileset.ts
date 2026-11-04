// BG のタイルセット (DIR_TILESET), see include/tilesets.h in boktai2 decomp
// このゲームには TileSetFile が1つしかなく、TileSetPart (部品) ごとにスクリプトから BG VRAM へ読み込まれる (Cmd_LoadTileSet)
// ボクタイ1 (U3IJ) はファイルが 11 個あり、ヘッダが 0x14 バイトで数が u16 (bokmagic の GlobalTileSetModel.cpp の engine == 1 の分岐による)

import { DIR_TILESET, FileSystem } from "./fs.ts";

// TileSetPart
export type TileSetPart = {
  id: number;
  tileCount: number;
  startIndex: number; // refs の先頭からのバイトオフセット (Video_LoadTileSetParts が (u8*)refs + startIndex として使う)
  refs: Uint16Array; // この部品が VRAM に並べるタイルの番号 (tiles の何枚目か), tileCount 個
};

// TileSetFile
export type TileSet = {
  id: number;
  unk: number; // U32J: 0x02 の u16, U3IJ: 0x06 の u16 (bokmagic は書き出すときに 1 を入れる). ゲームが読むかは分からない
  refCount: number;
  parts: TileSetPart[];
  tiles: Uint8Array; // 4bpp, 32 bytes/tile
};

export const parseTileSets = (rom: DataView, fs: FileSystem, gameID: string): TileSet[] =>
  fs.list(DIR_TILESET).map(({ id, offset }) => {
    const u16 = (ofs: number) => rom.getUint16(offset + ofs, true);
    const u32 = (ofs: number) => rom.getUint32(offset + ofs, true);
    const b1 = gameID === "U3IJ";
    const partCount = u16(0x00);
    const refCount = b1 ? u16(0x02) : u32(0x04);
    const tileCount = b1 ? u16(0x04) : u32(0x08);
    const partsOfs = u32(b1 ? 0x08 : 0x0C);
    const refsOfs = u32(b1 ? 0x0C : 0x10);
    const tilesOfs = u32(b1 ? 0x10 : 0x14);

    const parts: TileSetPart[] = [];
    for (let i = 0; i < partCount; i++) {
      const p = partsOfs + i * 8;
      const count = u16(p + 2);
      const startIndex = u32(p + 4);
      const refs = new Uint16Array(count);
      for (let j = 0; j < count; j++) refs[j] = u16(refsOfs + startIndex + j * 2);
      parts.push({ id: u16(p), tileCount: count, startIndex, refs });
    }
    const tiles = new Uint8Array(rom.buffer, rom.byteOffset + offset + tilesOfs, tileCount * 32);
    return { id, unk: u16(b1 ? 0x06 : 0x02), refCount, parts, tiles };
  });

// 部品が VRAM に並べるタイルを、並ぶ順に詰めたもの (Video_LoadTileSetParts が DMA で流す内容)
export const partTiles = (ts: TileSet, part: TileSetPart): Uint8Array => {
  const out = new Uint8Array(part.tileCount * 32);
  part.refs.forEach((r, k) => out.set(ts.tiles.subarray(r * 32, r * 32 + 32), k * 32));
  return out;
};

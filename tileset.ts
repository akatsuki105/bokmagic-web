// BG のタイルセット (DIR_TILESET), see include/tilesets.h in boktai2 decomp
// このゲームには TileSetFile が1つしかなく、TileSetPart (部品) ごとにスクリプトから BG VRAM へ読み込まれる (Cmd_LoadTileSet)

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
  unk_2: number;
  refCount: number;
  parts: TileSetPart[];
  tiles: Uint8Array; // 4bpp, 32 bytes/tile
};

export const parseTileSets = (rom: DataView, fs: FileSystem): TileSet[] =>
  fs.list(DIR_TILESET).map(({ id, offset }) => {
    const u16 = (ofs: number) => rom.getUint16(offset + ofs, true);
    const u32 = (ofs: number) => rom.getUint32(offset + ofs, true);
    const partCount = u16(0x00);
    const refCount = u32(0x04);
    const tileCount = u32(0x08);
    const partsOfs = u32(0x0C);
    const refsOfs = u32(0x10);
    const tilesOfs = u32(0x14);

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
    return { id, unk_2: u16(0x02), refCount, parts, tiles };
  });

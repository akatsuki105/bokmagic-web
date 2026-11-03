// OBJ パレット (DIR_OBJPLTT), see include/sprite_pltt.h in boktai2 decomp

import { DIR_OBJPLTT, FileSystem } from "./fs.ts";

// gObjPlttData: 16色パレットの配列, plttID 番目は colors[plttID * 16 ...]
export type ObjPltt = {
  length: number; // 16色パレットの個数
  unk_02: number;
  raw: Uint16Array; // ROM にある rgb555 のまま
  colors: Uint32Array; // RGBA8888 (ImageData にそのまま書ける並び), 色0 も不透明のまま持つ
};

// InitPltt が読むファイル
const OBJPLTT_FILE = 0xC5E9;

const color8 = (c5: number) => (c5 << 3) | (c5 >> 2);

export const rgb555ToRGBA = (c: number): number => {
  const r = color8(c & 0x1F), g = color8((c >> 5) & 0x1F), b = color8((c >> 10) & 0x1F);
  return ((0xFF << 24) | (b << 16) | (g << 8) | r) >>> 0; // little endian で R,G,B,A の順に並ぶ
};

export const loadObjPltt = (rom: DataView, fs: FileSystem): ObjPltt => {
  const f = fs.get(DIR_OBJPLTT, OBJPLTT_FILE);
  if (f === undefined) throw new Error("ObjPlttFile not found");
  const length = rom.getUint16(f, true);
  const raw = new Uint16Array(length * 16);
  for (let i = 0; i < raw.length; i++) raw[i] = rom.getUint16(f + 4 + i * 2, true);
  return { length, unk_02: rom.getUint16(f + 2, true), raw, colors: Uint32Array.from(raw, rgb555ToRGBA) };
};

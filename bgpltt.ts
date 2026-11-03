// BG パレット (DIR_BGPLTT), see include/bg_pltt.h in boktai2 decomp

import { DIR_BGPLTT, FileSystem } from "./fs.ts";
import { rgb555ToRGBA } from "./objpltt.ts";

// BgPlttFile
export type BgPlttFile = {
  id: number;
  header: Uint8Array; // 20 バイト, ゲームが読んでいる箇所は見つかっていない
  raw: Uint16Array; // body, rgb555[256] (16色 × 16本)
  colors: Uint32Array; // raw を RGBA8888 にしたもの
};

const HEADER_SIZE = 20;
const COLOR_COUNT = 256;

export const parseBgPlttFiles = (rom: DataView, fs: FileSystem): BgPlttFile[] =>
  fs.list(DIR_BGPLTT).map(({ id, offset }) => {
    const header = new Uint8Array(rom.buffer, rom.byteOffset + offset, HEADER_SIZE);
    const raw = new Uint16Array(COLOR_COUNT);
    for (let i = 0; i < COLOR_COUNT; i++) raw[i] = rom.getUint16(offset + HEADER_SIZE + i * 2, true);
    return { id, header, raw, colors: Uint32Array.from(raw, rgb555ToRGBA) };
  });

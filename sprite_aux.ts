// AuxSprite (DIR_AUX_SPRITE) のファイル, see include/sprite_aux.h in boktai2 decomp
// 全ての AuxSprite が 1つのファイル (AuxSpriteFile) にまとまっていて、Video_GetAuxSprite が SpriteID で引く

import { DIR_AUX_SPRITE, FileSystem } from "./fs.ts";
import { type Obj, OBJ_SIZE } from "./render.ts";

// LoadAuxSpriteFile に渡されるファイル (src/main.c)
const AUX_SPRITE_FILE = 0xFF54;

// AuxSubsprite
export type AuxSubsprite = {
  shape: number; // (size << 2) | shape
  x: number;
  y: number;
};

// AuxSpritePose
export type AuxSpritePose = {
  tileCount: number;
  plttID: number;
  tileNum: number; // AuxSpriteFile の tiles の何枚目から使うか (tileOffset >> 5)
  subsprites: AuxSubsprite[];
};

// AuxSpriteEntry と、そこから引けるポーズ
export type AuxSpriteGfx = {
  id: number;
  flags: number;
  pw: number;
  ph: number;
  px: number;
  py: number;
  plttID: number; // Video_GetAuxSprite が最初のポーズから取る
  poses: AuxSpritePose[]; // このエントリから最後のエントリまでのポーズ全部, ゲームは poses の先頭から添字で引くだけなので後ろのエントリのポーズも使える
  poseCount: number; // このエントリ自身のポーズ数 (次のエントリの先頭まで)
  tiles: Uint8Array; // AuxSpriteFile の tiles 全体
};

// 全エントリを読む, ID 昇順
export const parseAuxSprites = (rom: DataView, fs: FileSystem): AuxSpriteGfx[] => {
  const start = fs.get(DIR_AUX_SPRITE, AUX_SPRITE_FILE);
  if (start === undefined) throw new Error("AuxSpriteFile not found");
  const u8 = (ofs: number) => rom.getUint8(start + ofs);
  const s8 = (ofs: number) => rom.getInt8(start + ofs);
  const u16 = (ofs: number) => rom.getUint16(start + ofs, true);
  const u32 = (ofs: number) => rom.getUint32(start + ofs, true);

  const entryCount = u32(0x04);
  const tilesOfs = u32(0x0C);
  const posesOfs = u32(0x10);
  const subspritesOfs = u32(0x14);
  const totalPoses = (subspritesOfs - posesOfs) / 12;
  const tiles = new Uint8Array(rom.buffer, rom.byteOffset + start + tilesOfs, posesOfs - tilesOfs);

  const pose = (idx: number): AuxSpritePose => {
    const p = posesOfs + idx * 12;
    const count = u8(p);
    const first = subspritesOfs + u32(p + 8);
    const subsprites: AuxSubsprite[] = [];
    for (let i = 0; i < count; i++) {
      const s = first + i * 4;
      subsprites.push({ shape: u8(s), x: s8(s + 2), y: s8(s + 3) });
    }
    return { tileCount: u8(p + 1), plttID: u16(p + 2), tileNum: u32(p + 4) >> 5, subsprites };
  };

  const allPoses: AuxSpritePose[] = [];
  for (let i = 0; i < totalPoses; i++) allPoses.push(pose(i));

  type Entry = Omit<AuxSpriteGfx, "poses" | "poseCount" | "plttID" | "tiles"> & { firstPose: number };
  const entries: Entry[] = [];
  for (let i = 0; i < entryCount; i++) {
    const e = 0x18 + i * 12;
    entries.push({ id: u16(e), flags: u8(e + 2), pw: u8(e + 4), ph: u8(e + 5), px: s8(e + 6), py: s8(e + 7), firstPose: u32(e + 8) / 12 });
  }

  // ポーズ数は持っていないので、次のエントリの先頭 (なければ配列の終わり) までとみなす
  const starts = [...new Set(entries.map((e) => e.firstPose)), totalPoses].sort((a, b) => a - b);
  const gfxs = entries.map(({ firstPose, ...e }): AuxSpriteGfx => {
    const end = starts.find((s) => s > firstPose) ?? totalPoses;
    const poses = allPoses.slice(firstPose);
    return { ...e, plttID: poses[0]?.plttID ?? 0, poses, poseCount: end - firstPose, tiles };
  });
  return gfxs.sort((a, b) => a.id - b.id);
};

// AuxSprite_DrawInternal と同じ配置でポーズを OBJ に分解する
// タイルはポーズの tileNum からサブスプライトの順に詰めて並ぶ (1D), 反転はスプライト全体にだけかかる
export const auxPoseToObjs = (gfx: AuxSpriteGfx, poseIdx: number, colors: Uint32Array, plttID: number, xflip = false, yflip = false): Obj[] => {
  const pose = gfx.poses[poseIdx];
  if (pose === undefined) return [];
  const p = plttID * 16;
  const pltt = p + 16 <= colors.length ? colors.subarray(p, p + 16) : FALLBACK_PLTT;
  const objs: Obj[] = [];
  let tileNum = pose.tileNum;
  for (const s of pose.subsprites) {
    const size = OBJ_SIZE[s.shape];
    if (size === undefined) continue;
    const [w, h] = size;
    objs.push({
      x: xflip ? -s.x - w : s.x,
      y: yflip ? -s.y - h : s.y,
      w,
      h,
      hflip: xflip,
      vflip: yflip,
      tiles: gfx.tiles,
      tileNum,
      tileStride: w / 8,
      pltt,
    });
    tileNum += (w / 8) * (h / 8);
  }
  return objs;
};

// パレット番号が範囲外のときのグレースケール
const FALLBACK_PLTT = Uint32Array.from({ length: 16 }, (_, i) => {
  const v = i * 17;
  return ((0xFF << 24) | (v << 16) | (v << 8) | v) >>> 0;
});

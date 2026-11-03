// MainSprite (DIR_MAIN_SPRITE) のファイル, see include/sprite_main.h in boktai2 decomp

import { type Obj, OBJ_SIZE } from "./render.ts";

// MainSpritePose
export type MainSpritePose = {
  unk_0: number;
  offsetX: number;
  offsetY: number;
  box: { right: number; bottom: number; left: number; top: number };
  subsprites: MainSubsprite[];
};

// MainAnimCmd
export type MainAnimCmd = {
  poseIdx: number;
  duration: number;
};

// MainAnim
export type MainAnim = {
  unk_0: number;
  cmds: MainAnimCmd[];
};

// MainSubsprite
export type MainSubsprite = {
  flip: number; // bit2: xflip, bit3: yflip
  shape: number; // (size << 2) | shape
  x: number;
  y: number;
  tileNum: number;
  paletteNum: number;
};

// MainSpriteGfxFile
export type MainSpriteGfx = {
  palStart: number;
  poses: MainSpritePose[];
  anims: MainAnim[];
  tiles: Uint8Array; // 4bpp, 32 bytes/tile, 幅 MAIN_SPRITE_SHEET_TILES タイルの2Dシート
};

export const parseMainSprite = (rom: DataView, start: number): MainSpriteGfx => {
  const u16 = (ofs: number) => rom.getUint16(start + ofs, true);
  const s16 = (ofs: number) => rom.getInt16(start + ofs, true);
  const u32 = (ofs: number) => rom.getUint32(start + ofs, true);

  const palStart = u16(0x00);
  const poseCount = u16(0x02);
  const animCount = u16(0x04);
  const tileCount = u16(0x0A);
  const posesOfs = u32(0x0C);
  const animsOfs = u32(0x10);
  const subspritesOfs = u32(0x14);
  const cmdsOfs = u32(0x18);
  const tilesOfs = u32(0x1C);

  const subsprite = (ofs: number): MainSubsprite => {
    const attr = u16(ofs + 6);
    return { flip: rom.getUint8(start + ofs), shape: rom.getUint8(start + ofs + 1), x: s16(ofs + 2), y: s16(ofs + 4), tileNum: attr & 0xFFF, paletteNum: attr >> 12 };
  };

  const poses: MainSpritePose[] = [];
  for (let i = 0; i < poseCount; i++) {
    const p = posesOfs + i * 20;
    const count = u16(p + 2);
    const first = subspritesOfs + u32(p + 0x10);
    const subsprites: MainSubsprite[] = [];
    for (let j = 0; j < count; j++) subsprites.push(subsprite(first + j * 8));
    poses.push({
      unk_0: u16(p),
      offsetX: s16(p + 4),
      offsetY: s16(p + 6),
      box: { right: s16(p + 8), bottom: s16(p + 0xA), left: s16(p + 0xC), top: s16(p + 0xE) },
      subsprites,
    });
  }

  const anims: MainAnim[] = [];
  for (let i = 0; i < animCount; i++) {
    const a = animsOfs + i * 8;
    const count = u16(a + 2);
    const first = cmdsOfs + u32(a + 4);
    const cmds: MainAnimCmd[] = [];
    for (let j = 0; j < count; j++) cmds.push({ poseIdx: u16(first + j * 4), duration: u16(first + j * 4 + 2) });
    anims.push({ unk_0: u16(a), cmds });
  }

  const tiles = new Uint8Array(rom.buffer, rom.byteOffset + start + tilesOfs, tileCount * 32);
  return { palStart, poses, anims, tiles };
};

// タイルは横16枚 (0x200 バイト) の2Dシートで並んでいる, 根拠: CopyMainSpriteTileDataToVram が1行ごとに転送元を 0x200 進める
export const MAIN_SPRITE_SHEET_TILES = 16;

// MainSprite_DrawInternal と同じ配置でポーズを OBJ に分解する
// xflip/yflip は SPRFLAG_XFLIP/SPRFLAG_YFLIP (スプライト全体の反転) に相当する
export const poseToObjs = (gfx: MainSpriteGfx, poseIdx: number, colors: Uint32Array, plttID: number, xflip = false, yflip = false): Obj[] => {
  const pose = gfx.poses[poseIdx];
  if (pose === undefined) return [];
  const objs: Obj[] = [];
  for (const s of pose.subsprites) {
    const size = OBJ_SIZE[s.shape];
    if (size === undefined) continue;
    const [w, h] = size;
    const p = (plttID + s.paletteNum) * 16;
    objs.push({
      x: (xflip ? -(s.x + w) : s.x) + pose.offsetX,
      y: (yflip ? -(s.y + h) : s.y) + pose.offsetY,
      w,
      h,
      hflip: ((s.flip & 4) !== 0) !== xflip,
      vflip: ((s.flip & 8) !== 0) !== yflip,
      tiles: gfx.tiles,
      tileNum: s.tileNum,
      tileStride: MAIN_SPRITE_SHEET_TILES,
      pltt: p + 16 <= colors.length ? colors.subarray(p, p + 16) : FALLBACK_PLTT,
    });
  }
  return objs;
};

// パレット番号が範囲外のときのグレースケール
const FALLBACK_PLTT = Uint32Array.from({ length: 16 }, (_, i) => {
  const v = i * 17;
  return ((0xFF << 24) | (v << 16) | (v << 8) | v) >>> 0;
});

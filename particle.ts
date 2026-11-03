// パーティクル (DIR_PARTICLE), see include/particle.h in boktai2 decomp
// このゲームには ParticleFile が1つしかない, タイルは LoadParticleFile が OBJ VRAM の先頭に流すので tileNum はファイル内の通し番号になる

import { DIR_PARTICLE, FileSystem } from "./fs.ts";
import { type Obj, OBJ_SIZE } from "./render.ts";

export const PGFLAG_BPP8 = 1 << 4;

// ParticleGroup
export type ParticleGroup = {
  id: number;
  flags: number;
  shape: number; // 1コマのサイズ (SpriteShape)
  tile: number; // このグループの先頭タイル
  plttID: number; // Particle_Add が当てる OBJ パレット
  poseCount: number; // 次のグループの先頭 (なければ末尾) までに入るコマ数
  poseLimit: number; // ファイルの末尾までに入るコマ数 (ポーズ番号はグループをはみ出しても引ける)
};

// ParticleFile
export type ParticleFile = {
  id: number;
  unk_00: number;
  groups: ParticleGroup[];
  tiles: Uint8Array;
};

export const tilesPerPose = (g: ParticleGroup) => {
  const [w, h] = OBJ_SIZE[g.shape] ?? [8, 8];
  return (w / 8) * (h / 8);
};

export const parseParticleFiles = (rom: DataView, fs: FileSystem): ParticleFile[] =>
  fs.list(DIR_PARTICLE).map(({ id, offset }) => {
    const tileCount = rom.getUint16(offset + 4, true);
    const groupCount = rom.getUint16(offset + 6, true);
    const raw = [];
    for (let i = 0; i < groupCount; i++) {
      const g = offset + 12 + i * 8;
      raw.push({ id: rom.getUint16(g, true), flags: rom.getUint8(g + 2), shape: rom.getUint8(g + 3), tile: rom.getUint16(g + 4, true), plttID: rom.getUint16(g + 6, true) });
    }
    const starts = [...raw.map((g) => g.tile), tileCount].sort((a, b) => a - b);
    const groups = raw.map((g): ParticleGroup => {
      const per = tilesPerPose({ ...g, poseCount: 0, poseLimit: 0 });
      const end = starts.find((s) => s > g.tile) ?? tileCount;
      return { ...g, poseCount: Math.floor((end - g.tile) / per), poseLimit: Math.floor((tileCount - g.tile) / per) };
    });
    const tiles = new Uint8Array(rom.buffer, rom.byteOffset + offset + rom.getUint32(offset + 8, true), tileCount * 32);
    return { id, unk_00: rom.getUint32(offset, true), groups, tiles };
  });

// Particle_SetPose / Particle_SetTile と同じタイルを使う OBJ 1枚, 原点は OBJ の左上 (Particle_Add の offset は 0)
// 8bpp (PGFLAG_BPP8) のグループはこのゲームに無いので 4bpp だけ扱う
export const particlePoseObjs = (file: ParticleFile, g: ParticleGroup, poseIdx: number, pltt: Uint32Array, xflip = false, yflip = false): Obj[] => {
  const [w, h] = OBJ_SIZE[g.shape] ?? [8, 8];
  return [{ x: 0, y: 0, w, h, hflip: xflip, vflip: yflip, tiles: file.tiles, tileNum: poseIdx * tilesPerPose(g) + g.tile, tileStride: w / 8, pltt }];
};

// ROM 内のファイルシステム (see src/file.c in boktai2 decomp)

// GetFile に渡すディレクトリID (include/file.h)
export const DIR_OBJPLTT = 0x9B1B;
export const DIR_BGPLTT = 0x92B3;
export const DIR_ANIMATION = 0x922E;
export const DIR_AUX_SPRITE = 0x98F5;
export const DIR_MAIN_SPRITE = 0xCB05;
export const DIR_TILESET = 0xCEEF;
export const DIR_TILE_MAP = 0xC091;
export const DIR_COLLISION_MAP = 0xAE6C;
export const DIR_PARTICLE = 0xCEAA;
export const DIR_FONT = 0xA635;

// GetFile が gFS を引く前に置き換える (ディレクトリID, ファイルID) の組
const DIR_REMAP: Record<number, [number, number]> = {
  [DIR_ANIMATION]: [0x9225, 0x5130],
  [DIR_OBJPLTT]: [0x9A65, 0x4679],
  [DIR_BGPLTT]: [0x9305, 0xD710],
  [DIR_AUX_SPRITE]: [0x9B05, 0x2117],
  [DIR_MAIN_SPRITE]: [0xC8E5, 0x5F29],
  [DIR_TILESET]: [0xCEE5, 0x4F2D],
  [DIR_TILE_MAP]: [0xC305, 0xE53E],
  [DIR_COLLISION_MAP]: [0xAF05, 0xAC2C],
  [DIR_PARTICLE]: [0xCF05, 0x0A4D],
  [DIR_FONT]: [0xA705, 0x6D24],
};

// gFS (FSEntry[12]) の ROM オフセット
const FS_OFFSET: Record<string, number> = {
  "U32J_rev1": 0x5B0D90,
  "U33J": 0x614D6C, // bokmagic (lib/src/Importer.cpp) の mftAddress
};

const ROM_BASE = 0x08000000;

export type FileEntry = {
  id: number;
  offset: number; // ROM 先頭からのオフセット
};

export class FileSystem {
  private dirs = new Map<number, number>(); // gFS の id -> Directory の ROM オフセット

  constructor(private rom: DataView, gameID: string) {
    const fs = FS_OFFSET[gameID];
    if (fs === undefined) throw new Error(`Unsupported gameID: ${gameID}`);
    for (let i = 0;; i++) {
      const id = rom.getUint32(fs + i * 8, true);
      if (id === 0) break;
      this.dirs.set(id, rom.getUint32(fs + i * 8 + 4, true) - ROM_BASE);
    }
  }

  // ディレクトリ内の全ファイル (ID 昇順)
  list(dirID: number): FileEntry[] {
    const d = this.directory(dirID);
    const rom = this.rom;
    const count = rom.getUint32(d, true);
    const ids = d + rom.getUint32(d + 4, true);
    const offsets = d + rom.getUint32(d + 8, true);
    const files: FileEntry[] = [];
    for (let i = 0; i < count; i++) {
      files.push({ id: rom.getUint16(ids + i * 2, true), offset: d + rom.getUint32(offsets + i * 4, true) });
    }
    return files;
  }

  // gFS のエントリのうち、ID の上位16ビットが dirID のものが指す先 (ROM オフセット) をそのまま返す
  // gScriptDirectory のように Directory の形をしていないもの用, 下位16ビットは作品ごとに違う (U32J: 0xA41E, U33J: 0x49BC)
  rawEntry(dirID: number): number | undefined {
    for (const [id, offset] of this.dirs) if (id >>> 16 === dirID) return offset;
    return undefined;
  }

  // GetFile(dirID, fileID), なければ undefined
  get(dirID: number, fileID: number): number | undefined {
    return this.list(dirID).find((f) => f.id === fileID)?.offset;
  }

  private directory(dirID: number): number {
    const remap = DIR_REMAP[dirID];
    if (remap === undefined) throw new Error(`Unknown directory: 0x${dirID.toString(16)}`);
    const d = this.dirs.get(((remap[0] << 16) | remap[1]) >>> 0);
    if (d === undefined) throw new Error(`Directory not found: 0x${dirID.toString(16)}`);
    return d;
  }
}

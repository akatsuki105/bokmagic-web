// 当たり判定マップ (DIR_COLLISION_MAP), see include/collision_map.h in boktai2 decomp
// 先頭が "HP" なら非圧縮、そうでなければ LZ77 で展開する (OpenCollisionMapFile)

import { DIR_COLLISION_MAP, type FileEntry, FileSystem } from "./fs.ts";
import { decompressLZ77 } from "./lz77.ts";

// CollisionMapTile
export type CollisionTile = {
  height: number; // heightStairs の下位4ビット
  stairs: number; // heightStairs の上位4ビット, 0: なし, 1: 縦, 2: 横
  occluder: number; // 0xFF でなし
  attr: number; // TileAttr
};

// Zone, X/Y は 1 タイル = 256, Z (高さ) は 1 タイル = 16
export type Zone = { x1: number; y1: number; x2: number; y2: number; z1: number; z2: number; id: number };

// PathNode
export type PathNode = { x: number; y: number; delay: number; command: number; unk_7: number };
export type Path = { nodeOffset: number; nodes: PathNode[] };

// NavIsland
export type NavRect = { minX: number; minY: number; maxX: number; maxY: number; portals: number[] }; // タイル単位
export type NavPortal = { x: number; y: number; unk_4: number; rects: number[] }; // 1 タイル = 256
export type NavIsland = { rects: NavRect[]; portals: NavPortal[]; distanceMap: Uint16Array };

export type CollisionMap = {
  id: number;
  compressed: boolean;
  unk_0: number;
  width: number; // タイル数
  height: number; // 奥行き (タイル数)
  tilemapOffsetX: number;
  tilemapOffsetY: number;
  tiles: CollisionTile[]; // [z * width + x] (Map_BuildRowOffsets が作る rowOffsets と同じ並び)
  zones: Zone[];
  paths: Path[];
  navMesh?: NavIsland[]; // ヘッダの navMesh が 0 なら無し
};

export const collisionFiles = (fs: FileSystem): FileEntry[] => fs.list(DIR_COLLISION_MAP);

export const parseCollisionMap = (rom: DataView, { id, offset }: FileEntry): CollisionMap => {
  const bytes = new Uint8Array(rom.buffer, rom.byteOffset);
  const raw = bytes[offset] === 0x48 && bytes[offset + 1] === 0x50; // "HP"
  // 展開先は gDecompressedCollisionMapHeader で、本体はその4バイト後ろ (gDecompressedCollisionMapFile) から始まる
  const data = raw ? bytes.subarray(offset) : decompressLZ77(bytes.subarray(offset)).subarray(4);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u8 = (o: number) => v.getUint8(o);
  const u16 = (o: number) => v.getUint16(o, true);
  const s16 = (o: number) => v.getInt16(o, true);
  const u32 = (o: number) => v.getUint32(o, true);

  // CollisionMapTileData
  const td = u32(0x04);
  const width = s16(td + 4), height = s16(td + 6);
  const tiles: CollisionTile[] = [];
  for (let k = 0; k < width * height; k++) {
    const t = td + 0x0C + k * 4;
    const hs = u8(t);
    tiles.push({ height: hs & 0xF, stairs: hs >> 4, occluder: u8(t + 1), attr: u16(t + 2) });
  }

  // ZoneData
  const zd = u32(0x08);
  const zones: Zone[] = [];
  for (let k = 0; k < u8(zd); k++) {
    const z = zd + 4 + k * 12;
    zones.push({ x1: s16(z), y1: s16(z + 2), x2: s16(z + 4), y2: s16(z + 6), z1: u8(z + 8), z2: u8(z + 9), id: u16(z + 10) });
  }

  // PathData, nodeOffset は PathData の先頭から (Map_GetPathNodes)
  const pd = u32(0x0C);
  const paths: Path[] = [];
  for (let k = 0; k < u16(pd); k++) {
    const p = pd + 4 + k * 4;
    const nodeOffset = u16(p + 2);
    const nodes: PathNode[] = [];
    for (let n = 0; n < u8(p); n++) {
      const nd = pd + nodeOffset + n * 8;
      nodes.push({ x: u16(nd), y: u16(nd + 2), delay: u16(nd + 4), command: u8(nd + 6), unk_7: u8(nd + 7) });
    }
    paths.push({ nodeOffset, nodes });
  }

  // NavMesh, 島は NavMesh の先頭から, 島の中の配列は島の先頭から
  const nm = u32(0x10);
  let navMesh: NavIsland[] | undefined;
  if (nm) {
    navMesh = [];
    for (let k = 0; k < u16(nm); k++) {
      const is = nm + u32(nm + 4 + k * 4);
      const rects: NavRect[] = [], portals: NavPortal[] = [];
      const rOfs = is + u32(is + 8), pOfs = is + u32(is + 12), dOfs = is + u32(is + 16);
      for (let r = 0; r < u16(is); r++) {
        const o = rOfs + r * 16;
        const ps: number[] = [];
        for (let j = 0; j < 12 && u8(o + 4 + j) !== 0xFF; j++) ps.push(u8(o + 4 + j));
        rects.push({ minX: u8(o), minY: u8(o + 1), maxX: u8(o + 2), maxY: u8(o + 3), portals: ps });
      }
      for (let q = 0; q < u16(is + 2); q++) {
        const o = pOfs + q * 12;
        const rs: number[] = [];
        for (let j = 0; j < 6 && u8(o + 6 + j) !== 0xFF; j++) rs.push(u8(o + 6 + j));
        portals.push({ x: u16(o), y: u16(o + 2), unk_4: u16(o + 4), rects: rs });
      }
      const distanceMap = new Uint16Array(u16(is + 4));
      for (let j = 0; j < distanceMap.length; j++) distanceMap[j] = u16(dOfs + j * 2);
      navMesh.push({ rects, portals, distanceMap });
    }
  }

  return { id, compressed: !raw, unk_0: u32(td), width, height, tilemapOffsetX: s16(td + 8), tilemapOffsetY: s16(td + 10), tiles, zones, paths, navMesh };
};

// ワールド座標 (x, z は 1 タイル = 256, y は高さで 1 段 = 256) を、対になるタイルマップのピクセル座標にする
// MainSprite_DrawListInternal のワールド -> 画面の投影に、BG のスクロール (hofs = カメラ.x + tilemapX - 120, Camera_SetTilemapOffset の tilemapX = tilemapOffsetX >> 4) を足すとカメラが消えてこの形になる
export const projectToTilemap = (c: CollisionMap, x: number, z: number, y: number): [number, number] => {
  const a = Math.trunc((((x >> 1) + (z >> 1)) * 48) / 256);
  const b = Math.trunc((y * 24) / 256);
  return [Math.trunc((((x >> 1) - (z >> 1)) * 48) / 256) + (c.tilemapOffsetX >> 4), a - b + (c.tilemapOffsetY >> 4)];
};

// タイル (tx, tz) の上面の4隅 (左奥, 右奥, 右手前, 左手前 の順でなく x0z0, x1z0, x1z1, x0z1) のワールド座標の高さ
// 階段は Map_HasLineOfSight と同じく、縦 (1) は z、横 (2) は x の下位8ビットだけ低くなる
export const tileCornerHeights = (t: CollisionTile): [number, number, number, number] => {
  const h = t.height << 8;
  if (t.stairs === 1) return [h, h, h - 255, h - 255];
  if (t.stairs === 2) return [h, h - 255, h - 255, h];
  return [h, h, h, h];
};

// タイル (tx, tz) の上面をタイルマップ上の4点にする
export const tileQuad = (c: CollisionMap, tx: number, tz: number): [number, number][] => {
  const t = c.tiles[tz * c.width + tx];
  const [h00, h10, h11, h01] = tileCornerHeights(t);
  const x0 = tx * 256, x1 = x0 + 256, z0 = tz * 256, z1 = z0 + 256;
  return [projectToTilemap(c, x0, z0, h00), projectToTilemap(c, x1, z0, h10), projectToTilemap(c, x1, z1, h11), projectToTilemap(c, x0, z1, h01)];
};

// 点が凸四角形 q の中にあるか (辺の外積の符号がそろっているか)
const inQuad = (q: [number, number][], x: number, y: number) => {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = q[k], [bx, by] = q[(k + 1) % 4];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
};

// タイルマップのピクセル (px, py) に上面が見えているタイル, 手前 (x + z が大きい) のものを優先する
export const tileAtTilemap = (c: CollisionMap, px: number, py: number): [number, number] | null => {
  let best: [number, number] | null = null;
  for (let z = 0; z < c.height; z++) {
    for (let x = 0; x < c.width; x++) {
      if (best && x + z <= best[0] + best[1]) continue;
      if (inQuad(tileQuad(c, x, z), px, py)) best = [x, z];
    }
  }
  return best;
};

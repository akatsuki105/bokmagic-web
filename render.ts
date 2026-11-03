// OBJ (GBA のハードウェアスプライト) の集まりを ImageData に描く

// key: (size << 2) | shape, see SpriteShape in include/sprite_common.h
export const OBJ_SIZE: Record<number, [w: number, h: number]> = {
  0: [8, 8],
  4: [16, 16],
  8: [32, 32],
  12: [64, 64],
  1: [16, 8],
  5: [32, 8],
  9: [32, 16],
  13: [64, 32],
  2: [8, 16],
  6: [8, 32],
  10: [16, 32],
  14: [32, 64],
};

// 4bpp の OBJ 1つ
export type Obj = {
  x: number; // 原点からの左上の座標
  y: number;
  w: number;
  h: number;
  hflip: boolean;
  vflip: boolean;
  tiles: Uint8Array;
  tileNum: number; // tiles の何枚目から使うか
  tileStride: number; // tiles 上で1行下のタイルまでの枚数, 1D マッピングなら w / 8
  pltt: Uint32Array; // RGBA8888[16], 色0 は透明扱い
};

export type Rendered = {
  image: ImageData;
  originX: number; // image 上の原点の位置
  originY: number;
};

export type Bounds = { left: number; top: number; right: number; bottom: number };

export const objBounds = (objs: Obj[]): Bounds => {
  const b = { left: 0, top: 0, right: 0, bottom: 0 }; // 原点は必ず含める
  for (const o of objs) {
    b.left = Math.min(b.left, o.x);
    b.top = Math.min(b.top, o.y);
    b.right = Math.max(b.right, o.x + o.w);
    b.bottom = Math.max(b.bottom, o.y + o.h);
  }
  return b;
};

// objs の後ろほど手前に描く
// Video_BuildOAM は gStagedOAMBuffer を z ごとに後入れ先出しのリストにしてから OAM に並べるので、同じ z なら後に積んだものほど OAM の番号が若く手前に出る
export const renderObjs = (objs: Obj[], bounds: Bounds = objBounds(objs)): Rendered => {
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const image = new ImageData(width, height);
  const out = new Uint32Array(image.data.buffer);

  for (const o of objs) {
    for (let py = 0; py < o.h; py++) {
      const sy = o.vflip ? o.h - 1 - py : py;
      const dy = o.y + py - bounds.top;
      if (dy < 0 || dy >= height) continue;
      for (let px = 0; px < o.w; px++) {
        const sx = o.hflip ? o.w - 1 - px : px;
        const dx = o.x + px - bounds.left;
        if (dx < 0 || dx >= width) continue;
        const tile = o.tileNum + (sy >> 3) * o.tileStride + (sx >> 3);
        const byte = o.tiles[tile * 32 + (sy & 7) * 4 + ((sx & 7) >> 1)];
        if (byte === undefined) continue;
        const c = (sx & 1) ? byte >> 4 : byte & 0xF;
        if (c !== 0) out[dy * width + dx] = o.pltt[c];
      }
    }
  }

  return { image, originX: -bounds.left, originY: -bounds.top };
};

// 4bpp の 8x8 タイルを tileNums の順に cols 枚ずつ並べて描く (タイルセットやタイルマップの確認用)
// pltt は RGBA8888[16], transparent0 なら色0 は描かない
export const renderTileGrid = (tiles: Uint8Array, tileNums: ArrayLike<number>, cols: number, pltt: Uint32Array, transparent0 = true): Rendered => {
  const rows = Math.max(1, Math.ceil(tileNums.length / cols));
  const width = cols * 8;
  const image = new ImageData(width, rows * 8);
  const out = new Uint32Array(image.data.buffer);
  for (let k = 0; k < tileNums.length; k++) {
    const base = tileNums[k] * 32;
    const ox = (k % cols) * 8;
    const oy = Math.floor(k / cols) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const byte = tiles[base + y * 4 + (x >> 1)];
        if (byte === undefined) continue;
        const c = (x & 1) ? byte >> 4 : byte & 0xF;
        if (c === 0 && transparent0) continue;
        out[(oy + y) * width + ox + x] = pltt[c];
      }
    }
  }
  return { image, originX: 0, originY: 0 };
};

// パレットが決まらないときの 16 階調 (色0 が黒, 色15 が白)
export const GRAYSCALE_PLTT = Uint32Array.from({ length: 16 }, (_, i) => {
  const v = i * 17;
  return ((0xFF << 24) | (v << 16) | (v << 8) | v) >>> 0;
});

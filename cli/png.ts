// RGBA8888 の画像 (Pixels) を PNG にする. 圧縮は Deno / ブラウザ標準の CompressionStream ("deflate" は zlib 形式で PNG の IDAT にそのまま使える)

import type { Pixels } from "../render.ts";

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const deflate = async (data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());

export const encodePNG = async (img: Pixels): Promise<Uint8Array> => {
  const { width, height, data } = img;
  // 各行の先頭にフィルタの種類 (0: なし) を置く
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 ビット, RGBA, 圧縮・フィルタ・インターレースは標準
  const parts = [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), o += p.length;
  return out;
};

// 最近傍で整数倍に拡大する
export const scalePixels = (img: Pixels, scale: number): Pixels => {
  if (scale <= 1) return img;
  const width = img.width * scale, height = img.height * scale;
  const src = new Uint32Array(img.data.buffer), out = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / scale) * img.width;
    for (let x = 0; x < width; x++) out[y * width + x] = src[sy + Math.floor(x / scale)];
  }
  return { width, height, data: new Uint8ClampedArray(out.buffer) };
};

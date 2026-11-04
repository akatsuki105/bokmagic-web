// フォント (DIR_FONT), see src/font.c in boktai2 decomp
// ゲームが読むのはファイル 0x3F51 だけ (Font_LoadInfo)

import { DIR_FONT, FileSystem } from "./fs.ts";
import { newPixels, type Rendered } from "./render.ts";

export const FONT_FILE = 0x3F51;

// FontInfo (FontFile)
export type Font = {
  id: number;
  hankakuCount: number; // 半角 (8x16, 2タイル) の字形数
  zenkakuCount: number; // 全角 (16x16, 4タイル) の字形数
  hankaku: Uint8Array; // 4bpp, 字形ごとに上・下の2タイル
  zenkaku: Uint8Array; // 4bpp, 字形ごとに左上・右上・左下・右下の4タイル
};

export const parseFonts = (rom: DataView, fs: FileSystem): Font[] =>
  fs.list(DIR_FONT).map(({ id, offset }) => {
    const hankakuCount = rom.getUint16(offset, true);
    const zenkakuCount = rom.getUint16(offset + 2, true);
    const at = (ofs: number, len: number) => new Uint8Array(rom.buffer, rom.byteOffset + offset + ofs, len);
    return {
      id,
      hankakuCount,
      zenkakuCount,
      hankaku: at(rom.getUint32(offset + 4, true), hankakuCount * 64),
      zenkaku: at(rom.getUint32(offset + 8, true), zenkakuCount * 128),
    };
  });

export type GlyphKind = "hankaku" | "zenkaku";

// 字形1つの大きさ (ピクセル)
export const glyphSize = (kind: GlyphKind): [number, number] => (kind === "hankaku" ? [8, 16] : [16, 16]);

// 字形を番号順に cols 個ずつ並べて描く
// Font_DrawHankakuChar / Font_DrawZenkakuChar と同じ並びでタイルを置き、Font_AcquireGlyph と同じく各ドットに (style << 2) を OR してから
// BG パレットの1本 (ゲームは常に 15 本目) で色を付ける, 色0 は透明
export const renderGlyphs = (font: Font, kind: GlyphKind, cols: number, colors: Uint32Array, style: number): Rendered => {
  const count = kind === "hankaku" ? font.hankakuCount : font.zenkakuCount;
  const data = kind === "hankaku" ? font.hankaku : font.zenkaku;
  const [gw, gh] = glyphSize(kind);
  const tilesPerGlyph = (gw / 8) * (gh / 8);
  const width = cols * gw;
  const image = newPixels(width, Math.max(1, Math.ceil(count / cols)) * gh);
  const out = new Uint32Array(image.data.buffer);
  const or = (style & 3) << 2;
  for (let g = 0; g < count; g++) {
    const gx = (g % cols) * gw, gy = Math.floor(g / cols) * gh;
    for (let t = 0; t < tilesPerGlyph; t++) {
      // 半角は上→下, 全角は左上→右上→左下→右下
      const tx = gx + (kind === "hankaku" ? 0 : (t & 1) * 8);
      const ty = gy + (kind === "hankaku" ? t : t >> 1) * 8;
      const base = (g * tilesPerGlyph + t) * 32;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const byte = data[base + y * 4 + (x >> 1)];
          const c = ((x & 1) ? byte >> 4 : byte & 0xF) | or;
          if (c !== 0) out[(ty + y) * width + tx + x] = colors[c];
        }
      }
    }
  }
  return { image, originX: 0, originY: 0 };
};

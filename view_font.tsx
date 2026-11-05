// フォント (DIR_FONT) のタブ, 半角・全角の字形を番号順に並べる

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { FONT_FILE, type GlyphKind, glyphSize, parseFonts, renderGlyphs } from "./font.ts";
import { parseBgPlttFiles } from "./bgpltt.ts";
import { HANKAKU_CHARS, ZENKAKU_CHARS } from "./generated/charmap.ts";
import { decomp, hasDecompTables } from "./decomp.ts";
import { AssetView, bgpName, Card, Check, CursorCard, Field, Fields, hex4, InfoTable, NumberStepper, Segmented, Slider, SpriteCanvas, Swatches } from "./components.tsx";

// Font_SetPltt が 14・15 本目を差し替えるのに使う BG パレット (0: BGP_529C, 1: BGP_539C)
const FONT_PLTTS = [0x529C, 0x539C];
const FONT_PLTT_ROW = 15; // Font_DrawHankakuChar / Font_DrawZenkakuChar はマップに常に 15 本目を書く

// FONT_PLTTS が無い作品 (U3IJ) で使う色. 字形のドットは 1-4 (4 が地) なので、1 を黒・4 を白にした灰色にする (style で 4 を足した色も同じ明るさ)
const FALLBACK_LEVELS = [0x20, 0x60, 0xA0, 0xF0];
const FALLBACK_PLTT = Uint32Array.from({ length: 16 }, (_, i) => {
  if (i === 0) return 0;
  const v = FALLBACK_LEVELS[(i - 1) & 3];
  return ((0xFF << 24) | (v << 16) | (v << 8) | v) >>> 0;
});

// 字形番号を文字コードに戻す (半角: + 0x20, 全角: (0x80 | 上位) と 下位の2バイト)
// U32J の text_renderer.c から読んだ変換なので、ほかの作品 (文字コードが違う) では使わない
const codeOf = (kind: GlyphKind, g: number) => (kind === "hankaku" ? (g + 0x20).toString(16).toUpperCase().padStart(2, "0") : `${((g >> 8) | 0x80).toString(16).toUpperCase()} ${(g & 0xFF).toString(16).toUpperCase().padStart(2, "0")}`);

export const FontViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  // ゲームが使うフォントファイル (FONT_FILE) を ID で引く, 無ければディレクトリの先頭
  const font = useMemo(() => {
    const fonts = parseFonts(rom.data, rom.fs, rom.id);
    return fonts.find((f) => f.id === FONT_FILE) ?? fonts[0];
  }, [rom]);
  const bgFiles = useMemo(() => parseBgPlttFiles(rom.data, rom.fs), [rom]);
  const [kind, setKind] = useState<GlyphKind>("zenkaku");
  const plttFiles = useMemo(() => FONT_PLTTS.filter((id) => bgFiles.some((f) => f.id === id)), [bgFiles]);
  const [plttFile, setPlttFile] = useState(plttFiles[0]);
  const [row, setRow] = useState(FONT_PLTT_ROW);
  const [style, setStyle] = useState(0);
  const [cols, setCols] = useState(16);
  const [scale, setScale] = useState(2);
  const [grid, setGrid] = useState(true);
  const [hover, setHover] = useState(-1);

  const colors = useMemo(() => {
    const f = bgFiles.find((f) => f.id === plttFile);
    return f ? f.colors.subarray(row * 16, row * 16 + 16) : FALLBACK_PLTT;
  }, [bgFiles, plttFile, row]);
  const rendered = useMemo(() => renderGlyphs(font, kind, cols, colors, style), [font, kind, cols, colors, style]);
  const [gw, gh] = glyphSize(font, kind);
  const count = kind === "hankaku" ? font.hankakuCount : font.zenkakuCount;
  const chars = decomp(kind === "hankaku" ? HANKAKU_CHARS : ZENKAKU_CHARS);

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {(["hankaku", "zenkaku"] as const).map((k) => (
          <li key={k} class={k === kind ? "selected" : ""} onClick={() => setKind(k)}>
            {k === "hankaku" ? `半角 (${font.hankakuCount})` : `全角 (${font.zenkakuCount})`}
          </li>
        ))}
      </ul>
      <AssetView
        title={kind === "hankaku" ? "半角" : "全角"}
        desc={`${kind === "hankaku" ? "半角" : "全角"}の字形 (${gw}x${gh}) を番号順に並べています。style は Font_AcquireGlyph と同じく、各ドットに style << 2 を OR します`}
        stage={
          <SpriteCanvas
            rendered={rendered}
            scale={scale}
            grid={grid ? [gw, gh] : undefined}
            onHover={(x, y) => setHover(x < 0 ? -1 : Math.floor(y / gh) * cols + Math.floor(x / gw))}
          />
        }
      >
        <Card title="パレット" tip={`Font_SetPltt(0) が ${hex4(FONT_PLTTS[0])}、Font_SetPltt(1) が ${hex4(FONT_PLTTS[1])} の 14・15 本目を差し替える. 文字は 15 本目で描く`}>
          <Fields>
            {plttFiles.length > 0
              ? (
                <>
                  <Field label="ファイル">
                    <Segmented options={plttFiles.map((id) => [id, bgpName(id) ?? hex4(id)] as const)} value={plttFile ?? -1} onChange={setPlttFile} />
                  </Field>
                  <Field label="行" title="Font_DrawHankakuChar / Font_DrawZenkakuChar は常に 15 本目で描く">
                    <NumberStepper value={row} min={0} max={15} onChange={setRow} />
                  </Field>
                </>
              )
              : (
                <Field label="ファイル">
                  <span class="note">この ROM にはフォント用の BG パレット ({FONT_PLTTS.map((id) => hex4(id)).join(", ")}) が無いので、灰色で描きます</span>
                </Field>
              )}
            <Field label="色">
              <Swatches colors={colors} start={0} />
            </Field>
          </Fields>
        </Card>
        <Card title="表示">
          <Fields>
            <Field label="スタイル" title="style: Font_AcquireGlyph が各ドットに style << 2 を OR する. 0: 通常, 1: <WEIGHT> <ALTER>, 2: <NONSEL> <UVMOJI>, 3: ゲームでは使わない">
              <Segmented options={[[0, "0"], [1, "1"], [2, "2"], [3, "3"]] as const} value={style} onChange={setStyle} />
            </Field>
            <Field label="横の字数">
              <Slider value={cols} min={1} max={64} onChange={setCols} />
            </Field>
            <Field label="拡大">
              <Slider value={scale} min={1} max={8} onChange={setScale} format={(v) => `${v}x`} />
            </Field>
            <Field label="Overlay">
              <Check checked={grid} onChange={setGrid}>Grid</Check>
            </Field>
          </Fields>
        </Card>
        <CursorCard
          rows={hover >= 0 && hover < count
            ? [
              ["glyph", `${hover} (0x${hover.toString(16).toUpperCase()})`],
              ...(hasDecompTables() ? [["code", codeOf(kind, hover)], ["char", chars[hover] ?? "(charmap に無し)"]] as [string, string][] : [["code", "この作品の文字コードは分かっていません"]] as [string, string][]),
            ]
            : null}
          minRows={3}
        />
        <Card title="Metadata">
          <InfoTable
            rows={[
              ["hankaku", `${font.hankakuCount} 字, 8x16 px`, "半角 (タイル 2 枚)"],
              ["zenkaku", `${font.zenkakuCount} 字, ${font.zenkakuSize}x${font.zenkakuSize} px`, font.zenkakuSize === 12 ? "全角 (12x12 をタイルに分けず 72 バイトで持つ)" : "全角 (タイル 4 枚)"],
              ["file", hex4(font.id), "ゲームが読むフォントファイル (Font_LoadInfo)"],
            ]}
          />
        </Card>
      </AssetView>
    </div>
  );
};

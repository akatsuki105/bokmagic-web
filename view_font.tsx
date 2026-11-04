// フォント (DIR_FONT) のタブ, 半角・全角の字形を番号順に並べる

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { type GlyphKind, glyphSize, parseFonts, renderGlyphs } from "./font.ts";
import { parseBgPlttFiles } from "./bgpltt.ts";
import { HANKAKU_CHARS, ZENKAKU_CHARS } from "./generated/charmap.ts";
import { decomp, hasDecompTables } from "./decomp.ts";
import { bgpLabel, Desc, hex4, InfoTable, NumberStepper, SpriteCanvas, Swatches } from "./components.tsx";

// Font_SetPltt が 14・15 本目を差し替えるのに使う BG パレット (0: BGP_529C, 1: BGP_539C)
const FONT_PLTTS = [0x529C, 0x539C];
const FONT_PLTT_ROW = 15; // Font_DrawHankakuChar / Font_DrawZenkakuChar はマップに常に 15 本目を書く

// 字形番号を文字コードに戻す (半角: + 0x20, 全角: (0x80 | 上位) と 下位の2バイト)
// U32J の text_renderer.c から読んだ変換なので、ほかの作品 (文字コードが違う) では使わない
const codeOf = (kind: GlyphKind, g: number) => (kind === "hankaku" ? (g + 0x20).toString(16).toUpperCase().padStart(2, "0") : `${((g >> 8) | 0x80).toString(16).toUpperCase()} ${(g & 0xFF).toString(16).toUpperCase().padStart(2, "0")}`);

export const FontViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const font = useMemo(() => parseFonts(rom.data, rom.fs)[0], [rom]);
  const bgFiles = useMemo(() => parseBgPlttFiles(rom.data, rom.fs), [rom]);
  const [kind, setKind] = useState<GlyphKind>("zenkaku");
  const [plttFile, setPlttFile] = useState(FONT_PLTTS[0]);
  const [row, setRow] = useState(FONT_PLTT_ROW);
  const [style, setStyle] = useState(0);
  const [cols, setCols] = useState(16);
  const [scale, setScale] = useState(2);
  const [grid, setGrid] = useState(true);
  const [hover, setHover] = useState(-1);

  const colors = useMemo(() => {
    const f = bgFiles.find((f) => f.id === plttFile);
    return f ? f.colors.subarray(row * 16, row * 16 + 16) : new Uint32Array(16);
  }, [bgFiles, plttFile, row]);
  const rendered = useMemo(() => renderGlyphs(font, kind, cols, colors, style), [font, kind, cols, colors, style]);
  const [gw, gh] = glyphSize(kind);
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
      <div class="sprite-view">
        <h2>{kind === "hankaku" ? "半角" : "全角"}</h2>
        <Desc text={`${kind === "hankaku" ? "半角" : "全角"}の字形 (${gw}x${gh}) を番号順に並べています。style は Font_AcquireGlyph と同じく、各ドットに style << 2 を OR します`} />
        <div class="controls">
          {FONT_PLTTS.map((id, i) => (
            <label key={id}>
              <input type="radio" name="font-pltt" checked={plttFile === id} onChange={() => setPlttFile(id)} /> {bgpLabel(id, false)} (Font_SetPltt({i}))
            </label>
          ))}
          <NumberStepper label="palette" value={row} min={0} max={15} onChange={setRow} />
          <Swatches colors={colors} start={0} />
        </div>
        <div class="controls">
          <NumberStepper label="style" value={style} min={0} max={3} onChange={setStyle} />
          <NumberStepper label="columns" value={cols} min={1} max={64} onChange={setCols} />
          <label>
            scale <input type="number" min={1} max={8} value={scale} onInput={(e) => setScale(Number(e.currentTarget.value))} />
          </label>
          <label>
            <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.currentTarget.checked)} /> grid
          </label>
        </div>
        <p class="mono hover-line">
          {hover >= 0 && hover < count && `#${hover} (0x${hover.toString(16).toUpperCase()})` + (hasDecompTables() ? ` code ${codeOf(kind, hover)}: ${chars[hover] ?? "(charmap に無し)"}` : " (この作品の文字コードは分かっていないので、コードと文字は出しません)")}
        </p>
        <SpriteCanvas
          rendered={rendered}
          scale={scale}
          grid={grid ? [gw, gh] : undefined}
          onHover={(x, y) => setHover(x < 0 ? -1 : Math.floor(y / gh) * cols + Math.floor(x / gw))}
        />
        <InfoTable
          rows={[
            ["file", hex4(font.id)],
            ["glyph size", `${gw}x${gh} (${(gw / 8) * (gh / 8)} tiles)`],
            ["glyphs", count],
            ["hankaku", font.hankakuCount],
            ["zenkaku", font.zenkakuCount],
            ["palette", `${bgpLabel(plttFile, false)} row ${row}`],
          ]}
        />
      </div>
    </div>
  );
};

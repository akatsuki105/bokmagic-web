// BG のタイルセット (DIR_TILESET) のタブ, 部品 (TileSetPart) ごとにタイルを並べて表示する

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { parseTileSets, type TileSet } from "./tileset.ts";
import { parseBgPlttFiles } from "./bgpltt.ts";
import { renderTileGrid } from "./render.ts";
import { type BgPlttChoice, bgPlttColors, BgPlttSelect, hex4, NumberStepper, SpriteCanvas } from "./components.tsx";

export const TilesetViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const tilesets = useMemo(() => parseTileSets(rom.data, rom.fs), [rom]);
  const bgFiles = useMemo(() => parseBgPlttFiles(rom.data, rom.fs), [rom]);
  const [fileIdx, setFileIdx] = useState(0);
  const [partIdx, setPartIdx] = useState(0);
  // 部品を切り替えても表示設定は引き継ぐ
  const [pltt, setPltt] = useState<BgPlttChoice>({ file: null, row: 0 });
  const [cols, setCols] = useState(16);
  const [scale, setScale] = useState(2);
  const [grid, setGrid] = useState(false);
  const [transparent0, setTransparent0] = useState(true);

  const ts = tilesets[fileIdx];
  const colors = useMemo(() => bgPlttColors(bgFiles, pltt), [bgFiles, pltt]);

  return (
    <div class="viewer">
      <div>
        {tilesets.length > 1 && (
          <select
            value={fileIdx}
            onChange={(e) => {
              setFileIdx(Number(e.currentTarget.value));
              setPartIdx(0);
            }}
          >
            {tilesets.map((t, i) => <option key={t.id} value={i}>{hex4(t.id)}</option>)}
          </select>
        )}
        <ul class="sprite-list">
          {ts.parts.map((p, i) => (
            <li key={i} class={i === partIdx ? "selected" : ""} onClick={() => setPartIdx(i)}>
              #{i} {hex4(p.id)}
            </li>
          ))}
        </ul>
      </div>
      <div class="sprite-view">
        <h2>
          part {hex4(ts.parts[partIdx].id)} (#{partIdx})
        </h2>
        <p>
          TileSetFile {hex4(ts.id)}: {ts.parts.length} parts, {ts.refCount} refs, {ts.tiles.length / 32} tiles, unk_2: {ts.unk_2}
        </p>
        <div class="controls">
          <BgPlttSelect files={bgFiles} value={pltt} onChange={setPltt} />
        </div>
        <div class="controls">
          <NumberStepper label="columns" value={cols} min={1} max={64} onChange={setCols} />
          <label>
            scale <input type="number" min={1} max={8} value={scale} onInput={(e) => setScale(Number(e.currentTarget.value))} />
          </label>
          <label>
            <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.currentTarget.checked)} /> grid
          </label>
          <label>
            <input type="checkbox" checked={transparent0} onChange={(e) => setTransparent0(e.currentTarget.checked)} /> 色0 を透明にする
          </label>
        </div>
        <PartView ts={ts} partIdx={partIdx} colors={colors} cols={cols} scale={scale} grid={grid} transparent0={transparent0} />
      </div>
    </div>
  );
};

const PartView: FunctionComponent<{ ts: TileSet; partIdx: number; colors: Uint32Array; cols: number; scale: number; grid: boolean; transparent0: boolean }> = ({ ts, partIdx, colors, cols, scale, grid, transparent0 }) => {
  const part = ts.parts[partIdx];
  const rendered = useMemo(() => renderTileGrid(ts.tiles, part.refs, cols, colors, transparent0), [ts, part, cols, colors, transparent0]);
  const [hover, setHover] = useState(-1); // マウスの下にある、部品の中で何枚目のタイルか

  const onHover = (x: number, y: number) => {
    const k = x < 0 ? -1 : Math.floor(y / 8) * cols + Math.floor(x / 8);
    setHover(k >= 0 && k < part.tileCount ? k : -1);
  };

  let min = Infinity, max = -Infinity;
  for (const r of part.refs) {
    min = Math.min(min, r);
    max = Math.max(max, r);
  }

  return (
    <>
      <p>
        tiles: {part.tileCount}, startIndex: {hex4(part.startIndex)} (refs[{part.startIndex / 2}]), refs → tiles[{min}..{max}]
      </p>
      <p class="mono">{hover >= 0 ? `#${hover} (読み込み先の先頭 + ${hover}) → tiles[${part.refs[hover]}]` : "タイルにマウスを乗せると番号を表示します"}</p>
      <SpriteCanvas rendered={rendered} scale={scale} grid={grid ? 8 : undefined} onHover={onHover} />
    </>
  );
};

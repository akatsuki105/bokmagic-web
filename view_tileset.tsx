// BG のタイルセット (DIR_TILESET) のタブ, 部品 (TileSetPart) ごとにタイルを並べて表示する

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { isSupported, type ROMFile } from "./rom.ts";
import { mapEntries } from "./analysis.ts";
import { parseTileSets, type TileSet } from "./tileset.ts";
import { parseBgPlttFiles } from "./bgpltt.ts";
import { renderTileGrid } from "./render.ts";
import { AssetView, type BgPlttChoice, bgPlttColors, BgPlttSelect, Card, Check, CursorCard, Field, Fields, hex4, InfoTable, MapLink, Slider, SpriteCanvas, UsedByCard } from "./components.tsx";

export const TilesetViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const tilesets = useMemo(() => parseTileSets(rom.data, rom.fs, rom.id), [rom]);
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
      <div class="list-pane">
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
              {hex4(p.id)}
            </li>
          ))}
        </ul>
      </div>
      <PartView rom={rom} ts={ts} partIdx={partIdx} colors={colors} cols={cols} scale={scale} grid={grid} transparent0={transparent0}>
        <Fields>
          <BgPlttSelect files={bgFiles} value={pltt} onChange={setPltt} />
          <Field label="横の枚数">
            <Slider value={cols} min={1} max={64} onChange={setCols} />
          </Field>
          <Field label="拡大">
            <Slider value={scale} min={1} max={8} onChange={setScale} format={(v) => `${v}x`} />
          </Field>
          <Field label="Overlay">
            <Check checked={grid} onChange={setGrid}>8x8 Grid</Check>
          </Field>
          <Field label="色0">
            <Check checked={transparent0} onChange={setTransparent0}>透明にする</Check>
          </Field>
        </Fields>
      </PartView>
    </div>
  );
};

// children: 表示の操作 (右の欄の「表示」のカードに入れる)
const PartView: FunctionComponent<{ rom: ROMFile; ts: TileSet; partIdx: number; colors: Uint32Array; cols: number; scale: number; grid: boolean; transparent0: boolean }> = ({ rom, ts, partIdx, colors, cols, scale, grid, transparent0, children }) => {
  const part = ts.parts[partIdx];
  // この部品を読む Map (Cmd_LoadTileSet の '.c' にこの部品 ID があるもの)
  const scripted = isSupported(rom, "script");
  const maps = useMemo(() => (scripted ? mapEntries(rom).filter((e) => e.scenes.some((sc) => sc.tilesets.some((c) => (c.args.c ?? []).includes(part.id)))) : []), [rom, part]);
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
    <AssetView title={hex4(part.id)} desc={`タイルセット ${hex4(ts.id)} の部品`} stage={<SpriteCanvas rendered={rendered} scale={scale} grid={grid ? 8 : undefined} onHover={onHover} />}>
      <Card title="表示">{children}</Card>
      <CursorCard rows={hover >= 0 ? [["位置", `部品の中の ${hover} 枚目`, "VRAM では、読み込み先の先頭からこの枚数だけ後ろに置かれる"], ["tile", `tiles[${part.refs[hover]}]`, "タイルセットのタイルの何枚目か"]] : null} minRows={2} />
      <Card title="Metadata">
        <InfoTable
          rows={[
            ["id", hex4(part.id), "Cmd_LoadTileSet の '.c' で指す ID"],
            ["tiles", `${part.tileCount} 枚`, "VRAM に並べるタイルの数"],
            ["refs", `refs[${part.startIndex / 2}] から ${part.tileCount} 個`, `startIndex ${hex4(part.startIndex)} (refs の先頭からのバイト数)`],
            ["参照するタイル", `tiles[${min}] 〜 tiles[${max}]`],
          ]}
        />
      </Card>
      <Card title="タイルセット">
        <InfoTable
          rows={[
            ["id", hex4(ts.id)],
            ["parts", `${ts.parts.length} 個`],
            ["refCount", ts.refCount, "refs の要素数"],
            ["tiles", `${ts.tiles.length / 32} 枚`],
            ["unk", ts.unk, "意味は分かっていない"],
          ]}
        />
      </Card>
      <UsedByCard
        refs={maps.map((e) => ({ key: String(e.root), kind: "Map", link: <MapLink root={e.root} stage={e.stage} /> }))}
        tip="Cmd_LoadTileSet の '.c' でこの部品を読み込む Map. 置く場所 ('.s', '.m') とパレットは Map タブで見る"
        empty={scripted ? "スクリプトから定数で読み込んでいる所は見つかっていない" : "この ROM のスクリプトは読めないので探していない"}
      />
    </AssetView>
  );
};

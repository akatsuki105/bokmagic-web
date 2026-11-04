// BG のタイルマップ (DIR_TILE_MAP) のタブ
// ファイル単体で分かることだけを表示する. タイルの読み込み元とパレットはファイルからは決まらないので手で選ぶ
// スクリプトが決める組み合わせ (タイルセット部品, パレット, BG, 当たり判定) で見るのは Map タブ

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { type FileEntry } from "./fs.ts";
import { mtmapIndex, parseTilemap, putTiles, renderLayers, renderMetatiles, type Tilemap, tilemapFiles, VRAM_TILES } from "./tilemap.ts";
import { parseTileSets, partTiles, type TileSet } from "./tileset.ts";
import { type BgPlttFile, parseBgPlttFiles } from "./bgpltt.ts";
import { GRAYSCALE_PLTT, renderTileGrid } from "./render.ts";
import { mapEntries } from "./analysis.ts";
import { mapHref } from "./view_map.tsx";
import { TILEMAP_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import { type BgPlttChoice, BgPlttSelect, Desc, hashID, hex4, InfoTable, NumberStepper, SpriteCanvas, useHashID } from "./components.tsx";

export const tilemapHref = (id: number) => `#tilemap/${hex4(id)}`;

export const tilemapLabel = (id: number, withDesc = true) => {
  const name = decomp(TILEMAP_NAMES)[id];
  if (!name) return hex4(id);
  return withDesc && name[1] ? `${hex4(id)} ${name[0]} ${name[1]}` : `${hex4(id)} ${name[0]}`;
};

// タイルの読み込み元
// own: ファイル内のタイル, part: 手で選んだタイルセット部品
type TileSource = { kind: "own" } | { kind: "part"; part: number } | { kind: "none" };

// VRAM のキャラクタブロック1つ分を組み立てる, どちらも loadOffset に置く
const buildVram = (map: Tilemap, src: TileSource, ts: TileSet | undefined): Uint8Array => {
  const vram = new Uint8Array(VRAM_TILES * 32);
  if (ts && src.kind === "part") {
    const part = ts.parts[src.part];
    if (part) putTiles(vram, map.loadOffset, partTiles(ts, part));
  }
  if (src.kind === "own" && map.tiles) putTiles(vram, map.loadOffset, map.tiles);
  return vram;
};

export const TilemapViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const files = useMemo(() => tilemapFiles(rom.fs), [rom]);
  const tilesets = useMemo(() => parseTileSets(rom.data, rom.fs), [rom]);
  const bgFiles = useMemo(() => parseBgPlttFiles(rom.data, rom.fs), [rom]);
  const byID = (id: number | undefined) => files.find((f) => f.id === id);
  const [selected, setSelected] = useState<FileEntry>(byID(hashID("tilemap")) ?? files[0]);
  useHashID("tilemap", (id) => {
    const f = byID(id);
    if (f) setSelected(f);
  });

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {files.map((f) => (
          <li key={f.id} class={f === selected ? "selected" : ""}>
            <a href={tilemapHref(f.id)}>{tilemapLabel(f.id, false)}</a>
          </li>
        ))}
      </ul>
      <TilemapView key={selected.id} rom={rom} entry={selected} ts={tilesets[0]} bgFiles={bgFiles} />
    </div>
  );
};

const TilemapView: FunctionComponent<{ rom: ROMFile; entry: FileEntry; ts: TileSet | undefined; bgFiles: BgPlttFile[] }> = ({ rom, entry, ts, bgFiles }) => {
  const map = useMemo(() => parseTilemap(rom.data, entry), [rom, entry]);
  // このタイルマップを読み込む Map
  const maps = useMemo(() => mapEntries(rom).filter((e) => e.scenes.some((s) => s.tilemaps.some((c) => c.args.d?.[0] === map.id))).map((e) => e.root), [rom, map]);
  // 既定の読み込み元: ファイル内のタイル, 無ければ tileCount が同じ部品
  const sameCount = useMemo(() => ts?.parts.map((p, i) => [p, i] as const).filter(([p]) => p.tileCount === map.tileCount).map(([, i]) => i) ?? [], [ts, map]);
  const [src, setSrc] = useState<TileSource>(map.tiles ? { kind: "own" } : sameCount[0] !== undefined ? { kind: "part", part: sameCount[0] } : { kind: "none" });
  const [pltt, setPltt] = useState<BgPlttChoice>({ file: null, row: 0 });
  const [visible, setVisible] = useState<boolean[]>(() => map.layers.map(() => true));
  // 奥から手前の順: レイヤ番号順 (#0 が一番奥)
  const drawOrder = map.layers.map((_, i) => i).filter((i) => visible[i]);
  const [view, setView] = useState<"layer" | "metatiles" | "tiles">("layer");
  const [scale, setScale] = useState(1);
  const [grid, setGrid] = useState(false);
  const [transparent0, setTransparent0] = useState(true);
  const [tileRow, setTileRow] = useState(0);
  const [hover, setHover] = useState<[number, number]>([-1, -1]);

  const vram = useMemo(() => buildVram(map, src, ts), [map, src, ts]);
  const colors = useMemo(() => bgFiles.find((f) => f.id === pltt.file)?.colors ?? Uint32Array.from({ length: 256 }, (_, i) => GRAYSCALE_PLTT[i & 15]), [bgFiles, pltt]);
  const rendered = useMemo(() => {
    if (view === "metatiles") return renderMetatiles(map, vram, colors, transparent0);
    if (view === "tiles") {
      const nums = Array.from({ length: Math.min(map.tileCount, VRAM_TILES - map.loadOffset) }, (_, k) => map.loadOffset + k);
      return renderTileGrid(vram, nums, 16, colors.subarray(tileRow * 16, tileRow * 16 + 16), transparent0);
    }
    return renderLayers(map, drawOrder.map((i) => map.layers[i]), vram, colors, transparent0);
  }, [map, drawOrder.join(","), vram, colors, transparent0, view, tileRow]);

  return (
    <div class="sprite-view">
      <h2>{tilemapLabel(map.id, false)}</h2>
      <Desc text={decomp(TILEMAP_NAMES)[map.id]?.[1]} />

      <h3>読み込み元</h3>
      <div class="controls">
        <label>
          tiles{" "}
          <select
            value={src.kind === "part" ? `p${src.part}` : src.kind}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setSrc(v === "own" || v === "none" ? { kind: v } : { kind: "part", part: Number(v.slice(1)) });
            }}
          >
            {map.tiles && <option value="own">ファイル内のタイル</option>}
            <option value="none">(なし)</option>
            <optgroup label={`タイルセット部品 (tileCount ${map.tileCount} のもの)`}>
              {sameCount.map((i) => <option key={i} value={`p${i}`}>{`#${i} ${hex4(ts!.parts[i].id)}`}</option>)}
            </optgroup>
            <optgroup label="タイルセット部品 (その他)">
              {ts?.parts.map((p, i) => (sameCount.includes(i) ? null : <option key={i} value={`p${i}`}>{`#${i} ${hex4(p.id)} (${p.tileCount})`}</option>))}
            </optgroup>
          </select>
        </label>
        <BgPlttSelect files={bgFiles} value={pltt} onChange={setPltt} rowSelectable={false} />
      </div>

      <h3>表示</h3>
      <div class="controls">
        {(["layer", "metatiles", "tiles"] as const).map((v) => (
          <label key={v}>
            <input type="radio" name="tilemap-view" checked={view === v} onChange={() => setView(v)} /> {v === "layer" ? "レイヤ" : v === "metatiles" ? "メタタイル一覧" : "GBA タイル一覧"}
          </label>
        ))}
      </div>
      <div class="controls">
        {view === "layer" && (
          <span class="stepper">
            layer {map.layers.map((l, i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  checked={visible[i]}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    setVisible((cur) => cur.map((v, k) => (k === i ? checked : v)));
                  }}
                />
                #{i} {l.width}x{l.height} id {hex4(l.id)}
              </label>
            ))}
          </span>
        )}
        {view === "tiles" && <NumberStepper label="palette" value={tileRow} min={0} max={15} onChange={setTileRow} />}
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
      <p class="mono hover-line">
        <HoverInfo map={map} view={view} layers={[...drawOrder].reverse()} x={hover[0]} y={hover[1]} />
      </p>
      <SpriteCanvas rendered={rendered} scale={scale} grid={grid ? (view === "tiles" ? 8 : 16) : undefined} onHover={(x, y) => setHover([x, y])} />
      <InfoTable
        rows={[
          ["compression", map.compressed ? "LZ77" : "非圧縮"],
          ["size", `${map.size} bytes`],
          ["layers", map.layers.length],
          ["tiles", `${map.tileCount} (${map.tiles ? "ファイル内" : "ファイル外"})`],
          ["metatiles", map.metatileCount],
          ["loadOffset", map.loadOffset],
          [
            "used by Map",
            maps.length === 0 ? <span key="v" class="dim">(スクリプトから見つかっていません)</span> : (
              <span key="v">
                {maps.map((root) => (
                  <a key={root} href={mapHref(root)} class="load-link">
                    {hex4(root)}
                  </a>
                ))}
              </span>
            ),
          ],
        ]}
      />
    </div>
  );
};

// マウスの下にあるものの情報
// layers は表示しているレイヤ番号 (手前から)
const HoverInfo: FunctionComponent<{ map: Tilemap; view: string; layers: number[]; x: number; y: number }> = ({ map, view, layers, x, y }) => {
  if (x < 0) return null;
  const entries = (mt: number) => [0, 1, 2, 3].map((k) => hex4(map.metatiles[mt * 4 + k] ?? 0)).join(" ");
  if (view === "layer") {
    const mx = x >> 4, my = y >> 4;
    const parts = layers.flatMap((i) => {
      const layer = map.layers[i];
      if (mx >= layer.width || my >= layer.height) return [];
      const mt = layer.mtmap[mtmapIndex(layer, mx, my)];
      return [`#${i}: metatile ${mt} (${entries(mt)})`];
    });
    return parts.length > 0 ? <>({mx}, {my}) {parts.join(" / ")}</> : null;
  }
  if (view === "metatiles") {
    const mt = (y >> 4) * 16 + (x >> 4);
    return mt < map.metatileCount ? <>metatile {mt}: {entries(mt)}</> : null;
  }
  const k = (y >> 3) * 16 + (x >> 3);
  return k < map.tileCount ? <>VRAM tile {map.loadOffset + k}</> : null;
};

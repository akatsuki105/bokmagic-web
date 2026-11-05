// BG のタイルマップ (DIR_TILE_MAP) のタブ
// ファイル単体で分かることだけを表示する. タイルの読み込み元とパレットはファイルからは決まらないので手で選ぶ
// スクリプトが決める組み合わせ (タイルセット部品, パレット, BG, 当たり判定) で見るのは Map タブ

import { Fragment, type FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { isSupported, type ROMFile } from "./rom.ts";
import { type FileEntry } from "./fs.ts";
import { mtmapIndex, parseTilemap, putTiles, renderLayers, renderMetatiles, type Tilemap, tilemapFiles, VRAM_TILES } from "./tilemap.ts";
import { parseTileSets, partTiles, type TileSet } from "./tileset.ts";
import { type BgPlttFile, parseBgPlttFiles } from "./bgpltt.ts";
import { GRAYSCALE_PLTT, renderTileGrid } from "./render.ts";
import { collisionLoads, mapEntries } from "./analysis.ts";
import { COLLISION_NAMES, TILEMAP_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import { AssetView, type BgPlttChoice, BgPlttSelect, Card, Check, CursorCard, Field, Fields, hashID, hex4, idLabel, type InfoRow, InfoTable, MapLink, NameRef, NumberStepper, Segmented, Slider, SpriteCanvas, ToggleList, UsedByCard, useHashID, type UseRef } from "./components.tsx";

export const tilemapHref = (id: number) => `#tilemap/${hex4(id)}`;

export const tilemapLabel = (id: number, withDesc = true) => idLabel(id, decomp(TILEMAP_NAMES)[id], withDesc);
export const tilemapName = (id: number) => decomp(TILEMAP_NAMES)[id]?.[0];

// タイルの読み込み元
// own: ファイル内のタイル, part: 手で選んだタイルセット部品 (set はタイルセットの何個目か. U32J は 1 個だけ, U3IJ は 11 個)
type TileSource = { kind: "own" } | { kind: "part"; set: number; part: number } | { kind: "none" };

// VRAM のキャラクタブロック1つ分を組み立てる, どちらも loadOffset に置く
const buildVram = (map: Tilemap, src: TileSource, sets: TileSet[]): Uint8Array => {
  const vram = new Uint8Array(VRAM_TILES * 32);
  if (src.kind === "part") {
    const ts = sets[src.set];
    const part = ts?.parts[src.part];
    if (part) putTiles(vram, map.loadOffset, partTiles(ts, part));
  }
  if (src.kind === "own" && map.tiles) putTiles(vram, map.loadOffset, map.tiles);
  return vram;
};

export const TilemapViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const files = useMemo(() => tilemapFiles(rom.fs), [rom]);
  const tilesets = useMemo(() => parseTileSets(rom.data, rom.fs, rom.id), [rom]);
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
      <TilemapView key={selected.id} rom={rom} entry={selected} sets={tilesets} bgFiles={bgFiles} />
    </div>
  );
};

// 部品の選択肢: 全タイルセットの部品を [タイルセットの何個目, 部品の何個目] で並べる
type PartRef = { set: number; part: number };
const partValue = (r: PartRef) => `p${r.set}.${r.part}`;

const TilemapView: FunctionComponent<{ rom: ROMFile; entry: FileEntry; sets: TileSet[]; bgFiles: BgPlttFile[] }> = ({ rom, entry, sets, bgFiles }) => {
  const map = useMemo(() => parseTilemap(rom.data, entry), [rom, entry]);
  // このタイルマップを読み込む Map (スクリプトが読めない作品では探さない)
  const scripted = isSupported(rom, "script");
  // Used by: このタイルマップを読み込む Map と、'.n' でこのタイルマップを対にしている Collision Map
  const usedBy = useMemo((): UseRef[] => {
    if (!scripted) return [];
    const maps = mapEntries(rom).filter((e) => e.scenes.some((s) => s.tilemaps.some((c) => c.args.d?.[0] === map.id)));
    const cols = [...collisionLoads(rom)].filter(([, calls]) => calls.some((c) => c.args.n?.[0] === map.id)).map(([id]) => id);
    return [
      ...maps.map((e): UseRef => ({ key: `m${e.root}`, kind: "Map", link: <MapLink root={e.root} stage={e.stage} /> })),
      ...cols.map((id): UseRef => ({ key: `c${id}`, kind: "Collision", link: <NameRef id={id} name={decomp(COLLISION_NAMES)[id]?.[0]} href={`#collision/${hex4(id)}`} />, detail: "対の当たり判定 ('.n' からの推測)" })),
    ];
  }, [rom, map]);
  const allParts = useMemo(() => sets.flatMap((ts, set) => ts.parts.map((_, part) => ({ set, part }))), [sets]);
  const partOf = (r: PartRef) => sets[r.set].parts[r.part];
  const partLabel = (r: PartRef) => (sets.length > 1 ? `${hex4(sets[r.set].id)} / ` : "") + hex4(partOf(r).id);
  // 既定の読み込み元: ファイル内のタイル, 無ければ tileCount が同じ部品
  const sameCount = useMemo(() => allParts.filter((r) => partOf(r).tileCount === map.tileCount), [allParts, map]);
  const [src, setSrc] = useState<TileSource>(map.tiles ? { kind: "own" } : sameCount[0] ? { kind: "part", ...sameCount[0] } : { kind: "none" });
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

  const vram = useMemo(() => buildVram(map, src, sets), [map, src, sets]);
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
    <AssetView title={tilemapLabel(map.id, false)} desc={decomp(TILEMAP_NAMES)[map.id]?.[1]} stage={<SpriteCanvas rendered={rendered} scale={scale} grid={grid ? (view === "tiles" ? 8 : 16) : undefined} onHover={(x, y) => setHover([x, y])} />}>
      <Card title="読み込み元">
        <Fields>
          <Field label="タイル" title={map.tiles ? "ファイル内のタイル" : "タイルはファイルに無いので、tileCount が同じ部品を既定で当てている (ゲームでの組み合わせはスクリプトが決める)"}>
            <select
              class="wide"
              value={src.kind === "part" ? partValue(src) : src.kind}
              onChange={(e) => {
                const v = e.currentTarget.value;
                const [set, part] = v.slice(1).split(".").map(Number);
                setSrc(v === "own" || v === "none" ? { kind: v } : { kind: "part", set, part });
              }}
            >
              {map.tiles && <option value="own">ファイル内のタイル</option>}
              <option value="none">(なし)</option>
              <optgroup label={`タイルセット部品 (tileCount ${map.tileCount} のもの)`}>
                {sameCount.map((r) => <option key={partValue(r)} value={partValue(r)}>{partLabel(r)}</option>)}
              </optgroup>
              <optgroup label="タイルセット部品 (その他)">
                {allParts.map((r) => (sameCount.includes(r) ? null : <option key={partValue(r)} value={partValue(r)}>{`${partLabel(r)} (${partOf(r).tileCount})`}</option>))}
              </optgroup>
            </select>
          </Field>
          <BgPlttSelect files={bgFiles} value={pltt} onChange={setPltt} rowSelectable={false} />
        </Fields>
      </Card>
      {view === "layer" && (
        <Card title="レイヤ" tip="描く順に並べる (上が手前). 番号はファイル内のレイヤの番号で、Tilemap タブでは大きいほど手前に描く (Map ではどの BG に載るかで決まる). 大きさはメタタイル (16px) 単位">
          <ToggleList
            items={map.layers.map((l, i) => ({
              key: i,
              label: `レイヤ ${i}`,
              detail: `${l.width}x${l.height} メタタイル (${l.width * 16}x${l.height * 16} px), id ${hex4(l.id)}`,
              checked: visible[i],
              onChange: (on: boolean) => setVisible((cur) => cur.map((v, k) => (k === i ? on : v))),
            })).reverse()}
          />
        </Card>
      )}
      <Card title="表示">
        <Fields>
          <Field label="表示">
            <Segmented options={[["layer", "レイヤ"], ["metatiles", "メタタイル"], ["tiles", "GBA タイル"]] as const} value={view} onChange={setView} />
          </Field>
          {view === "tiles" && (
            <Field label="行">
              <NumberStepper value={tileRow} min={0} max={15} onChange={setTileRow} />
            </Field>
          )}
          <Field label="拡大">
            <Slider value={scale} min={1} max={8} onChange={setScale} format={(v) => `${v}x`} />
          </Field>
          <Field label="Overlay">
            <Check checked={grid} onChange={setGrid}>{view === "tiles" ? "8x8" : "16x16"} Grid</Check>
          </Field>
          <Field label="色0">
            <Check checked={transparent0} onChange={setTransparent0}>透明にする</Check>
          </Field>
        </Fields>
      </Card>
      <CursorCard rows={hoverRows(map, view, [...drawOrder].reverse(), hover[0], hover[1])} minRows={view === "layer" ? 1 + map.layers.length * 2.5 : 3} />
      <Card title="Metadata">
        <InfoTable
          rows={[
            ["metatiles", `${map.metatileCount} 個`, "メタタイル = 16x16 px. GBA タイル 4 枚 (左上・右上・左下・右下)"],
            ["tiles", `${map.tileCount} 枚, ${map.tiles ? "ファイル内" : "ファイル外 (タイルセットの部品)"}`, "GBA タイル (8x8 px)"],
            ["loadOffset", `${map.loadOffset} タイル目 (VRAM の +${hex4(map.loadOffset * 32)} バイト)`, "ファイル内のタイルを置く VRAM の位置. キャラクタブロックの先頭から"],
            ["compression", map.compressed ? "LZ77" : "なし"],
            ["size", `${map.size} バイト`, "展開後のデータの終わりの位置 (表示用に計算した値. ファイルの大きさではない)"],
          ]}
        />
      </Card>
      <UsedByCard refs={usedBy} tip="このタイルマップを読み込む場面を持つ Map (Cmd_LoadTileMap の '.d') と、Map_LoadMapScripted の '.n' でこのタイルマップを対にしている Collision Map" empty={scripted ? "スクリプトから定数で読み込んでいる所は見つかっていない" : "この ROM のスクリプトは読めないので探していない"} />
    </AssetView>
  );
};

// マウスの下にあるもの (カーソルの欄に出す行). layers は表示しているレイヤ番号 (手前から)
const hoverRows = (map: Tilemap, view: string, layers: number[], x: number, y: number): InfoRow[] | null => {
  if (x < 0) return null;
  const entries = (mt: number) => <MetatileEntries entries={[0, 1, 2, 3].map((k) => map.metatiles[mt * 4 + k] ?? 0)} />;
  if (view === "layer") {
    const mx = x >> 4, my = y >> 4;
    const rows: InfoRow[] = [["位置", `metatile (${mx}, ${my})`, "メタタイル単位 (1 = 16 px)"]];
    for (const i of layers) {
      const layer = map.layers[i];
      if (mx >= layer.width || my >= layer.height) continue;
      const mt = layer.mtmap[mtmapIndex(layer, mx, my)];
      rows.push([`レイヤ ${i}`, <Fragment key="v">metatile {mt}{entries(mt)}</Fragment>]);
    }
    return rows;
  }
  if (view === "metatiles") {
    const mt = (y >> 4) * 16 + (x >> 4);
    return mt < map.metatileCount ? [["metatile", <Fragment key="v">{mt}{entries(mt)}</Fragment>]] : null;
  }
  const k = (y >> 3) * 16 + (x >> 3);
  return k < map.tileCount ? [["VRAM tile", `${map.loadOffset + k}`, "loadOffset + ファイル内の番号"], ["ファイル内", `${k} 枚目`]] : null;
};

// メタタイルの 4 エントリ (BgMapEntry) を左上・右上・左下・右下の 2x2 で出す. タイル番号, 反転, パレット行に分ける
const MetatileEntries: FunctionComponent<{ entries: number[] }> = ({ entries }) => (
  <div class="mt-entries">
    {entries.map((e, k) => (
      <span key={k} class="mt-entry" title={`${["左上", "右上", "左下", "右下"][k]}: ${hex4(e)} (bit0-9 タイル番号, bit10 左右反転, bit11 上下反転, bit12-15 パレット行)`}>
        tile {e & 0x3FF}
        <span class="mt-sub">
          p{e >> 12}
          {e & 0x400 ? " ↔" : ""}
          {e & 0x800 ? " ↕" : ""}
        </span>
      </span>
    ))}
  </div>
);

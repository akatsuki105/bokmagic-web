// BG のタイルマップ (DIR_TILE_MAP) のタブ
// タイルの読み込み元とパレットは ROM のファイル単体からは決まらないので、スクリプトの解析結果 (analysis.ts の mapLoads) を候補にして選べるようにする

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { type FileEntry } from "./fs.ts";
import { bgDepth, DEFAULT_BG_PRIO, layerBGs, mtmapIndex, parseTilemap, putTiles, renderLayers, renderMetatiles, type Tilemap, tilemapFiles, VRAM_TILES } from "./tilemap.ts";
import { parseTileSets, partTiles, type TileSet } from "./tileset.ts";
import { type BgPlttFile, parseBgPlttFiles } from "./bgpltt.ts";
import { GRAYSCALE_PLTT, renderTileGrid } from "./render.ts";
import { collisionLoads, type MapLoads, mapLoadsByTilemap } from "./analysis.ts";
import { collisionFiles, parseCollisionMap, projectToTilemap } from "./collision.ts";
import { CollisionOverlay, IsoGrid, type OverlayMode } from "./collision_overlay.tsx";
import type { LoadCall } from "./script_scan.ts";
import { scriptHref } from "./view_script.tsx";
import { collisionHref } from "./view_collision.tsx";
import { TILEMAP_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import { bgpLabel, type BgPlttChoice, BgPlttSelect, hashID, hex4, NumberStepper, SpriteCanvas, useHashID } from "./components.tsx";

export const tilemapHref = (id: number) => `#tilemap/${hex4(id)}`;

const tilemapLabel = (id: number, withDesc = true) => {
  const name = decomp(TILEMAP_NAMES)[id];
  if (!name) return hex4(id);
  return withDesc && name[1] ? `${hex4(id)} ${name[0]} ${name[1]}` : `${hex4(id)} ${name[0]}`;
};

// タイルの読み込み元
// own: ファイル内のタイル, script: スクリプトが読み込むタイルセット部品, part: 手で選んだタイルセット部品
type TileSource = { kind: "own" } | { kind: "script"; loads: MapLoads } | { kind: "part"; part: number } | { kind: "none" };

// このタイルマップを読み込む呼び出しの BG 構成 ('.t'), 0 なら BG0 でキャラクタブロックが他と別になる
const layoutOf = (loads: MapLoads, id: number) => loads.tilemaps.find((c) => c.args.d?.[0] === id)?.args.t?.[0] ?? 1;

// VRAM のキャラクタブロック1つ分を組み立てる (Video_LoadTileSetParts / Cmd_LoadTileMap と同じ位置に置く)
const buildVram = (rom: ROMFile, map: Tilemap, src: TileSource, ts: TileSet | undefined): Uint8Array => {
  const vram = new Uint8Array(VRAM_TILES * 32);
  if (ts && src.kind === "script") {
    const bg0 = layoutOf(src.loads, map.id) === 0;
    for (const c of src.loads.tilesets) {
      if ((c.args.t?.[0] === 0) !== bg0) continue; // BG0 とそれ以外でキャラクタブロックが違う
      let offset = c.args.s?.[0] ?? 0;
      const m = c.args.m?.[0];
      if (m !== undefined && m !== null) {
        const entry = tilemapFiles(rom.fs).find((f) => f.id === m);
        offset = m === map.id ? map.loadOffset : entry ? parseTilemap(rom.data, entry).loadOffset : offset;
      }
      for (const pid of c.args.c ?? []) {
        const part = ts.parts.find((p) => p.id === pid);
        if (!part || offset === null) continue;
        putTiles(vram, offset, partTiles(ts, part));
        offset += part.tileCount;
      }
    }
  }
  if (ts && src.kind === "part") {
    const part = ts.parts[src.part];
    if (part) putTiles(vram, map.loadOffset, partTiles(ts, part));
  }
  if (map.tiles) putTiles(vram, map.loadOffset, map.tiles); // Cmd_LoadTileMap がファイル内のタイルを loadOffset に流す
  return vram;
};

export const TilemapViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const files = useMemo(() => tilemapFiles(rom.fs), [rom]);
  const tilesets = useMemo(() => parseTileSets(rom.data, rom.fs), [rom]);
  const bgFiles = useMemo(() => parseBgPlttFiles(rom.data, rom.fs), [rom]);
  const loadsByTilemap = mapLoadsByTilemap(rom);
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
          <li key={f.id} class={f === selected ? "selected" : ""} title={loadsByTilemap.has(f.id) ? "スクリプトから読み込み元が分かる" : ""}>
            <a href={tilemapHref(f.id)} class={loadsByTilemap.has(f.id) ? "" : "dim"}>{tilemapLabel(f.id, false)}</a>
          </li>
        ))}
      </ul>
      <TilemapView key={selected.id} rom={rom} entry={selected} ts={tilesets[0]} bgFiles={bgFiles} loads={loadsByTilemap.get(selected.id) ?? []} />
    </div>
  );
};

const firstPltt = (loads: MapLoads | undefined, bgFiles: BgPlttFile[]): number | null => {
  const p = loads?.pltts.flatMap((c) => c.args.p ?? []).find((id) => id !== null && bgFiles.some((f) => f.id === id));
  return p ?? null;
};

const TilemapView: FunctionComponent<{ rom: ROMFile; entry: FileEntry; ts: TileSet | undefined; bgFiles: BgPlttFile[]; loads: MapLoads[] }> = ({ rom, entry, ts, bgFiles, loads }) => {
  const map = useMemo(() => parseTilemap(rom.data, entry), [rom, entry]);
  // 既定の読み込み元: スクリプトの解析結果, 無ければファイル内のタイル, それも無ければ tileCount が同じ部品
  const sameCount = useMemo(() => ts?.parts.map((p, i) => [p, i] as const).filter(([p]) => p.tileCount === map.tileCount).map(([, i]) => i) ?? [], [ts, map]);
  const [src, setSrc] = useState<TileSource>(loads[0] ? { kind: "script", loads: loads[0] } : map.tiles ? { kind: "own" } : sameCount[0] !== undefined ? { kind: "part", part: sameCount[0] } : { kind: "none" });
  const [pltt, setPltt] = useState<BgPlttChoice>({ file: firstPltt(loads[0], bgFiles), row: 0 });
  // レイヤ番号 -> BG 番号: このタイルマップを読み込むスクリプトの '.t' / '.n' / '.i' から (Video_SetupBGLayout)
  const bgOf = useMemo(() => {
    const call = (src.kind === "script" ? [src.loads, ...loads] : loads).flatMap((l) => l.tilemaps).find((c) => c.args.d?.[0] === map.id);
    const t = call?.args.t?.[0], n = call?.args.n?.[0];
    return t === null || t === undefined ? new Map<number, number>() : layerBGs(t, n ?? 1, call?.args.i);
  }, [src, loads, map]);
  // 表示するレイヤ, 既定はスクリプトが BG に載せるもの (分からなければ全部)
  const [visible, setVisible] = useState<boolean[]>(() => map.layers.map((_, i) => bgOf.size === 0 || bgOf.has(i)));
  // 奥から手前の順: BG が分かるものは BG の優先度順、分からないものはその手前にレイヤ番号順
  // BG の優先度: スクリプトの Cmd_CreateBG ('.i' BG, '.p' 優先度) で、このタイルマップを載せるもの, 無ければ既定値
  const bgPrio = useMemo(() => {
    const prio = new Map(Object.entries(DEFAULT_BG_PRIO).map(([bg, p]) => [Number(bg), p]));
    const group = src.kind === "script" ? src.loads : loads[0];
    for (const c of group?.bgs ?? []) {
      const bg = c.args.i?.[0], p = c.args.p?.[0], d = c.args.d?.[0];
      if (bg === null || bg === undefined || p === null || p === undefined || (d !== null && d !== undefined && d !== map.id)) continue;
      prio.set(bg, p);
    }
    return prio;
  }, [src, loads, map]);
  // 奥から手前の順: BG が分かるものは優先度順 (同じなら番号の大きい BG が奥)、分からないものはその手前にレイヤ番号順
  const depth = (i: number) => {
    const bg = bgOf.get(i);
    return bg === undefined ? -1 : bgDepth(bg, bgPrio.get(bg) ?? 0);
  };
  const drawOrder = map.layers.map((_, i) => i).filter((i) => visible[i]).sort((a, b) => {
    const da = depth(a), db = depth(b);
    if (da < 0 || db < 0) return (da < 0 ? 1 : 0) - (db < 0 ? 1 : 0) || a - b;
    return db - da;
  });
  const [view, setView] = useState<"layer" | "metatiles" | "tiles">("layer");
  const [scale, setScale] = useState(1);
  const [grid, setGrid] = useState<"none" | "square" | "iso">("none");
  const [transparent0, setTransparent0] = useState(true);
  const [tileRow, setTileRow] = useState(0);
  const [hover, setHover] = useState<[number, number]>([-1, -1]);

  // 重ねる当たり判定マップ: スクリプトで 0x30AD の .n がこのタイルマップになっているものを候補にする
  const colFiles = useMemo(() => collisionFiles(rom.fs), [rom]);
  const colRefs = useMemo(() => [...collisionLoads(rom)].filter(([, calls]) => calls.some((c) => c.args.n?.[0] === map.id)).map(([id]) => id), [rom, map]);
  const [colID, setColID] = useState<number | null>(colRefs[0] ?? null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("attr");
  const [opacity, setOpacity] = useState(0.4);
  const colMap = useMemo(() => {
    const f = colFiles.find((f) => f.id === colID);
    return f ? parseCollisionMap(rom.data, f) : null;
  }, [rom, colFiles, colID]);
  // アイソメトリックのグリッドを合わせる当たり判定マップ: 重ねているもの, 重ねていなければスクリプトで対になっているもの
  const isoMap = useMemo(() => {
    if (colMap) return colMap;
    const f = colFiles.find((f) => f.id === colRefs[0]);
    return f ? parseCollisionMap(rom.data, f) : null;
  }, [rom, colFiles, colRefs, colMap]);
  // グリッドを引く高さ, 既定はそのマップで一番多い高さ
  const [isoHeight, setIsoHeight] = useState<number | null>(null);
  const isoLevel = useMemo(() => {
    if (isoHeight !== null || !isoMap) return isoHeight ?? 0;
    const counts = new Array(16).fill(0);
    for (const t of isoMap.tiles) counts[t.height]++;
    return counts.indexOf(Math.max(...counts));
  }, [isoMap, isoHeight]);
  const isoOrigin = useMemo((): [number, number] => (isoMap ? projectToTilemap(isoMap, 0, 0, isoLevel << 8) : [0, 0]), [isoMap, isoLevel]);

  const vram = useMemo(() => buildVram(rom, map, src, ts), [rom, map, src, ts]);
  const colors = useMemo(() => bgFiles.find((f) => f.id === pltt.file)?.colors ?? Uint32Array.from({ length: 256 }, (_, i) => GRAYSCALE_PLTT[i & 15]), [bgFiles, pltt]);
  const drawn = drawOrder.map((i) => map.layers[i]);
  const layerW = Math.max(16, ...drawn.map((l) => l.width * 16)), layerH = Math.max(16, ...drawn.map((l) => l.height * 16));
  const rendered = useMemo(() => {
    if (view === "metatiles") return renderMetatiles(map, vram, colors, transparent0);
    if (view === "tiles") {
      const nums = Array.from({ length: Math.min(map.tileCount, VRAM_TILES - map.loadOffset) }, (_, k) => map.loadOffset + k);
      return renderTileGrid(vram, nums, 16, colors.subarray(tileRow * 16, tileRow * 16 + 16), transparent0);
    }
    return renderLayers(map, drawn, vram, colors, transparent0);
  }, [map, drawOrder.join(","), vram, colors, transparent0, view, tileRow]);

  const changeSrc = (s: TileSource) => {
    setSrc(s);
    if (s.kind === "script") setPltt({ file: firstPltt(s.loads, bgFiles) ?? pltt.file, row: 0 });
  };

  return (
    <div class="sprite-view">
      <h2>{tilemapLabel(map.id)}</h2>
      <p>
        {map.compressed ? "LZ77" : "非圧縮"}, {map.size} bytes, layers: {map.layers.length}, tiles: {map.tileCount} ({map.tiles ? "ファイル内" : "ファイル外"}), metatiles: {map.metatileCount}, loadOffset: {map.loadOffset}
      </p>

      <h3>読み込み元</h3>
      <div class="controls">
        <label>
          tiles{" "}
          <select
            value={src.kind === "script" ? `s${loads.indexOf(src.loads)}` : src.kind === "part" ? `p${src.part}` : src.kind}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (v === "own" || v === "none") changeSrc({ kind: v });
              else if (v[0] === "s") changeSrc({ kind: "script", loads: loads[Number(v.slice(1))] });
              else changeSrc({ kind: "part", part: Number(v.slice(1)) });
            }}
          >
            {loads.length > 0 && (
              <optgroup label="スクリプトの読み込み">
                {loads.map((l, i) => <option key={i} value={`s${i}`}>{`Script ${hex4(l.root)} から`}</option>)}
              </optgroup>
            )}
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
      {src.kind === "script" && <ScriptLoads loads={src.loads} onPltt={(file) => setPltt({ file, row: 0 })} bgFiles={bgFiles} />}

      <h3>表示</h3>
      <div class="controls">
        {(["layer", "metatiles", "tiles"] as const).map((v) => (
          <label key={v}>
            <input
              type="radio"
              name="tilemap-view"
              checked={view === v}
              onChange={() => {
                setView(v);
                if (v !== "layer" && grid === "iso") setGrid("none"); // アイソメトリックはレイヤ表示だけ
              }}
            />{" "}
            {v === "layer" ? "レイヤ" : v === "metatiles" ? "メタタイル一覧" : "GBA タイル一覧"}
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
                {bgOf.has(i) ? ` (BG${bgOf.get(i)}, 優先度 ${bgPrio.get(bgOf.get(i)!)})` : ""}
              </label>
            ))}
          </span>
        )}
        {view === "tiles" && <NumberStepper label="palette" value={tileRow} min={0} max={15} onChange={setTileRow} />}
        <label>
          scale <input type="number" min={1} max={8} value={scale} onInput={(e) => setScale(Number(e.currentTarget.value))} />
        </label>
        <label>
          grid{" "}
          <select value={grid} onChange={(e) => setGrid(e.currentTarget.value as "none" | "square" | "iso")}>
            <option value="none">なし</option>
            <option value="square">正方形</option>
            {view === "layer" && <option value="iso">アイソメトリック</option>}
          </select>
        </label>
        {view === "layer" && grid === "iso" && <NumberStepper label="高さ" value={isoLevel} min={0} max={15} onChange={setIsoHeight} />}
        {view === "layer" && grid === "iso" && !isoMap && <span class="dim">当たり判定マップが無いので位置は合いません</span>}
        <label>
          <input type="checkbox" checked={transparent0} onChange={(e) => setTransparent0(e.currentTarget.checked)} /> 色0 を透明にする
        </label>
      </div>
      {view === "layer" && (
        <div class="controls">
          <label>
            当たり判定{" "}
            <select value={colID ?? ""} onChange={(e) => setColID(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}>
              <option value="">(重ねない)</option>
              {colRefs.length > 0 && (
                <optgroup label="スクリプトで対になっているもの">
                  {colRefs.map((id) => <option key={id} value={id}>{hex4(id)}</option>)}
                </optgroup>
              )}
              <optgroup label="その他">
                {colFiles.filter((f) => !colRefs.includes(f.id)).map((f) => <option key={f.id} value={f.id}>{hex4(f.id)}</option>)}
              </optgroup>
            </select>
          </label>
          {colMap && (
            <>
              {(["attr", "height", "outline"] as const).map((m) => (
                <label key={m}>
                  <input type="radio" name="overlay-mode" checked={overlayMode === m} onChange={() => setOverlayMode(m)} /> {m === "attr" ? "属性" : m === "height" ? "高さ" : "枠だけ"}
                </label>
              ))}
              <label>
                不透明度 <input type="range" min={0} max={1} step={0.05} value={opacity} onInput={(e) => setOpacity(Number(e.currentTarget.value))} />
              </label>
              <a href={collisionHref(colMap.id)}>Collision タブで開く</a>
            </>
          )}
        </div>
      )}
      <p class="mono">
        <HoverInfo map={map} view={view} layers={[...drawOrder].reverse()} x={hover[0]} y={hover[1]} />
      </p>
      <div class="overlay-host">
        <SpriteCanvas rendered={rendered} scale={scale} grid={grid === "square" ? (view === "tiles" ? 8 : 16) : undefined} onHover={(x, y) => setHover([x, y])} />
        {view === "layer" && colMap && <CollisionOverlay map={colMap} width={layerW} height={layerH} scale={scale} mode={overlayMode} opacity={opacity} />}
        {view === "layer" && grid === "iso" && <IsoGrid width={layerW} height={layerH} scale={scale} origin={isoOrigin} />}
      </div>
    </div>
  );
};

// マウスの下にあるものの情報
// layers は表示しているレイヤ番号 (手前から)
const HoverInfo: FunctionComponent<{ map: Tilemap; view: string; layers: number[]; x: number; y: number }> = ({ map, view, layers, x, y }) => {
  if (x < 0) return <span>マウスを乗せるとメタタイルやタイルの番号を表示します</span>;
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

const argText = (c: LoadCall) => Object.entries(c.args).map(([k, v]) => `.${k} = ${v.length === 1 ? valueText(v[0]) : `[${v.map(valueText).join(", ")}]`}`).join(", ");
const valueText = (v: number | null) => (v === null ? "?" : hex4(v));

// スクリプトから拾った読み込みの一覧, パレットはクリックで選べる
const ScriptLoads: FunctionComponent<{ loads: MapLoads; bgFiles: BgPlttFile[]; onPltt: (id: number) => void }> = ({ loads, bgFiles, onPltt }) => {
  const rows: [string, LoadCall][] = [
    ...loads.tilemaps.map((c) => ["tilemap", c] as [string, LoadCall]),
    ...loads.tilesets.map((c) => ["tileset", c] as [string, LoadCall]),
    ...loads.pltts.map((c) => ["palette", c] as [string, LoadCall]),
    ...loads.collisions.map((c) => ["collision", c] as [string, LoadCall]),
  ];
  return (
    <div class="script-loads">
      <p>
        起点: <a href={scriptHref(loads.root)}>Script {hex4(loads.root)}</a> ("?" は値がスクリプトから決まらなかったもの)
      </p>
      <table class="pltt-table">
        <tbody>
          {rows.map(([kind, c], i) => (
            <tr key={i}>
              <td>{kind}</td>
              <td>
                <a href={scriptHref(c.script)}>{hex4(c.script)}</a>
              </td>
              <td>
                {argText(c)}
                {c.conditional && " (if/switch の中)"}
              </td>
              <td>
                {kind === "palette" && (c.args.p ?? []).map((p, k) =>
                  p !== null && bgFiles.some((f) => f.id === p)
                    ? (
                      <button type="button" key={k} onClick={() => onPltt(p)}>
                        {bgpLabel(p, false)}
                      </button>
                    )
                    : null
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

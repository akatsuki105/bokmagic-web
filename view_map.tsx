// Map タブ: マップを読み込むスクリプトごとに、そのスクリプトが読み込むタイルマップ・タイルセット・BG パレット・当たり判定を組み合わせて表示する
// 一覧と場面の分け方は analysis.ts の mapEntries, BG への載せ方は map.ts の buildScene

import type { ComponentChildren, FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { callBGs, mapEntries, type MapEntry, type MapScene } from "./analysis.ts";
import { type BgSlot, buildScene, slotSource } from "./map.ts";
import { mtmapIndex, renderComposite } from "./tilemap.ts";
import { parseTileSets, type TileSet } from "./tileset.ts";
import { type BgPlttFile, parseBgPlttFiles } from "./bgpltt.ts";
import { GRAYSCALE_PLTT } from "./render.ts";
import { collisionFiles, type CollisionMap, parseCollisionMap, projectToTilemap, tileAtTilemap } from "./collision.ts";
import { CollisionOverlay, IsoGrid, type OverlayMode, type WorldLayers, WorldOverlay } from "./collision_overlay.tsx";
import type { LoadCall } from "./script_scan.ts";
import { scriptHref } from "./view_script.tsx";
import { collisionHref, collisionTileText } from "./view_collision.tsx";
import { tilemapHref, tilemapLabel } from "./view_tilemap.tsx";
import { bgplttHref } from "./view_bgpltt.tsx";
import { bgpLabel, type BgPlttChoice, BgPlttSelect, hashID, hex4, NumberStepper, SpriteCanvas, useHashID } from "./components.tsx";

export const mapHref = (root: number) => `#map/${hex4(root)}`;

const tilemapID = (c: LoadCall) => c.args.d?.[0] ?? null;

// 場面の見出し: 読み込むタイルマップと載せる BG
const sceneLabel = (s: MapScene) => s.tilemaps.map((c) => `${hex4(tilemapID(c) ?? 0)} (BG${callBGs(c).join(",")})`).join(" + ");

// 場面の見出しの一覧, タイルマップが同じ場面は当たり判定と番号を付けて見分ける
const sceneLabels = (scenes: MapScene[]) =>
  scenes.map((s, i) => {
    const label = sceneLabel(s);
    if (scenes.filter((o) => sceneLabel(o) === label).length === 1) return label;
    const cols = s.collisions.map((c) => valueText(c.args.p?.[0] ?? null)).join(",");
    return `${label}${cols ? `, Collision Map ${cols}` : ""} [${i}]`;
  });

export const MapViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const entries = mapEntries(rom);
  const tilesets = useMemo(() => parseTileSets(rom.data, rom.fs), [rom]);
  const bgFiles = useMemo(() => parseBgPlttFiles(rom.data, rom.fs), [rom]);
  const byRoot = (id: number | undefined) => entries.find((e) => e.root === id);
  const [selected, setSelected] = useState<MapEntry | undefined>(byRoot(hashID("map")) ?? entries[0]);
  useHashID("map", (id) => {
    const e = byRoot(id);
    if (e) setSelected(e);
  });

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {entries.map((e) => (
          <li key={e.root} class={e === selected ? "selected" : ""} title={e.scenes.map(sceneLabel).join("\n")}>
            <a href={mapHref(e.root)}>{hex4(e.root)}</a>
          </li>
        ))}
      </ul>
      {selected ? <MapView key={selected.root} rom={rom} entry={selected} ts={tilesets[0]} bgFiles={bgFiles} /> : <p>マップを読み込むスクリプトが見つかりません</p>}
    </div>
  );
};

const MapView: FunctionComponent<{ rom: ROMFile; entry: MapEntry; ts: TileSet | undefined; bgFiles: BgPlttFile[] }> = ({ rom, entry, ts, bgFiles }) => {
  const [sceneIdx, setSceneIdx] = useState(0);
  const scene = entry.scenes[sceneIdx];
  // 既定のパレット: スクリプトが指定する最初のもの
  const plttIDs = useMemo(() => [...new Set(entry.pltts.flatMap((c) => c.args.p ?? []).filter((p): p is number => p !== null && bgFiles.some((f) => f.id === p)))], [entry, bgFiles]);
  const [pltt, setPltt] = useState<BgPlttChoice>({ file: plttIDs[0] ?? null, row: 0 });

  return (
    <div class="sprite-view">
      <h2>
        Map {hex4(entry.root)} <a href={scriptHref(entry.root)} class="script-loads">Script タブで開く</a>
      </h2>
      {entry.scenes.length > 1 && (
        <div class="controls">
          場面 (if/switch で読み込むものが変わる, または同じ BG に読み直している):
          {sceneLabels(entry.scenes).map((label, i) => (
            <label key={i}>
              <input type="radio" name="map-scene" checked={i === sceneIdx} onChange={() => setSceneIdx(i)} /> {label}
            </label>
          ))}
        </div>
      )}
      <div class="controls">
        <BgPlttSelect files={bgFiles} value={pltt} onChange={setPltt} rowSelectable={false} />
        {plttIDs.length > 0 && <span>スクリプトの指定:</span>}
        {plttIDs.map((id) => (
          <button type="button" key={id} class={id === pltt.file ? "selected" : ""} onClick={() => setPltt({ file: id, row: 0 })}>
            {bgpLabel(id, false)}
          </button>
        ))}
      </div>
      <SceneView key={sceneIdx} rom={rom} entry={entry} scene={scene} ts={ts} bgFiles={bgFiles} pltt={pltt} />
    </div>
  );
};

const SceneView: FunctionComponent<{ rom: ROMFile; entry: MapEntry; scene: MapScene; ts: TileSet | undefined; bgFiles: BgPlttFile[]; pltt: BgPlttChoice }> = ({ rom, entry, scene, ts, bgFiles, pltt }) => {
  const state = useMemo(() => buildScene(rom, scene, ts), [rom, scene, ts]);
  const [hidden, setHidden] = useState<number[]>([]); // 隠している BG
  const [scale, setScale] = useState(1);
  const [transparent0, setTransparent0] = useState(true);
  const [grid, setGrid] = useState<"none" | "square" | "iso">("none");

  // 当たり判定: 場面で読み込むもの
  const colFiles = useMemo(() => collisionFiles(rom.fs), [rom]);
  const colIDs = [...new Set(scene.collisions.map((c) => c.args.p?.[0]).filter((p): p is number => p !== null && p !== undefined && colFiles.some((f) => f.id === p)))];
  const [colID, setColID] = useState<number | null>(colIDs[0] ?? null);
  const [showCol, setShowCol] = useState(true);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("attr");
  const [opacity, setOpacity] = useState(0.4);
  const [world, setWorld] = useState<WorldLayers>({ zones: false, paths: false, navMesh: false });
  const colMap = useMemo((): CollisionMap | null => {
    const f = colFiles.find((f) => f.id === colID);
    return f ? parseCollisionMap(rom.data, f) : null;
  }, [rom, colFiles, colID]);
  // グリッドを引く高さ, 既定はそのマップで一番多い高さ
  const [isoHeight, setIsoHeight] = useState<number | null>(null);
  const isoLevel = useMemo(() => {
    if (isoHeight !== null || !colMap) return isoHeight ?? 0;
    const counts = new Array(16).fill(0);
    for (const t of colMap.tiles) counts[t.height]++;
    return counts.indexOf(Math.max(...counts));
  }, [colMap, isoHeight]);
  const isoOrigin = useMemo((): [number, number] => (colMap ? projectToTilemap(colMap, 0, 0, isoLevel << 8) : [0, 0]), [colMap, isoLevel]);

  const [hover, setHover] = useState<[number, number]>([-1, -1]);
  const colors = useMemo(() => bgFiles.find((f) => f.id === pltt.file)?.colors ?? Uint32Array.from({ length: 256 }, (_, i) => GRAYSCALE_PLTT[i & 15]), [bgFiles, pltt]);
  const shown = state.slots.filter((s) => !hidden.includes(s.bg));
  const rendered = useMemo(() => renderComposite(shown.map((s) => slotSource(s, state.vram)), colors, transparent0), [state, hidden.join(","), colors, transparent0]);
  const width = rendered.image.width, height = rendered.image.height;

  return (
    <>
      <h3>BG</h3>
      <div class="controls">
        {[...state.slots].reverse().map((s) => (
          <label key={s.bg}>
            <input
              type="checkbox"
              checked={!hidden.includes(s.bg)}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setHidden((cur) => (checked ? cur.filter((b) => b !== s.bg) : [...cur, s.bg]));
              }}
            />
            BG{s.bg} (優先度 {s.prio}): <a href={tilemapHref(s.map.id)}>{hex4(s.map.id)}</a> layer #{s.layer} {s.map.layers[s.layer].width}x{s.map.layers[s.layer].height}
          </label>
        ))}
        {state.slots.length === 0 && <span class="dim">BG に載るタイルマップがありません</span>}
      </div>
      <div class="controls">
        <label>
          scale <input type="number" min={1} max={8} value={scale} onInput={(e) => setScale(Number(e.currentTarget.value))} />
        </label>
        <label>
          grid{" "}
          <select value={grid} onChange={(e) => setGrid(e.currentTarget.value as "none" | "square" | "iso")}>
            <option value="none">なし</option>
            <option value="square">正方形</option>
            <option value="iso">アイソメトリック</option>
          </select>
        </label>
        {grid === "iso" && <NumberStepper label="高さ" value={isoLevel} min={0} max={15} onChange={setIsoHeight} />}
        {grid === "iso" && !colMap && <span class="dim">Collision Map が無いので位置は合いません</span>}
        <label>
          <input type="checkbox" checked={transparent0} onChange={(e) => setTransparent0(e.currentTarget.checked)} /> 色0 を透明にする
        </label>
      </div>
      <div class="controls">
        <label>
          Collision Map{" "}
          <select value={colID ?? ""} onChange={(e) => setColID(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}>
            {colIDs.length === 0 && <option value="">(なし)</option>}
            {colIDs.map((id) => <option key={id} value={id}>{hex4(id)}</option>)}
          </select>
        </label>
        {colMap && (
          <>
            <label>
              <input type="checkbox" checked={showCol} onChange={(e) => setShowCol(e.currentTarget.checked)} /> タイルを重ねる
            </label>
            {showCol && (["attr", "height", "outline"] as const).map((m) => (
              <label key={m}>
                <input type="radio" name="map-overlay-mode" checked={overlayMode === m} onChange={() => setOverlayMode(m)} /> {m === "attr" ? "属性" : m === "height" ? "高さ" : "枠だけ"}
              </label>
            ))}
            {showCol && (
              <label>
                不透明度 <input type="range" min={0} max={1} step={0.05} value={opacity} onInput={(e) => setOpacity(Number(e.currentTarget.value))} />
              </label>
            )}
            {(["zones", "paths", "navMesh"] as const).map((o) => (
              <label key={o}>
                <input type="checkbox" checked={world[o]} onChange={(e) => setWorld({ ...world, [o]: e.currentTarget.checked })} /> {o === "zones" ? "ゾーン" : o === "paths" ? "経路" : "ナビメッシュ"}
              </label>
            ))}
            <a href={collisionHref(colMap.id)}>Collision タブで開く</a>
          </>
        )}
      </div>
      <p class="mono hover-info">
        <HoverInfo slots={shown} colMap={colMap} x={hover[0]} y={hover[1]} />
      </p>
      <div class="overlay-host">
        <SpriteCanvas rendered={rendered} scale={scale} grid={grid === "square" ? 16 : undefined} onHover={(x, y) => setHover([x, y])} />
        {colMap && showCol && <CollisionOverlay map={colMap} width={width} height={height} scale={scale} mode={overlayMode} opacity={opacity} />}
        {colMap && (world.zones || world.paths || world.navMesh) && <WorldOverlay map={colMap} width={width} height={height} scale={scale} layers={world} />}
        {grid === "iso" && <IsoGrid width={width} height={height} scale={scale} origin={isoOrigin} />}
      </div>
      <h3>読み込み</h3>
      <SceneLoads entry={entry} scene={scene} />
    </>
  );
};

// マウスの下のタイル: BG ごとのメタタイルと、上面が見えている Collision Map のタイル
const HoverInfo: FunctionComponent<{ slots: BgSlot[]; colMap: CollisionMap | null; x: number; y: number }> = ({ slots, colMap, x, y }) => {
  if (x < 0) return null;
  const mx = x >> 4, my = y >> 4;
  const metatiles = [...slots].reverse().flatMap((s) => {
    const layer = s.map.layers[s.layer];
    if (mx >= layer.width || my >= layer.height) return [];
    return [`BG${s.bg} ${layer.mtmap[mtmapIndex(layer, mx, my)]}`];
  });
  const tile = colMap && tileAtTilemap(colMap, x, y);
  return (
    <>
      metatile ({mx}, {my}) {metatiles.join(" / ")}
      {tile && <br />}
      {tile && `Collision Map ${collisionTileText(colMap!, tile[0], tile[1])}`}
    </>
  );
};

const valueText = (v: number | null) => (v === null ? "?" : hex4(v));
const argText = (c: LoadCall) => Object.entries(c.args).map(([k, v]) => `.${k} = ${v.length === 1 ? valueText(v[0]) : `[${v.map(valueText).join(", ")}]`}`).join(", ");

// 場面の読み込みの一覧, 各ファイルのタブと呼び出しが書かれているスクリプトへのリンク
const SceneLoads: FunctionComponent<{ entry: MapEntry; scene: MapScene }> = ({ entry, scene }) => {
  const rows: [string, LoadCall, ComponentChildren][] = [
    ...scene.tilesets.map((c) => ["tileset", c, null] as [string, LoadCall, ComponentChildren]),
    ...scene.tilemaps.map((c) => ["tilemap", c, tilemapID(c) !== null && <a key="t" href={tilemapHref(tilemapID(c)!)}>{tilemapLabel(tilemapID(c)!)}</a>] as [string, LoadCall, ComponentChildren]),
    ...scene.bgs.map((c) => ["BG", c, null] as [string, LoadCall, ComponentChildren]),
    ...scene.collisions.map((c) => {
      const p = c.args.p?.[0];
      return ["collision", c, p !== null && p !== undefined && <a key="c" href={collisionHref(p)}>{hex4(p)}</a>] as [string, LoadCall, ComponentChildren];
    }),
    ...entry.pltts.map((c) => ["palette", c, (c.args.p ?? []).map((p, k) => p !== null && <a key={k} href={bgplttHref(p)} class="load-link">{bgpLabel(p, false)}</a>)] as [string, LoadCall, ComponentChildren]),
  ];
  return (
    <div class="script-loads">
      <p>"?" は値がスクリプトから決まらなかったもの, パレットは場面によらずこのスクリプトから届くもの全部</p>
      <table class="pltt-table">
        <tbody>
          {rows.map(([kind, c, link], i) => (
            <tr key={i}>
              <td>{kind}</td>
              <td>
                <a href={scriptHref(c.script)}>{hex4(c.script)}</a>
              </td>
              <td>
                {argText(c)}
                {c.conditional && " (if/switch の中)"}
              </td>
              <td>{link}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

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
import { collisionFiles, type CollisionMap, hasNavIslands, parseCollisionMap, projectToTilemap, tileAtTilemap } from "./collision.ts";
import { CollisionOverlay, IsoGrid, type OverlayMode, type WorldHighlight, type WorldLayers, WorldOverlay } from "./collision_overlay.tsx";
import type { LoadCall } from "./script_scan.ts";
import { scriptHref } from "./view_script.tsx";
import { collisionHref, collisionName, collisionTileRows, NavTable, PathTable, ZoneTable } from "./view_collision.tsx";
import { tilemapHref, tilemapName } from "./view_tilemap.tsx";
import { bgplttHref } from "./view_bgpltt.tsx";
import { type BgPlttChoice, BgPlttSelect, bgpName, Card, Check, CursorCard, Desc, Field, Fields, hashID, hex4, type InfoRow, InfoTable, NameRef, Segmented, Slider, SpriteCanvas, stageShort, ToggleList, useHashID, usePersistentState } from "./components.tsx";
import { STAGE_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";

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
    return `${label}${cols ? `, Collision Map ${cols}` : ""} (場面 ${i})`;
  });

export const MapViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const entries = mapEntries(rom);
  const tilesets = useMemo(() => parseTileSets(rom.data, rom.fs, rom.id), [rom]);
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
            <a href={mapHref(e.root)}>
              {hex4(e.root)} {stageShort(e.stage)}
            </a>
          </li>
        ))}
      </ul>
      {selected ? <MapView key={selected.root} rom={rom} entry={selected} ts={tilesets[0]} bgFiles={bgFiles} /> : <p>マップを読み込むスクリプトが見つかりません</p>}
    </div>
  );
};

// ステージの説明 (include/constants/map.h のコメント全文), 見出しに出す短い名前と同じなら出さない
const stageDesc = (stage: number | null) => {
  const desc = stage === null ? undefined : decomp(STAGE_NAMES)[stage]?.[1];
  return desc && desc !== stageShort(stage) ? desc : undefined;
};

// StageID と定数名
const StageText: FunctionComponent<{ stage: number }> = ({ stage }) => {
  const name = decomp(STAGE_NAMES)[stage];
  return <>{stage}{name && ` ${name[0]}`}</>;
};

const MapView: FunctionComponent<{ rom: ROMFile; entry: MapEntry; ts: TileSet | undefined; bgFiles: BgPlttFile[] }> = ({ rom, entry, ts, bgFiles }) => {
  const [sceneIdx, setSceneIdx] = useState(0);
  const scene = entry.scenes[sceneIdx];
  // 既定のパレット: スクリプトが指定する最初のもの
  const plttIDs = useMemo(() => [...new Set(entry.pltts.flatMap((c) => c.args.p ?? []).filter((p): p is number => p !== null && bgFiles.some((f) => f.id === p)))], [entry, bgFiles]);
  const [pltt, setPltt] = useState<BgPlttChoice>({ file: plttIDs[0] ?? null, row: 0 });

  return (
    <div class="sprite-view split-view">
      <h2>
        {hex4(entry.root)} {stageShort(entry.stage)}
      </h2>
      <SceneView
        key={sceneIdx}
        rom={rom}
        entry={entry}
        scene={scene}
        ts={ts}
        bgFiles={bgFiles}
        pltt={pltt}
        head={
          <>
            <Desc text={stageDesc(entry.stage)} />
            {entry.scenes.length > 1 && (
              <Card title="場面" tip="if/switch で読み込むものが変わる、または同じ BG に読み直しているので場面に分けている">
                <Fields>
                  <Field label="場面">
                    <select class="wide" value={sceneIdx} onChange={(e) => setSceneIdx(Number(e.currentTarget.value))}>
                      {sceneLabels(entry.scenes).map((label, i) => <option key={i} value={i}>{label}</option>)}
                    </select>
                  </Field>
                </Fields>
              </Card>
            )}
            <Card title="パレット">
              <Fields>
                <BgPlttSelect files={bgFiles} value={pltt} onChange={setPltt} rowSelectable={false} />
                {plttIDs.length > 0 && (
                  <Field label="スクリプトの指定">
                    {plttIDs.map((id) => (
                      <button type="button" key={id} class={id === pltt.file ? "selected" : ""} title={hex4(id)} onClick={() => setPltt({ file: id, row: 0 })}>
                        {bgpName(id) ?? hex4(id)}
                      </button>
                    ))}
                  </Field>
                )}
              </Fields>
            </Card>
          </>
        }
      />
    </div>
  );
};

// head: 右の欄の先頭に置くもの (MapView の説明・場面・パレットの選択)
const SceneView: FunctionComponent<{ rom: ROMFile; entry: MapEntry; scene: MapScene; ts: TileSet | undefined; bgFiles: BgPlttFile[]; pltt: BgPlttChoice; head: ComponentChildren }> = ({ rom, entry, scene, ts, bgFiles, pltt, head }) => {
  const state = useMemo(() => buildScene(rom, scene, ts), [rom, scene, ts]);
  const [hidden, setHidden] = useState<number[]>([]); // 隠している BG
  const [scale, setScale] = useState(1);
  const [transparent0, setTransparent0] = useState(true);
  const [grid, setGrid] = useState<"none" | "square" | "iso">("none");

  // 当たり判定: 場面で読み込むもの
  const colFiles = useMemo(() => collisionFiles(rom.fs), [rom]);
  const colIDs = [...new Set(scene.collisions.map((c) => c.args.p?.[0]).filter((p): p is number => p !== null && p !== undefined && colFiles.some((f) => f.id === p)))];
  const [colID, setColID] = useState<number | null>(colIDs[0] ?? null);
  // Collision のカードの Overlay の設定は、別の Map を見ても読み直しても保つ (localStorage)
  const [showCol, setShowCol] = usePersistentState("map.collision.tiles", true);
  const [overlayMode, setOverlayMode] = usePersistentState<OverlayMode>("map.collision.mode", "attr");
  const [opacity, setOpacity] = usePersistentState("map.collision.opacity", 0.35);
  const [world, setWorld] = usePersistentState<WorldLayers>("map.collision.layers", { zones: false, paths: false, navMesh: false });
  const [worldHL, setWorldHL] = useState<WorldHighlight>(null); // 一覧でマウスを乗せているゾーン・経路
  const colMap = useMemo((): CollisionMap | null => {
    const f = colFiles.find((f) => f.id === colID);
    return f ? parseCollisionMap(rom.data, f, hasNavIslands(rom.id)) : null;
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
    <div class="split">
      <div class="split-canvas">
        <div class="overlay-host">
          <SpriteCanvas rendered={rendered} scale={scale} grid={grid === "square" ? 16 : undefined} onHover={(x, y) => setHover([x, y])} />
          {colMap && showCol && <CollisionOverlay map={colMap} width={width} height={height} scale={scale} mode={overlayMode} opacity={opacity} />}
          {colMap && (world.zones || world.paths || world.navMesh || worldHL) && <WorldOverlay map={colMap} width={width} height={height} scale={scale} layers={world} highlight={worldHL} />}
          {grid === "iso" && <IsoGrid width={width} height={height} scale={scale} origin={isoOrigin} />}
        </div>
      </div>
      <div class="split-side">
        {head}
        <Card title="BG" tip="描く順に並べる (上が手前). 重なり順は BG の優先度と番号で決まる: 優先度の数が大きいほど奥, 同じなら BG 番号の大きい方が奥. レイヤの番号はタイルマップのファイル内での番号で、描く順とは関係ない">
          {state.slots.length === 0 ? <p class="note">BG に載るタイルマップがありません</p> : (
            <ToggleList
              items={frontToBack(state.slots).map((s) => ({
                key: s.bg,
                label: `BG${s.bg}`,
                detail: `${tilemapName(s.map.id) ?? hex4(s.map.id)} のレイヤ ${s.layer}, 優先度 ${s.prio}, ${s.map.layers[s.layer].width}x${s.map.layers[s.layer].height} メタタイル`,
                checked: !hidden.includes(s.bg),
                onChange: (on) => setHidden((cur) => (on ? cur.filter((b) => b !== s.bg) : [...cur, s.bg])),
              }))}
            />
          )}
        </Card>
        <Card title="表示">
          <Fields>
            <Field label="拡大">
              <Slider value={scale} min={1} max={8} onChange={setScale} format={(v) => `${v}x`} />
            </Field>
            <Field label="Grid">
              <Segmented options={[["none", "なし"], ["square", "正方形"], ["iso", "アイソメ"]] as const} value={grid} onChange={setGrid} />
            </Field>
            {grid === "iso" && (
              <Field label="Grid の高さ">
                <Slider value={isoLevel} min={0} max={15} onChange={setIsoHeight} />
                {!colMap && <span class="note">Collision Map が無いので位置は合いません</span>}
              </Field>
            )}
            <Field label="色0">
              <Check checked={transparent0} onChange={setTransparent0}>透明にする</Check>
            </Field>
          </Fields>
        </Card>
        <Card title="Collision">
          <Fields>
            <Field label="ファイル" title="Collision Map のファイル">
              <select value={colID ?? ""} onChange={(e) => setColID(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}>
                {colIDs.length === 0 && <option value="">(なし)</option>}
                {colIDs.map((id) => <option key={id} value={id}>{hex4(id)}</option>)}
              </select>
            </Field>
            {colMap && (
              <>
                <Field label="タイル">
                  <Check checked={showCol} onChange={setShowCol}>Overlay</Check>
                  {showCol && <Segmented options={[["attr", "属性"], ["height", "高さ"], ["outline", "枠だけ"]] as const} value={overlayMode} onChange={setOverlayMode} />}
                </Field>
                {showCol && (
                  <Field label="不透明度">
                    <Slider value={opacity} min={0} max={1} step={0.05} onChange={setOpacity} format={(v) => `${Math.round(v * 100)}%`} />
                  </Field>
                )}
                <Field label="Overlay">
                  {(["zones", "paths", "navMesh"] as const).map((o) => (
                    <Check key={o} checked={world[o]} onChange={(on) => setWorld((cur) => ({ ...cur, [o]: on }))}>
                      {o === "zones" ? "Zones" : o === "paths" ? "Paths" : "NavMesh"}
                    </Check>
                  ))}
                </Field>
              </>
            )}
          </Fields>
        </Card>
        <CursorCard rows={hoverRows(shown, colMap, hover[0], hover[1])} minRows={1 + state.slots.length + (colMap ? 6 : 0)} />
        {colMap && <ZoneTable map={colMap} hover={worldHL} onHover={setWorldHL} />}
        {colMap && <PathTable map={colMap} hover={worldHL} onHover={setWorldHL} />}
        {colMap && <NavTable map={colMap} hover={worldHL} onHover={setWorldHL} />}
        <Card title="Metadata">
          <InfoTable
            rows={[
              ["script", <a key="v" href={scriptHref(entry.root)}>Script {hex4(entry.root)}</a>, "このマップを読み込むスクリプト (起点). ここから呼ぶスクリプトの読み込みをまとめている"],
              ["stage", entry.stage === null ? <span key="v" class="dim">このマップでは設定していません (前のマップのものを引き継ぐ)</span> : <StageText key="v" stage={entry.stage} />],
              ["palette", pltt.file === null ? "(灰色)" : <NameRef key="v" id={pltt.file} name={bgpName(pltt.file)} href={bgplttHref(pltt.file)} />, "今描いている BG パレット"],
              [
                "Collision Map",
                colMap
                  ? (
                    <span key="v">
                      <NameRef id={colMap.id} name={collisionName(colMap.id)} href={collisionHref(colMap.id)} />, {colMap.width} x {colMap.height} タイル (x × z)
                    </span>
                  )
                  : <span key="v" class="dim">(なし)</span>,
              ],
              ["size", `${width}x${height} px`, "重ねた BG のうち一番大きいもの"],
            ]}
          />
        </Card>
        <Card title="読み込み" tip="値の ? はスクリプトから決まらなかったもの. パレットは場面によらず、このスクリプトから届くもの全部">
          <SceneLoads entry={entry} scene={scene} />
        </Card>
      </div>
    </div>
  );
};

// マウスの下のタイル: BG ごとのメタタイルと、上面が見えている Collision Map のタイル
// マウスの下にあるもの (カーソルの欄に出す行): メタタイルの座標と、BG ごとのメタタイル番号、当たり判定のタイル
// BG を描く順 (手前が先) に並べる. buildScene の slots は奥 -> 手前の順
const frontToBack = (slots: BgSlot[]) => [...slots].reverse();

const hoverRows = (slots: BgSlot[], colMap: CollisionMap | null, x: number, y: number): InfoRow[] | null => {
  if (x < 0) return null;
  const mx = x >> 4, my = y >> 4;
  const rows: InfoRow[] = [["位置", `metatile (${mx}, ${my})`, "メタタイル単位 (1 = 16 px)"]];
  for (const s of frontToBack(slots)) {
    const layer = s.map.layers[s.layer];
    if (mx < layer.width && my < layer.height) rows.push([`BG${s.bg}`, `metatile ${layer.mtmap[mtmapIndex(layer, mx, my)]}`, `${tilemapName(s.map.id) ?? hex4(s.map.id)} のレイヤ ${s.layer}. 上ほど手前`]);
  }
  const tile = colMap && tileAtTilemap(colMap, x, y);
  if (colMap && tile) rows.push(...collisionTileRows(colMap, tile[0], tile[1]));
  return rows;
};

// 引数の値: ID は 16 進 4 桁, 番号や数 (BG 番号, 優先度, レイヤ数, 読み込み先のタイル番号) は 10 進. 決まらなかった値は ?
const valueText = (v: number | null, decimal = false) => (v === null ? "?" : decimal ? String(v) : hex4(v));

// 読み込みの種類ごとの名前と、引数の意味 (docs/rom/map.md, script_scan.ts の SUB_*). decimal は 10 進で出す引数 (番号や数)
const LOAD_DECIMAL: Record<string, string[]> = { tileset: ["t", "s"], tilemap: ["t", "n", "i"], BG: ["i", "p"] };
const LOAD_KINDS: Record<string, [name: string, args: Record<string, string>]> = {
  tileset: ["タイルセット", { t: "BG", d: "タイルセット", c: "部品", s: "読み込み先", m: "タイルマップ" }],
  tilemap: ["タイルマップ", { d: "タイルマップ", t: "BG の構成", n: "レイヤ数", i: "レイヤ", c: "レイヤ ID" }],
  BG: ["BG", { i: "BG", p: "優先度", d: "タイルマップ", f: "フラグ" }],
  collision: ["当たり判定", { p: "ファイル", n: "対のタイルマップ" }],
  palette: ["パレット", { p: "パレット" }],
};

// 場面の読み込みの一覧, 各ファイルのタブと呼び出しが書かれているスクリプトへのリンク
const SceneLoads: FunctionComponent<{ entry: MapEntry; scene: MapScene }> = ({ entry, scene }) => {
  const rows: [string, LoadCall, ComponentChildren][] = [
    ...scene.tilesets.map((c) => ["tileset", c, null] as [string, LoadCall, ComponentChildren]),
    ...scene.tilemaps.map((c) => ["tilemap", c, tilemapID(c) !== null && <NameRef key="t" id={tilemapID(c)!} name={tilemapName(tilemapID(c)!)} href={tilemapHref(tilemapID(c)!)} />] as [string, LoadCall, ComponentChildren]),
    ...scene.bgs.map((c) => ["BG", c, null] as [string, LoadCall, ComponentChildren]),
    ...scene.collisions.map((c) => {
      const p = c.args.p?.[0];
      return ["collision", c, p !== null && p !== undefined && <NameRef key="c" id={p} name={collisionName(p)} href={collisionHref(p)} />] as [string, LoadCall, ComponentChildren];
    }),
    ...entry.pltts.map((c) =>
      [
        "palette",
        c,
        (c.args.p ?? []).map((p, k) =>
          p !== null && (
            <span key={k} class="load-link">
              <NameRef id={p} name={bgpName(p)} href={bgplttHref(p)} />
            </span>
          )
        ),
      ] as [string, LoadCall, ComponentChildren]
    ),
  ];
  return (
    <>
      <div class="load-list">
        {rows.map(([kind, c, link], i) => (
          <div key={i} class="load-item">
            <div class="load-head">
              <span class="load-kind">{LOAD_KINDS[kind]?.[0] ?? kind}</span>
              {link && <span class="load-target">{link}</span>}
              {c.conditional && <span class="badge" title="if/switch の中で呼んでいる">条件付き</span>}
            </div>
            <div class="load-args">
              <a href={scriptHref(c.script)}>Script {hex4(c.script)}</a>
              {Object.entries(c.args).map(([k, v]) => (
                <span key={k} title={`'.${k}'`}>
                  <span class="arg-key">{LOAD_KINDS[kind]?.[1][k] ?? `.${k}`}</span> {v.map((x) => valueText(x, LOAD_DECIMAL[kind]?.includes(k))).join(", ")}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

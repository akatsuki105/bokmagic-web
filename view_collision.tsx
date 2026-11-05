// 当たり判定マップ (DIR_COLLISION_MAP) のタブ, 上から見たグリッドにタイルの値を色で描き、ゾーン・経路・ナビメッシュを重ねる

import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { isSupported, type ROMFile } from "./rom.ts";
import { type FileEntry } from "./fs.ts";
import { drawLabel, HIGHLIGHT_COLOR, NAV_COLOR, navHighlight, pathColor, type WorldHighlight, ZONE_COLOR } from "./collision_overlay.tsx";
import { collisionFiles, type CollisionMap, hasNavIslands, parseCollisionMap } from "./collision.ts";
import { collisionLoads, mapEntries } from "./analysis.ts";
import type { LoadCall } from "./script_scan.ts";
import { tilemapHref, tilemapName } from "./view_tilemap.tsx";
import { COLLISION_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import { AssetView, Card, Check, CursorCard, Field, Fields, hashID, hex4, idLabel, type InfoRow, InfoTable, MapLink, NameRef, Segmented, Slider, UsedByCard, useHashID, type UseRef } from "./components.tsx";

const collisionLabel = (id: number, withDesc = true) => idLabel(id, decomp(COLLISION_NAMES)[id], withDesc);
export const collisionName = (id: number) => decomp(COLLISION_NAMES)[id]?.[0];

export const collisionHref = (id: number) => `#collision/${hex4(id)}`;

// TileAttr のビット (include/collision_map.h の TATTR_*)
const TATTR_NAMES: [number, string][] = [
  [1 << 0, "UNK_0"],
  [1 << 1, "WALL"],
  [1 << 2, "UNK_2"],
  [1 << 3, "UNK_3"],
  [1 << 4, "UNK_4"],
  [1 << 5, "UNK_5"],
  [1 << 6, "FALLDEATH"],
  [1 << 7, "SPECIAL"],
  [1 << 8, "UNK_8"],
  [1 << 10, "WALLISH"],
  [1 << 11, "UNK_11"],
  [1 << 12, "UNK_12"],
];
const attrNames = (a: number) => TATTR_NAMES.filter(([b]) => a & b).map(([, n]) => n).join("|") || "0";

const STAIRS_NAMES = ["なし", "縦", "横"];

type Mode = "height" | "stairs" | "attr" | "occluder";

const BASE_CELL = 12; // scale 1 のときの1タイルのピクセル数
type Overlays = { zones: boolean; paths: boolean; navMesh: boolean };

// 値ごとに色相を散らした色
const hueColor = (v: number, l = 55) => `hsl(${(v * 137.5) % 360} 65% ${l}%)`;

const tileColor = (map: CollisionMap, mode: Mode, k: number): string => {
  const t = map.tiles[k];
  switch (mode) {
    case "height":
      return `hsl(210 35% ${8 + t.height * 5.5}%)`;
    case "stairs":
      return t.stairs === 0 ? "#333" : t.stairs === 1 ? "hsl(30 80% 55%)" : "hsl(180 60% 45%)";
    case "attr":
      return t.attr === 0 ? "#333" : hueColor(t.attr);
    case "occluder":
      return t.occluder === 0xFF ? "#333" : hueColor(t.occluder);
  }
};

const tileText = (map: CollisionMap, mode: Mode, k: number): string => {
  const t = map.tiles[k];
  switch (mode) {
    case "height":
      return String(t.height);
    case "stairs":
      return t.stairs === 1 ? "↕" : t.stairs === 2 ? "↔" : "";
    case "attr":
      return t.attr ? t.attr.toString(16) : "";
    case "occluder":
      return t.occluder === 0xFF ? "" : String(t.occluder);
  }
};

export const CollisionViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const files = useMemo(() => collisionFiles(rom.fs), [rom]);
  // スクリプトが読めない作品 (U3IJ) では、どこから読み込まれているかを探さない (一覧を薄くしない)
  const scripted = isSupported(rom, "script");
  const loads = scripted ? collisionLoads(rom) : new Map();
  const byID = (id: number | undefined) => files.find((f) => f.id === id);
  const [selected, setSelected] = useState<FileEntry>(byID(hashID("collision")) ?? files[0]);
  useHashID("collision", (id) => {
    const f = byID(id);
    if (f) setSelected(f);
  });
  // マップを切り替えても表示設定は引き継ぐ
  const [mode, setMode] = useState<Mode>("height");
  const [overlays, setOverlays] = useState<Overlays>({ zones: true, paths: true, navMesh: false });
  const [scale, setScale] = useState(3);

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {files.map((f) => (
          <li key={f.id} class={f === selected ? "selected" : ""} title={loads.has(f.id) ? "スクリプトから読み込まれている" : ""}>
            <a href={collisionHref(f.id)} class={loads.has(f.id) || !scripted ? "" : "dim"}>{collisionLabel(f.id, false)}</a>
          </li>
        ))}
      </ul>
      <CollisionView key={selected.id} rom={rom} entry={selected} mode={mode} setMode={setMode} overlays={overlays} setOverlays={setOverlays} scale={scale} setScale={setScale} />
    </div>
  );
};

const CollisionView: FunctionComponent<{
  rom: ROMFile;
  entry: FileEntry;
  mode: Mode;
  setMode: (m: Mode) => void;
  overlays: Overlays;
  setOverlays: (o: Overlays) => void;
  scale: number;
  setScale: (c: number) => void;
}> = ({ rom, entry, mode, setMode, overlays, setOverlays, scale, setScale }) => {
  const map = useMemo(() => parseCollisionMap(rom.data, entry, hasNavIslands(rom.id)), [rom, entry]);
  const scripted = isSupported(rom, "script");
  const calls = scripted ? collisionLoads(rom).get(map.id) ?? [] : [];
  // Used by: この Collision Map を読み込む場面を持つ Map (Map タブと同じ mapEntries). 補足は同じ呼び出しの '.n' (対のタイルマップ)
  // どの Map の場面にも入らない呼び出しは、呼び出しのあるスクリプトとして出す
  const usedBy = useMemo((): UseRef[] => {
    if (!scripted) return [];
    const pairList = (cs: LoadCall[]) => {
      const ns = [...new Set(cs.map((c) => c.args.n?.[0]).filter((n): n is number => n !== null && n !== undefined))];
      return ns.length > 0
        ? (
          <>
            対: {ns.map((n, i) => (
              <span key={n}>
                {i > 0 && ", "}
                <NameRef id={n} name={tilemapName(n)} href={tilemapHref(n)} />
              </span>
            ))}
          </>
        )
        : undefined;
    };
    const refs: UseRef[] = [];
    const inMaps = new Set<number>();
    for (const e of mapEntries(rom)) {
      const cs = e.scenes.flatMap((sc) => sc.collisions.filter((c) => c.args.p?.[0] === map.id));
      if (cs.length === 0) continue;
      cs.forEach((c) => inMaps.add(c.address));
      refs.push({ key: `m${e.root}`, kind: "Map", link: <MapLink root={e.root} stage={e.stage} />, detail: pairList(cs), title: [...new Set(cs.map((c) => `Script ${hex4(c.script)}`))].join(", ") });
    }
    for (const c of calls.filter((c) => !inMaps.has(c.address))) {
      refs.push({ key: `s${c.address}`, kind: "Script", link: <a href={`#script/${hex4(c.script)}`}>Script {hex4(c.script)}</a>, detail: pairList([c]) });
    }
    return refs;
  }, [rom, map]);
  const [hover, setHover] = useState<[number, number]>([-1, -1]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [world, setWorld] = useState<WorldHighlight>(null); // 一覧でマウスを乗せているゾーン・経路 // 凡例で選んだ値 (attr / occluder)

  // attr / occluder の凡例: 値 -> タイル数
  const legend = useMemo(() => {
    if (mode !== "attr" && mode !== "occluder") return [];
    const counts = new Map<number, number>();
    for (const t of map.tiles) {
      const v = mode === "attr" ? t.attr : t.occluder;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => a[0] - b[0]);
  }, [map, mode]);

  return (
    <AssetView title={collisionLabel(map.id, false)} desc={decomp(COLLISION_NAMES)[map.id]?.[1]} stage={<CollisionCanvas map={map} mode={mode} overlays={overlays} cell={BASE_CELL * scale} highlight={highlight} world={world} onHover={(x, y) => setHover([x, y])} />}>
      <Card title="表示">
        <Fields>
          <Field label="塗り分け">
            <Segmented
              options={[["height", "高さ"], ["stairs", "階段"], ["attr", "属性"], ["occluder", "occluder"]] as const}
              value={mode}
              onChange={(m) => {
                setMode(m);
                setHighlight(null);
              }}
            />
          </Field>
          <Field label="Overlay">
            {(["zones", "paths", "navMesh"] as const).map((o) => (
              <Check key={o} checked={overlays[o]} onChange={(on) => setOverlays({ ...overlays, [o]: on })}>
                {o === "zones" ? "Zones" : o === "paths" ? "Paths" : "NavMesh"}
              </Check>
            ))}
          </Field>
          <Field label="拡大">
            <Slider value={scale} min={1} max={8} onChange={setScale} format={(v) => `${v}x`} />
          </Field>
        </Fields>
      </Card>
      {legend.length > 0 && (
        <Card title={`凡例 (${mode === "attr" ? "属性" : "occluder"})`} tip="押すとその値のタイルだけを強調する">
          <div class="legend">
            {legend.map(([v, n]) => (
              <span key={v} class={v === highlight ? "legend-item selected" : "legend-item"} onClick={() => setHighlight(v === highlight ? null : v)}>
                <span class="swatch" style={{ background: tileColor({ ...map, tiles: [mode === "attr" ? { ...map.tiles[0], attr: v } : { ...map.tiles[0], occluder: v }] }, mode, 0) }} />
                <span class="legend-name">{mode === "attr" ? `${hex4(v)} ${attrNames(v)}` : v === 0xFF ? "0xFF なし" : v}</span>
                <span class="legend-count">{n}</span>
              </span>
            ))}
          </div>
        </Card>
      )}
      <CursorCard rows={hoverRows(map, hover[0], hover[1])} minRows={6} />
      <Card title="Metadata">
        <InfoTable
          rows={[
            ["size", `${map.width} x ${map.height} タイル`, "width は x 方向, height は奥行き (z 方向) のタイル数. タイルの高さとは別"],
            ["tilemapOffset", `(${map.tilemapOffsetX}, ${map.tilemapOffsetY}) → (${map.tilemapOffsetX >> 4}, ${map.tilemapOffsetY >> 4}) px`, ">> 4 したものが、対になるタイルマップに重ねるときのずれ (px)"],
            ["unk_0", hex4(map.unk_0), "意味は分かっていない"],
          ]}
        />
      </Card>
      <ZoneTable map={map} hover={world} onHover={setWorld} />
      <PathTable map={map} hover={world} onHover={setWorld} />
      <NavTable map={map} hover={world} onHover={setWorld} />
      <UsedByCard
        refs={usedBy}
        tip="Map_LoadMapScripted (0x30AD) の '.p' でこの Collision Map を読み込む Map. 補足は同じ呼び出しの '.n' で、このツールは対になるタイルマップと見なしている (ゲームは読むが使わない). マウスを乗せると呼び出しのあるスクリプトが出る"
        empty={scripted ? "スクリプトから定数で読み込んでいる所は見つかっていない" : "この ROM のスクリプトは読めないので探していない"}
      />
    </AssetView>
  );
};

// タイル (x, y) の値の説明
// タイル (x, y) の情報 (カーソルの欄に出す行). Map タブも使う
export const collisionTileRows = (map: CollisionMap, x: number, y: number): InfoRow[] => {
  const t = map.tiles[y * map.width + x];
  const zones = map.zones.filter((z) => x * 256 + 128 >= z.x1 && x * 256 + 128 < z.x2 && y * 256 + 128 >= z.y1 && y * 256 + 128 < z.y2).map((z) => hex4(z.id));
  return [
    ["位置", `tile (${x}, ${y})`, "x と z (奥行き) のタイル座標"],
    ["height", t.height],
    ["stairs", STAIRS_NAMES[t.stairs] ?? t.stairs],
    ["occluder", t.occluder === 0xFF ? "なし (0xFF)" : t.occluder],
    ["attr", `${hex4(t.attr)} ${attrNames(t.attr)}`],
    ["zones", zones.length > 0 ? zones.join(" ") : "なし"],
  ];
};

const hoverRows = (map: CollisionMap, x: number, y: number) => (x < 0 || x >= map.width || y < 0 || y >= map.height ? null : collisionTileRows(map, x, y));

const CollisionCanvas: FunctionComponent<{ map: CollisionMap; mode: Mode; overlays: Overlays; cell: number; highlight: number | null; world?: WorldHighlight; onHover: (x: number, y: number) => void }> = ({ map, mode, overlays, cell, highlight, world = null, onHover }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = map.width * cell, height = map.height * cell;

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.font = `${Math.max(8, cell * 0.6)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // タイル
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const idx = y * map.width + x;
        const t = map.tiles[idx];
        const v = mode === "attr" ? t.attr : t.occluder;
        ctx.globalAlpha = highlight !== null && v !== highlight ? 0.2 : 1;
        ctx.fillStyle = tileColor(map, mode, idx);
        ctx.fillRect(x * cell, y * cell, cell, cell);
        if (cell >= 12) {
          ctx.fillStyle = "rgb(255 255 255 / 0.85)";
          ctx.fillText(tileText(map, mode, idx), x * cell + cell / 2, y * cell + cell / 2);
        }
      }
    }
    ctx.globalAlpha = 1;
    // タイルの境目
    ctx.strokeStyle = "rgb(0 0 0 / 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.width; x++) ctx.moveTo(x * cell + 0.5, 0), ctx.lineTo(x * cell + 0.5, height);
    for (let y = 0; y <= map.height; y++) ctx.moveTo(0, y * cell + 0.5), ctx.lineTo(width, y * cell + 0.5);
    ctx.stroke();

    const px = (v: number) => (v / 256) * cell; // 1 タイル = 256
    const k = cell / BASE_CELL; // 線や点の太さの倍率
    // NavMesh: 一覧で強調しているときは、強調する要素とそれにつながる要素を白で描き、ほかは薄くする
    const nav = navHighlight(map, world);
    if ((overlays.navMesh || nav) && map.navMesh) {
      map.navMesh.forEach((island, ii) => {
        island.rects.forEach((r, ri) => {
          const on = nav?.island === ii && nav.rects.has(ri);
          if (!overlays.navMesh && !on) return;
          const [x, y, w, h] = [r.minX * cell + 2 * k, r.minY * cell + 2 * k, (r.maxX - r.minX) * cell - 4 * k, (r.maxY - r.minY) * cell - 4 * k];
          if (on && nav.main === "rect") {
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = NAV_COLOR;
            ctx.fillRect(x, y, w, h);
          }
          ctx.globalAlpha = nav && !on ? 0.3 : 1;
          ctx.strokeStyle = on ? HIGHLIGHT_COLOR : NAV_COLOR;
          ctx.lineWidth = on && nav.main === "rect" ? 2.5 : 1;
          ctx.setLineDash(on && nav.main === "rect" ? [] : [3 * k, 3 * k]);
          ctx.strokeRect(x, y, w, h);
        });
        ctx.setLineDash([]);
        island.portals.forEach((p, pi) => {
          const on = nav?.island === ii && nav.portals.has(pi);
          if (!overlays.navMesh && !on) return;
          ctx.globalAlpha = nav && !on ? 0.3 : 1;
          ctx.fillStyle = on ? HIGHLIGHT_COLOR : NAV_COLOR;
          const r = (on ? 3.5 : 2) * k;
          ctx.fillRect(px(p.x) - r, px(p.y) - r, r * 2, r * 2);
          if (on && nav.main === "portal") {
            ctx.strokeStyle = HIGHLIGHT_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px(p.x), px(p.y), 9, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      });
      ctx.globalAlpha = 1;
    }
    // 一覧でマウスを乗せている要素は、重ねる設定がオフでも描き、太い線と濃い塗りで強調する (同じ種類のほかの要素は薄くする)
    const hlZone = world?.kind === "zone" ? world.index : -1;
    if (overlays.zones || hlZone >= 0) {
      map.zones.forEach((z, i) => {
        if (!overlays.zones && i !== hlZone) return;
        const hl = i === hlZone, dim = hlZone >= 0 && !hl;
        if (hl) {
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = ZONE_COLOR;
          ctx.fillRect(px(z.x1), px(z.y1), px(z.x2 - z.x1), px(z.y2 - z.y1));
        }
        ctx.globalAlpha = dim ? 0.35 : 1;
        ctx.strokeStyle = hl ? HIGHLIGHT_COLOR : ZONE_COLOR;
        ctx.lineWidth = hl ? 3 : 1.5;
        ctx.strokeRect(px(z.x1), px(z.y1), px(z.x2 - z.x1), px(z.y2 - z.y1));
        ctx.globalAlpha = 1;
      });
      map.zones.forEach((z, i) => {
        if ((!overlays.zones && i !== hlZone) || (hlZone >= 0 && i !== hlZone)) return;
        drawLabel(ctx, hex4(z.id), px(z.x1) + 24, px(z.y1) + 10, i === hlZone ? HIGHLIGHT_COLOR : ZONE_COLOR);
      });
      ctx.lineWidth = 1;
    }
    const hlPath = world?.kind === "path" ? world.index : -1;
    if (overlays.paths || hlPath >= 0) {
      map.paths.forEach((path, i) => {
        if (!overlays.paths && i !== hlPath) return;
        const hl = i === hlPath, dim = hlPath >= 0 && !hl;
        const color = hl ? HIGHLIGHT_COLOR : pathColor(i);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = hl ? 3 : 1.5;
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.beginPath();
        path.nodes.forEach((n, j) => (j === 0 ? ctx.moveTo(px(n.x), px(n.y)) : ctx.lineTo(px(n.x), px(n.y))));
        ctx.stroke();
        path.nodes.forEach((n, j) => {
          ctx.beginPath();
          ctx.arc(px(n.x), px(n.y), hl ? 4 : 2.5, 0, Math.PI * 2);
          ctx.fill();
          if (hl && world?.kind === "path" && world.node === j) {
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px(n.x), px(n.y), 9, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
        ctx.globalAlpha = 1;
        if (path.nodes[0] && !dim) drawLabel(ctx, `Path ${i}`, px(path.nodes[0].x), px(path.nodes[0].y) - 12, color);
        ctx.lineWidth = 1;
      });
    }
  }, [map, mode, overlays, cell, highlight, width, height, JSON.stringify(world)]);

  const hover = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onHover(Math.floor((e.clientX - r.left) / cell), Math.floor((e.clientY - r.top) / cell));
  };

  return <canvas ref={ref} class="collision-canvas" width={width} height={height} onMouseMove={hover} onMouseLeave={() => onHover(-1, -1)} />;
};

// 座標は 1 タイル = 256 なので、タイル単位に直して出す. 高さは 1 段 = 16
const tiles = (v: number) => (v % 256 === 0 ? `${v / 256}` : (v / 256).toFixed(2));

// ゾーンと経路の一覧 (Collision タブと Map タブ). 行にマウスを乗せると onHover で知らせ、絵の上で強調してもらう
export const ZoneTable: FunctionComponent<{ map: CollisionMap; hover: WorldHighlight; onHover: (h: WorldHighlight) => void }> = ({ map, hover, onHover }) =>
  map.zones.length === 0 ? null : (
    <Card title={`Zones (${map.zones.length})`} tip="スクリプトが id で指す範囲. x と z はタイル単位, 高さは段 (z1 / 16)">
      <table class="pltt-table striped sub-table hover-rows" onMouseLeave={() => onHover(null)}>
        <thead>
          <tr>
            <th>id</th>
            <th>x (タイル)</th>
            <th>z (タイル)</th>
            <th title="z1 / 16. z2 は範囲の判定に使われない">高さ (段)</th>
          </tr>
        </thead>
        <tbody>
          {map.zones.map((z, i) => (
            <tr key={i} class={hover?.kind === "zone" && hover.index === i ? "hl" : undefined} onMouseEnter={() => onHover({ kind: "zone", index: i })}>
              <td>{hex4(z.id)}</td>
              <td>{tiles(z.x1)} – {tiles(z.x2)}</td>
              <td>{tiles(z.y1)} – {tiles(z.y2)}</td>
              <td title={`z1 = ${z.z1}, z2 = ${z.z2}`}>{z.z1 / 16}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );

// PathNode.command の上位 4 ビット (decomp のコメントで分かっているもの)
const PATH_COMMANDS: Record<number, string> = { 0x00: "移動", 0x10: "方向転換" };

export const PathTable: FunctionComponent<{ map: CollisionMap; hover: WorldHighlight; onHover: (h: WorldHighlight) => void }> = ({ map, hover, onHover }) =>
  map.paths.length === 0 ? null : (
    <Card title={`Paths (${map.paths.length})`} tip="敵などが順にたどる点の列. 位置はタイル単位. 待ちは delay の下位 12 ビット (フレーム数), 動きは command の上位 4 ビット">
      <table class="pltt-table striped sub-table hover-rows" onMouseLeave={() => onHover(null)}>
        <thead>
          <tr>
            <th>Path</th>
            <th>Node</th>
            <th>x, z (タイル)</th>
            <th title="delay の下位 12 ビット. 上位 4 ビットは意味が分かっていない">待ち</th>
            <th title="command の上位 4 ビット">動き</th>
          </tr>
        </thead>
        <tbody>
          {map.paths.flatMap((p, i) =>
            p.nodes.map((n, k) => (
              <tr key={`${i}.${k}`} class={hover?.kind === "path" && hover.index === i ? (hover.node === k ? "hl strong" : "hl") : undefined} onMouseEnter={() => onHover({ kind: "path", index: i, node: k })}>
                <td>{k === 0 ? i : ""}</td>
                <td>{k}</td>
                <td>
                  {tiles(n.x)}, {tiles(n.y)}
                </td>
                <td title={`delay = ${hex4(n.delay)}`}>
                  {n.delay & 0xFFF}f{n.delay >> 12 ? ` (+${(n.delay >> 12).toString(16).toUpperCase()})` : ""}
                </td>
                <td title={`command = 0x${n.command.toString(16).toUpperCase().padStart(2, "0")}`}>{PATH_COMMANDS[n.command & 0xF0] ?? `0x${(n.command & 0xF0).toString(16).toUpperCase().padStart(2, "0")}`}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );

// NavMesh の一覧: 歩ける矩形 (Rect) と出入口 (Portal). 行にマウスを乗せると、その要素とつながる要素を絵の上で強調する
export const NavTable: FunctionComponent<{ map: CollisionMap; hover: WorldHighlight; onHover: (h: WorldHighlight) => void }> = ({ map, hover, onHover }) => {
  const islands = map.navMesh ?? [];
  const rects = islands.reduce((n, is) => n + is.rects.length, 0), portals = islands.reduce((n, is) => n + is.portals.length, 0);
  if (rects + portals === 0) return null;
  const multi = islands.length > 1;
  const isHL = (kind: "rect" | "portal", island: number, index: number) => hover?.kind === kind && hover.island === island && hover.index === index;
  return (
    <Card title={`NavMesh (${rects} Rects, ${portals} Portals)`} tip="敵の移動に使う、歩ける矩形 (Rect, タイル単位) と、矩形どうしの出入口 (Portal). つながりは Rect なら接する Portal, Portal ならつなぐ Rect. 番号は島の中での番号">
      <table class="pltt-table striped sub-table hover-rows" onMouseLeave={() => onHover(null)}>
        <thead>
          <tr>
            {multi && <th>Island</th>}
            <th>種類</th>
            <th>x (タイル)</th>
            <th>z (タイル)</th>
            <th>つながり</th>
          </tr>
        </thead>
        <tbody>
          {islands.flatMap((is, ii) => [
            ...is.rects.map((r, ri) => (
              <tr key={`r${ii}.${ri}`} class={isHL("rect", ii, ri) ? "hl" : undefined} onMouseEnter={() => onHover({ kind: "rect", island: ii, index: ri })}>
                {multi && <td>{ri === 0 ? ii : ""}</td>}
                <td>Rect {ri}</td>
                <td>{r.minX} – {r.maxX - 1}</td>
                <td>{r.minY} – {r.maxY - 1}</td>
                <td class="links">{r.portals.length > 0 ? `Portal ${r.portals.join(", ")}` : "-"}</td>
              </tr>
            )),
            ...is.portals.map((p, pi) => (
              <tr key={`p${ii}.${pi}`} class={isHL("portal", ii, pi) ? "hl" : undefined} onMouseEnter={() => onHover({ kind: "portal", island: ii, index: pi })} title={`unk_4 = ${hex4(p.unk_4)}`}>
                {multi && <td></td>}
                <td>Portal {pi}</td>
                <td>{tiles(p.x)}</td>
                <td>{tiles(p.y)}</td>
                <td class="links">{p.rects.length > 0 ? `Rect ${p.rects.join(", ")}` : "-"}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </Card>
  );
};

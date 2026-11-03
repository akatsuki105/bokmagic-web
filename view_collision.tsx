// 当たり判定マップ (DIR_COLLISION_MAP) のタブ, 上から見たグリッドにタイルの値を色で描き、ゾーン・経路・ナビメッシュを重ねる

import { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { type FileEntry } from "./fs.ts";
import { collisionFiles, type CollisionMap, parseCollisionMap } from "./collision.ts";
import { collisionLoads } from "./analysis.ts";
import { scriptHref } from "./view_script.tsx";
import { tilemapHref } from "./view_tilemap.tsx";
import { COLLISION_NAMES } from "./names.ts";
import { decomp } from "./decomp.ts";
import { hashID, hex4, NumberStepper, useHashID } from "./components.tsx";

const collisionLabel = (id: number, withDesc = true) => {
  const name = decomp(COLLISION_NAMES)[id];
  if (!name) return hex4(id);
  return withDesc && name[1] ? `${hex4(id)} ${name[0]} ${name[1]}` : `${hex4(id)} ${name[0]}`;
};

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
  const loads = collisionLoads(rom);
  const byID = (id: number | undefined) => files.find((f) => f.id === id);
  const [selected, setSelected] = useState<FileEntry>(byID(hashID("collision")) ?? files[0]);
  useHashID("collision", (id) => {
    const f = byID(id);
    if (f) setSelected(f);
  });
  // マップを切り替えても表示設定は引き継ぐ
  const [mode, setMode] = useState<Mode>("height");
  const [overlays, setOverlays] = useState<Overlays>({ zones: true, paths: true, navMesh: false });
  const [scale, setScale] = useState(2);

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {files.map((f) => (
          <li key={f.id} class={f === selected ? "selected" : ""} title={loads.has(f.id) ? "スクリプトから読み込まれている" : ""}>
            <a href={collisionHref(f.id)} class={loads.has(f.id) ? "" : "dim"}>{collisionLabel(f.id, false)}</a>
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
  const map = useMemo(() => parseCollisionMap(rom.data, entry), [rom, entry]);
  const calls = collisionLoads(rom).get(map.id) ?? [];
  const [hover, setHover] = useState<[number, number]>([-1, -1]);
  const [highlight, setHighlight] = useState<number | null>(null); // 凡例で選んだ値 (attr / occluder)

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
    <div class="sprite-view">
      <h2>{collisionLabel(map.id)}</h2>
      <p>
        {map.width}x{map.height} tiles, tilemapOffset: ({map.tilemapOffsetX}, {map.tilemapOffsetY}), unk_0: {map.unk_0}, zones: {map.zones.length}, paths: {map.paths.length}, navMesh: {map.navMesh ? `${map.navMesh.length} islands` : "なし"}
      </p>
      <p class="anim-refs">
        {calls.length > 0
          ? calls.map((c, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <a href={scriptHref(c.script)}>Script {hex4(c.script)}</a>
              {c.args.n?.[0] !== null && c.args.n?.[0] !== undefined && (
                <>
                  {" "}(<a href={tilemapHref(c.args.n[0])}>tilemap {hex4(c.args.n[0])}</a>)
                </>
              )}
            </span>
          ))
          : "スクリプトから定数で読み込んでいる箇所は見つかっていません"}
      </p>
      <div class="controls">
        {(["height", "stairs", "attr", "occluder"] as const).map((m) => (
          <label key={m}>
            <input
              type="radio"
              name="collision-mode"
              checked={mode === m}
              onChange={() => {
                setMode(m);
                setHighlight(null);
              }}
            />{" "}
            {m === "height" ? "高さ" : m === "stairs" ? "階段" : m === "attr" ? "属性" : "occluder"}
          </label>
        ))}
      </div>
      <div class="controls">
        {(["zones", "paths", "navMesh"] as const).map((o) => (
          <label key={o}>
            <input type="checkbox" checked={overlays[o]} onChange={(e) => setOverlays({ ...overlays, [o]: e.currentTarget.checked })} /> {o === "zones" ? "ゾーン" : o === "paths" ? "経路" : "ナビメッシュ"}
          </label>
        ))}
        <NumberStepper label="scale" value={scale} min={1} max={8} onChange={setScale} />
      </div>
      {legend.length > 0 && (
        <div class="legend">
          {legend.map(([v, n]) => (
            <span key={v} class={v === highlight ? "legend-item selected" : "legend-item"} onClick={() => setHighlight(v === highlight ? null : v)}>
              <span class="swatch" style={{ background: tileColor({ ...map, tiles: [mode === "attr" ? { ...map.tiles[0], attr: v } : { ...map.tiles[0], occluder: v }] }, mode, 0) }} />
              {mode === "attr" ? `${hex4(v)} ${attrNames(v)}` : v === 0xFF ? "0xFF なし" : v} ({n})
            </span>
          ))}
        </div>
      )}
      <p class="mono">
        <HoverInfo map={map} x={hover[0]} y={hover[1]} />
      </p>
      <CollisionCanvas map={map} mode={mode} overlays={overlays} cell={BASE_CELL * scale} highlight={highlight} onHover={(x, y) => setHover([x, y])} />
      <ZoneTable map={map} />
      <PathTable map={map} />
    </div>
  );
};

const HoverInfo: FunctionComponent<{ map: CollisionMap; x: number; y: number }> = ({ map, x, y }) => {
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) return <span>マウスを乗せるとタイルの値を表示します</span>;
  const t = map.tiles[y * map.width + x];
  const zones = map.zones.filter((z) => x * 256 + 128 >= z.x1 && x * 256 + 128 < z.x2 && y * 256 + 128 >= z.y1 && y * 256 + 128 < z.y2).map((z) => hex4(z.id));
  return (
    <span>
      ({x}, {y}) 高さ {t.height}, 階段 {STAIRS_NAMES[t.stairs] ?? t.stairs}, occluder {t.occluder === 0xFF ? "なし" : t.occluder}, attr {hex4(t.attr)} {attrNames(t.attr)}
      {zones.length > 0 && `, zone ${zones.join(" ")}`}
    </span>
  );
};

const CollisionCanvas: FunctionComponent<{ map: CollisionMap; mode: Mode; overlays: Overlays; cell: number; highlight: number | null; onHover: (x: number, y: number) => void }> = ({ map, mode, overlays, cell, highlight, onHover }) => {
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
    if (overlays.navMesh && map.navMesh) {
      map.navMesh.forEach((island, i) => {
        ctx.strokeStyle = hueColor(i + 3, 70);
        ctx.lineWidth = k;
        ctx.setLineDash([4 * k, 3 * k]);
        for (const r of island.rects) ctx.strokeRect(r.minX * cell + 2 * k, r.minY * cell + 2 * k, (r.maxX - r.minX) * cell - 4 * k, (r.maxY - r.minY) * cell - 4 * k);
        ctx.setLineDash([]);
        ctx.fillStyle = hueColor(i + 3, 70);
        for (const p of island.portals) ctx.fillRect(px(p.x) - 3 * k, px(p.y) - 3 * k, 6 * k, 6 * k);
      });
    }
    if (overlays.zones) {
      ctx.strokeStyle = "#ffd400";
      ctx.fillStyle = "#ffd400";
      ctx.lineWidth = 2 * k;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (const z of map.zones) {
        ctx.strokeRect(px(z.x1), px(z.y1), px(z.x2 - z.x1), px(z.y2 - z.y1));
        ctx.fillText(hex4(z.id), px(z.x1) + 2 * k, px(z.y1) + 2 * k);
      }
      ctx.lineWidth = 1;
    }
    if (overlays.paths) {
      map.paths.forEach((path, i) => {
        const color = hueColor(i, 65);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2 * k;
        ctx.beginPath();
        path.nodes.forEach((n, j) => (j === 0 ? ctx.moveTo(px(n.x), px(n.y)) : ctx.lineTo(px(n.x), px(n.y))));
        ctx.stroke();
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        path.nodes.forEach((n, j) => {
          ctx.beginPath();
          ctx.arc(px(n.x), px(n.y), 3 * k, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillText(`${i}.${j}`, px(n.x) + 4 * k, px(n.y) - 2 * k);
        });
        ctx.lineWidth = 1;
      });
    }
  }, [map, mode, overlays, cell, highlight, width, height]);

  const hover = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onHover(Math.floor((e.clientX - r.left) / cell), Math.floor((e.clientY - r.top) / cell));
  };

  return <canvas ref={ref} class="collision-canvas" width={width} height={height} onMouseMove={hover} onMouseLeave={() => onHover(-1, -1)} />;
};

const ZoneTable: FunctionComponent<{ map: CollisionMap }> = ({ map }) =>
  map.zones.length === 0 ? null : (
    <>
      <h3>ゾーン</h3>
      <table class="pltt-table">
        <thead>
          <tr>
            <th>#</th>
            <th>id</th>
            <th>x1, y1 - x2, y2 (タイル)</th>
            <th>z1 - z2</th>
          </tr>
        </thead>
        <tbody>
          {map.zones.map((z, i) => (
            <tr key={i}>
              <td>{i}</td>
              <td>{hex4(z.id)}</td>
              <td>
                {z.x1 / 256}, {z.y1 / 256} - {z.x2 / 256}, {z.y2 / 256}
              </td>
              <td>
                {z.z1} - {z.z2}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

const PathTable: FunctionComponent<{ map: CollisionMap }> = ({ map }) =>
  map.paths.length === 0 ? null : (
    <>
      <h3>経路</h3>
      <table class="pltt-table">
        <thead>
          <tr>
            <th>path.node</th>
            <th>x, y (タイル)</th>
            <th>delay</th>
            <th>command</th>
          </tr>
        </thead>
        <tbody>
          {map.paths.flatMap((p, i) =>
            p.nodes.map((n, k) => (
              <tr key={`${i}.${k}`}>
                <td>
                  {i}.{k}
                </td>
                <td>
                  {n.x / 256}, {n.y / 256}
                </td>
                <td>{hex4(n.delay)}</td>
                <td>0x{n.command.toString(16).toUpperCase().padStart(2, "0")}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );

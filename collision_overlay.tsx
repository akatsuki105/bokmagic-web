// タイルマップの上に当たり判定マップを重ねる canvas
// 各タイルの上面を projectToTilemap でタイルマップのピクセル座標に投影し (平らなタイルは菱形、階段は傾いた四角形)、色を付けて半透明で描く

import { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { type CollisionMap, type CollisionTile, type NavRect, projectToTilemap, tileQuad } from "./collision.ts";

export type OverlayMode = "height" | "attr" | "outline";

const TATTR_WALL = 1 << 1;

// 重ね描きの色 (絵の上に重ねるので彩度を落とす)
// 属性: そのマップに出てくる値ごとに見分けられる色を割り当てる. WALL を含む値は暖色、含まない値は寒色から、値の小さい順に取る
// 高さ: 青の 1 色で、高いほど明るい
const WALL_COLORS = ["hsl(0 60% 52%)", "hsl(30 75% 52%)", "hsl(330 55% 58%)", "hsl(50 75% 50%)", "hsl(15 45% 36%)", "hsl(350 65% 75%)"];
const OTHER_COLORS = ["hsl(190 60% 48%)", "hsl(140 45% 46%)", "hsl(225 60% 62%)", "hsl(275 45% 62%)", "hsl(165 50% 68%)", "hsl(95 45% 60%)"];
export const attrPalette = (values: number[]): Map<number, string> => {
  const colors = new Map<number, string>();
  let wall = 0, other = 0;
  for (const v of [...new Set(values)].filter((v) => v !== 0).sort((a, b) => a - b)) {
    const list = v & TATTR_WALL ? WALL_COLORS : OTHER_COLORS;
    const k = v & TATTR_WALL ? wall++ : other++;
    colors.set(v, list[k] ?? `hsl(${(v * 137.5) % 360} 45% 55%)`);
  }
  return colors;
};
// マップの中で描くタイル (tileShown) の属性の値から色を決める
export const mapAttrPalette = (map: CollisionMap): Map<number, string> => {
  const values: number[] = [];
  for (let z = 0; z < map.height; z++) for (let x = 0; x < map.width; x++) if (tileShown(map, x, z, "attr")) values.push(map.tiles[z * map.width + x].attr);
  return attrPalette(values);
};
export const heightOverlayColor = (h: number) => `hsl(215 45% ${22 + h * 4.5}%)`;

// タイルを塗り分ける値. 境目の線は、この値が隣と違う所にだけ引く
const fillKey = (t: CollisionTile, mode: OverlayMode): number | null => {
  switch (mode) {
    case "height":
      return t.height;
    case "attr":
      return t.attr === 0 ? null : t.attr;
    case "outline":
      return null;
  }
};

const fillColor = (t: CollisionTile, mode: OverlayMode, attrColors: Map<number, string>): string | null => {
  switch (mode) {
    case "height":
      return heightOverlayColor(t.height);
    case "attr":
      return t.attr === 0 ? null : attrColors.get(t.attr) ?? null;
    case "outline":
      return null;
  }
};

// 「属性」「高さ」で描くタイルか: どの Zone にも入らないタイル (タイルの真ん中で見る) は描かない. Zone が 1 つも無いマップでは全タイル
export const tileShown = (map: CollisionMap, x: number, z: number, mode: OverlayMode) => {
  if (mode === "outline" || map.zones.length === 0) return true;
  const cx = (x << 8) + 128, cz = (z << 8) + 128;
  return map.zones.some((q) => cx >= q.x1 && cx < q.x2 && cz >= q.y1 && cz < q.y2);
};

// width, height はタイルマップのピクセル数
// 全タイルに枠を引くと絵の上に細かい格子がかぶって見づらいので、塗り分ける値が隣と違う辺 (領域の境目) にだけ、暗い半透明の細い線を引く
// 「枠だけ」のときは全タイルの枠を薄く引く
// 「属性」「高さ」は、どの Zone にも入らないタイル (タイルの真ん中で見る) には描かない. Zone が 1 つも無いマップでは全タイルに描く
export const CollisionOverlay: FunctionComponent<{ map: CollisionMap; width: number; height: number; scale: number; mode: OverlayMode; opacity: number }> = ({ map, width, height, scale, mode, opacity }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width * scale, height * scale);
    ctx.lineWidth = 1;
    const shown = (x: number, z: number) => tileShown(map, x, z, mode);
    const attrColors = mapAttrPalette(map);
    const tileAt = (x: number, z: number) => (x < 0 || z < 0 || x >= map.width || z >= map.height || !shown(x, z) ? undefined : map.tiles[z * map.width + x]);
    // 奥 (x + z が小さい) から手前へ描く
    const order: [number, number][] = [];
    for (let z = 0; z < map.height; z++) for (let x = 0; x < map.width; x++) order.push([x, z]);
    order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    for (const [x, z] of order) {
      if (!shown(x, z)) continue;
      const t = map.tiles[z * map.width + x];
      const q = tileQuad(map, x, z).map(([px, py]) => [px * scale, py * scale] as [number, number]);
      const fill = fillColor(t, mode, attrColors);
      if (fill) {
        ctx.beginPath();
        q.forEach(([px, py], k) => (k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.closePath();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = fill;
        ctx.fill();
      }
      // 辺 k は q[k] → q[k+1]: z0 側 (z-1 の隣), x1 側 (x+1), z1 側 (z+1), x0 側 (x-1)
      const key = fillKey(t, mode);
      const neighbors = [tileAt(x, z - 1), tileAt(x + 1, z), tileAt(x, z + 1), tileAt(x - 1, z)];
      ctx.beginPath();
      neighbors.forEach((n, k) => {
        const edge = mode === "outline" || (key !== null && (n === undefined || fillKey(n, mode) !== key || n.height !== t.height));
        if (!edge) return;
        const [ax, ay] = q[k], [bx, by] = q[(k + 1) % 4];
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      });
      ctx.globalAlpha = 1;
      ctx.strokeStyle = mode === "outline" ? `rgb(255 255 255 / ${0.15 + opacity * 0.4})` : `rgb(16 18 22 / ${0.25 + opacity * 0.5})`;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [map, width, height, scale, mode, opacity]);

  return <canvas ref={ref} class="collision-overlay" width={width * scale} height={height * scale} />;
};

// アイソメトリックのグリッド: 当たり判定の1タイルの境目の線を、タイルマップ全体に引く
// projectToTilemap ではワールドの x が1タイル (256) 進むと (+24, +24)、z が1タイル進むと (-24, +24) 動くので、1タイルは横48・縦48の菱形で辺の傾きは ±1
// 高さが1段上がると 24px 上にずれ、これは格子1つ分ではないので、線は高さごとに違う
// origin はワールド座標 (0, 0, 高さ) のタイルマップ上の位置 (projectToTilemap(map, 0, 0, height << 8))
export const IsoGrid: FunctionComponent<{ width: number; height: number; scale: number; origin: [number, number] }> = ({ width, height, scale, origin }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const w = width * scale, h = height * scale;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgb(255 255 255 / 0.3)"; // 絵の上なので薄い白
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [ox, oy] = origin;
    // z が一定の線: y = x + c (傾き +1), z が1タイル違うと c が 48 違う
    const ca = oy - ox;
    for (let c = ca + Math.floor((-width - ca) / 48) * 48; c <= height; c += 48) {
      ctx.moveTo(0, c * scale), ctx.lineTo(w, (width + c) * scale);
    }
    // x が一定の線: y = -x + c (傾き -1), x が1タイル違うと c が 48 違う
    const cb = oy + ox;
    for (let c = cb + Math.floor((0 - cb) / 48) * 48; c <= width + height; c += 48) {
      ctx.moveTo(0, c * scale), ctx.lineTo(w, (c - width) * scale);
    }
    ctx.stroke();
  }, [width, height, scale, origin[0], origin[1]]);

  return <canvas ref={ref} class="collision-overlay" width={width * scale} height={height * scale} />;
};

export type WorldLayers = { zones: boolean; paths: boolean; navIslands: boolean };

// 一覧の行にマウスを乗せているゾーン・経路 (絵の上で強調する). node は経路の点
// island は NavMesh の島の番号 (Map), rect, portal は島 island の中の番号 (Collision タブ)
export type WorldHighlight =
  | { kind: "zone"; index: number }
  | { kind: "path"; index: number; node?: number }
  | { kind: "island"; index: number }
  | { kind: "rect"; island: number; index: number }
  | { kind: "portal"; island: number; index: number }
  | null;

// NavMesh の要素を強調するときに、強調するものとそれにつながるもの (rect なら出入口, portal なら矩形)
export const navHighlight = (map: CollisionMap, h: WorldHighlight) => {
  if (!map.navMesh || !h || (h.kind !== "rect" && h.kind !== "portal")) return null;
  const island = map.navMesh[h.island];
  if (!island) return null;
  return h.kind === "rect" ? { island: h.island, rects: new Set([h.index]), portals: new Set(island.rects[h.index]?.portals ?? []), main: "rect" as const } : { island: h.island, rects: new Set(island.portals[h.index]?.rects ?? []), portals: new Set([h.index]), main: "portal" as const };
};

// ゾーン・経路・ナビメッシュの色 (彩度を落とす). Collision タブの上から見た図も同じ色を使う
export const ZONE_COLOR = "hsl(42 65% 60%)";
export const pathColor = (i: number) => `hsl(${(i * 137.5 + 200) % 360} 45% 65%)`;
export const NAV_COLOR = "hsl(160 35% 60%)";
export const islandColor = (i: number) => `hsl(${(i * 137.5 + 160) % 360} 40% 62%)`;
export const HIGHLIGHT_COLOR = "hsl(0 0% 96%)"; // 一覧でマウスを乗せている要素

// 絵の上に置く小さな札 (暗い背景に明るい文字). 絵に直接文字を書くと読みにくいので
export const drawLabel = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) => {
  ctx.font = "11px ui-monospace, Menlo, monospace";
  const w = ctx.measureText(text).width + 8, h = 15;
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "rgb(16 18 22)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
};

// ワールド座標 (x, z) の地面の高さ (タイルの高さ, 階段は無視)
const groundY = (map: CollisionMap, x: number, z: number) => {
  const tx = Math.min(map.width - 1, Math.max(0, x >> 8)), tz = Math.min(map.height - 1, Math.max(0, z >> 8));
  return (map.tiles[tz * map.width + tx]?.height ?? 0) << 8;
};

// ゾーン・経路・ナビメッシュの島をタイルマップの上に投影して描く (Collision タブでは上から見た図で描いているもの)
// ゾーンは底の高さ z1 (1 段 = 16) の面、経路の点と島の矩形はその位置の地面の高さに置く
// 線は細く、塗りは薄く、文字は札に入れる. 経路の札は始点にだけ付ける (点ごとの番号は Collision タブの表で見る)
// highlight があれば、その要素を太い線と濃い塗りで描き、同じ種類のほかの要素は薄くする. 重ねる設定がオフでも強調する要素は描く
// opacity は全体の不透明度. 強調しているあいだは強調が見えるように 1 で描く (ほかの要素は上のとおり薄くしている)
export const WorldOverlay: FunctionComponent<{ map: CollisionMap; width: number; height: number; scale: number; layers: WorldLayers; highlight?: WorldHighlight; opacity?: number }> = ({ map, width, height, scale, layers, highlight = null, opacity = 1 }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width * scale, height * scale);
    const pt = (x: number, z: number, y = groundY(map, x, z)): [number, number] => {
      const [px, py] = projectToTilemap(map, x, z, y);
      return [px * scale, py * scale];
    };
    const poly = (ps: [number, number][]) => {
      ctx.beginPath();
      ps.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
    };
    // NavMesh の島: Zone と同じく、島ごとに範囲を薄く塗って外周に線を引き、札を付ける (島の中の矩形の境目と出入口は描かない)
    // 矩形はその左上の隅の地面の高さに置く (Collision タブの上から見た図では矩形と出入口を描いている)
    const hlIsland = highlight?.kind === "island" ? highlight.index : -1;
    if ((layers.navIslands || hlIsland >= 0) && map.navMesh) {
      map.navMesh.forEach((island, i) => {
        if ((!layers.navIslands && i !== hlIsland) || island.rects.length === 0) return;
        const hl = i === hlIsland, dim = hlIsland >= 0 && !hl;
        const color = hl ? HIGHLIGHT_COLOR : islandColor(i);
        // タイルごとに、どの矩形に入るか (その矩形の高さで描く)
        const owner = new Map<number, number>();
        island.rects.forEach((r, ri) => {
          for (let z = r.minY; z < r.maxY; z++) for (let x = r.minX; x < r.maxX; x++) owner.set(z * map.width + x, ri);
        });
        const heights = island.rects.map((r) => groundY(map, r.minX << 8, r.minY << 8));
        const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < map.width && z < map.height && owner.has(z * map.width + x);
        // 塗り: 矩形をまとめて 1 回で塗る (重ねて濃くならないように、継ぎ目が出ないように)
        ctx.beginPath();
        island.rects.forEach((r, ri) => {
          const y = heights[ri];
          const ps = [pt(r.minX << 8, r.minY << 8, y), pt(r.maxX << 8, r.minY << 8, y), pt(r.maxX << 8, r.maxY << 8, y), pt(r.minX << 8, r.maxY << 8, y)];
          ps.forEach(([px, py], k) => (k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
          ctx.closePath();
        });
        ctx.globalAlpha = hl ? 0.35 : dim ? 0.05 : 0.12;
        ctx.fillStyle = islandColor(i);
        ctx.fill();
        // 外周: 隣のタイルが島に入らない辺だけを引く
        ctx.beginPath();
        for (const [key, ri] of owner) {
          const x = key % map.width, z = Math.floor(key / map.width), y = heights[ri];
          const edge = (x1: number, z1: number, x2: number, z2: number) => {
            const [ax, ay] = pt(x1 << 8, z1 << 8, y), [bx, by] = pt(x2 << 8, z2 << 8, y);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          };
          if (!inside(x, z - 1)) edge(x, z, x + 1, z);
          if (!inside(x + 1, z)) edge(x + 1, z, x + 1, z + 1);
          if (!inside(x, z + 1)) edge(x, z + 1, x + 1, z + 1);
          if (!inside(x - 1, z)) edge(x, z, x, z + 1);
        }
        ctx.globalAlpha = dim ? 0.35 : hl ? 1 : 0.85;
        ctx.strokeStyle = color;
        ctx.lineWidth = hl ? 3 : 1.5;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.lineCap = "butt";
        ctx.globalAlpha = 1;
      });
      // 札は一番大きい矩形の真ん中に (島の形がへこんでいても島の中に来るように)
      map.navMesh.forEach((island, i) => {
        if ((!layers.navIslands && i !== hlIsland) || (hlIsland >= 0 && i !== hlIsland) || island.rects.length === 0) return;
        const area = (r: NavRect) => (r.maxX - r.minX) * (r.maxY - r.minY);
        const r = island.rects.reduce((a, b) => (area(b) > area(a) ? b : a));
        const [cx, cy] = pt((r.minX + r.maxX) << 7, (r.minY + r.maxY) << 7, groundY(map, r.minX << 8, r.minY << 8));
        drawLabel(ctx, `Island ${i}`, cx, cy, i === hlIsland ? HIGHLIGHT_COLOR : islandColor(i));
      });
    }
    // NavIslands の一覧で開いた Rect / Portal の行に乗せているとき: その要素を白で、つながる要素を白の点線 (矩形) や小さな点 (出入口) で描く
    const nav = navHighlight(map, highlight);
    const navIsland = nav && map.navMesh?.[nav.island];
    if (nav && navIsland) {
      navIsland.rects.forEach((r, ri) => {
        if (!nav.rects.has(ri)) return;
        const main = nav.main === "rect";
        const y = groundY(map, r.minX << 8, r.minY << 8);
        poly([pt(r.minX << 8, r.minY << 8, y), pt(r.maxX << 8, r.minY << 8, y), pt(r.maxX << 8, r.maxY << 8, y), pt(r.minX << 8, r.maxY << 8, y)]);
        if (main) {
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = HIGHLIGHT_COLOR;
          ctx.fill();
        }
        // 明るい床でも見えるよう、白い線の下に暗い縁取りを敷く
        ctx.setLineDash(main ? [] : [4, 3]);
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = "rgb(0 0 0)";
        ctx.lineWidth = main ? 4.5 : 3.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = HIGHLIGHT_COLOR;
        ctx.lineWidth = main ? 2.5 : 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      });
      navIsland.portals.forEach((p, pi) => {
        if (!nav.portals.has(pi)) return;
        const [x, y] = pt(p.x, p.y);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgb(0 0 0 / 0.6)";
        ctx.fillRect(x - 5, y - 5, 10, 10);
        ctx.fillStyle = HIGHLIGHT_COLOR;
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
        if (nav.main === "portal") {
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.strokeStyle = "rgb(0 0 0 / 0.6)";
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.strokeStyle = HIGHLIGHT_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    }
    const hlZone = highlight?.kind === "zone" ? highlight.index : -1;
    if (layers.zones || hlZone >= 0) {
      map.zones.forEach((z, i) => {
        if (!layers.zones && i !== hlZone) return;
        const hl = i === hlZone, dim = hlZone >= 0 && !hl;
        const y = z.z1 * 16;
        poly([pt(z.x1, z.y1, y), pt(z.x2, z.y1, y), pt(z.x2, z.y2, y), pt(z.x1, z.y2, y)]);
        ctx.globalAlpha = hl ? 0.35 : dim ? 0.05 : 0.12;
        ctx.fillStyle = ZONE_COLOR;
        ctx.fill();
        ctx.globalAlpha = dim ? 0.35 : hl ? 1 : 0.85;
        ctx.strokeStyle = hl ? HIGHLIGHT_COLOR : ZONE_COLOR;
        ctx.lineWidth = hl ? 3 : 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      map.zones.forEach((z, i) => {
        if ((!layers.zones && i !== hlZone) || (hlZone >= 0 && i !== hlZone)) return;
        const [cx, cy] = pt((z.x1 + z.x2) >> 1, (z.y1 + z.y2) >> 1, z.z1 * 16);
        drawLabel(ctx, z.id.toString(16).toUpperCase().padStart(4, "0"), cx, cy, i === hlZone ? HIGHLIGHT_COLOR : ZONE_COLOR);
      });
    }
    const hlPath = highlight?.kind === "path" ? highlight.index : -1;
    if (layers.paths || hlPath >= 0) {
      map.paths.forEach((path, i) => {
        if (!layers.paths && i !== hlPath) return;
        const hl = i === hlPath, dim = hlPath >= 0 && !hl;
        const color = hl ? HIGHLIGHT_COLOR : pathColor(i);
        ctx.strokeStyle = ctx.fillStyle = color;
        ctx.lineWidth = hl ? 3 : 1.5;
        ctx.globalAlpha = dim ? 0.3 : 0.9;
        ctx.beginPath();
        path.nodes.forEach((n, j) => {
          const [x, y] = pt(n.x, n.y);
          j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        path.nodes.forEach((n, j) => {
          const [x, y] = pt(n.x, n.y);
          ctx.beginPath();
          ctx.arc(x, y, hl ? 4 : 2.5, 0, Math.PI * 2);
          ctx.fill();
          if (hl && highlight?.kind === "path" && highlight.node === j) {
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 9, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
        ctx.globalAlpha = 1;
        if (path.nodes[0] && !dim) {
          const [x, y] = pt(path.nodes[0].x, path.nodes[0].y);
          drawLabel(ctx, `Path ${i}`, x, y - 12, color);
        }
      });
    }
  }, [map, width, height, scale, layers.zones, layers.paths, layers.navIslands, JSON.stringify(highlight)]);

  return <canvas ref={ref} class="collision-overlay" width={width * scale} height={height * scale} style={{ opacity: highlight ? 1 : opacity }} />;
};

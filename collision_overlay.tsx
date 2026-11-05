// タイルマップの上に当たり判定マップを重ねる canvas
// 各タイルの上面を projectToTilemap でタイルマップのピクセル座標に投影し (平らなタイルは菱形、階段は傾いた四角形)、色を付けて半透明で描く

import { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { type CollisionMap, type CollisionTile, projectToTilemap, tileQuad } from "./collision.ts";

export type OverlayMode = "height" | "attr" | "outline";

const TATTR_WALL = 1 << 1;

// 重ね描きの色 (絵の上に重ねるので彩度を落とす). Collision タブの上から見た図も同じ色を使う
// 属性: 壁は落ち着いた赤, ほかの値は値ごとの色相. 高さ: 青の 1 色で、高いほど明るい
export const attrOverlayColor = (attr: number) => (attr & TATTR_WALL ? "hsl(0 55% 52%)" : `hsl(${(attr * 137.5) % 360} 40% 55%)`);
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

const fillColor = (t: CollisionTile, mode: OverlayMode): string | null => {
  switch (mode) {
    case "height":
      return heightOverlayColor(t.height);
    case "attr":
      return t.attr === 0 ? null : attrOverlayColor(t.attr);
    case "outline":
      return null;
  }
};

// width, height はタイルマップのピクセル数
// 全タイルに枠を引くと絵の上に細かい格子がかぶって見づらいので、塗り分ける値が隣と違う辺 (領域の境目) にだけ、暗い半透明の細い線を引く
// 「枠だけ」のときは全タイルの枠を薄く引く
export const CollisionOverlay: FunctionComponent<{ map: CollisionMap; width: number; height: number; scale: number; mode: OverlayMode; opacity: number }> = ({ map, width, height, scale, mode, opacity }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width * scale, height * scale);
    ctx.lineWidth = 1;
    const tileAt = (x: number, z: number) => (x < 0 || z < 0 || x >= map.width || z >= map.height ? undefined : map.tiles[z * map.width + x]);
    // 奥 (x + z が小さい) から手前へ描く
    const order: [number, number][] = [];
    for (let z = 0; z < map.height; z++) for (let x = 0; x < map.width; x++) order.push([x, z]);
    order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    for (const [x, z] of order) {
      const t = map.tiles[z * map.width + x];
      const q = tileQuad(map, x, z).map(([px, py]) => [px * scale, py * scale] as [number, number]);
      const fill = fillColor(t, mode);
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

export type WorldLayers = { zones: boolean; paths: boolean; navMesh: boolean };

// 一覧の行にマウスを乗せているゾーン・経路 (絵の上で強調する). node は経路の点
// rect, portal は NavMesh の島 island の中の番号
export type WorldHighlight =
  | { kind: "zone"; index: number }
  | { kind: "path"; index: number; node?: number }
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

// ゾーン・経路・ナビメッシュをタイルマップの上に投影して描く (Collision タブでは上から見た図で描いているもの)
// ゾーンは底の高さ z1 (1 段 = 16) の面、経路の点とナビメッシュはその位置の地面の高さに置く
// 線は細く、塗りは薄く、文字は札に入れる. 経路の札は始点にだけ付ける (点ごとの番号は Collision タブの表で見る)
// highlight があれば、その要素を太い線と濃い塗りで描き、同じ種類のほかの要素は薄くする. 重ねる設定がオフでも強調する要素は描く
export const WorldOverlay: FunctionComponent<{ map: CollisionMap; width: number; height: number; scale: number; layers: WorldLayers; highlight?: WorldHighlight }> = ({ map, width, height, scale, layers, highlight = null }) => {
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
    // NavMesh: 強調しているときは、強調する要素とそれにつながる要素だけを白で描き、ほかは薄くする
    const nav = navHighlight(map, highlight);
    if ((layers.navMesh || nav) && map.navMesh) {
      map.navMesh.forEach((island, ii) => {
        island.rects.forEach((r, ri) => {
          const on = nav?.island === ii && nav.rects.has(ri);
          if (!layers.navMesh && !on) return;
          const y = groundY(map, r.minX << 8, r.minY << 8);
          poly([pt(r.minX << 8, r.minY << 8, y), pt(r.maxX << 8, r.minY << 8, y), pt(r.maxX << 8, r.maxY << 8, y), pt(r.minX << 8, r.maxY << 8, y)]);
          if (on && nav.main === "rect") {
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = NAV_COLOR;
            ctx.fill();
          }
          ctx.globalAlpha = nav && !on ? 0.25 : on ? 1 : 0.6;
          ctx.strokeStyle = on ? HIGHLIGHT_COLOR : NAV_COLOR;
          ctx.lineWidth = on && nav.main === "rect" ? 2.5 : 1;
          ctx.setLineDash(on && nav.main === "rect" ? [] : [3, 3]);
          ctx.stroke();
        });
        ctx.setLineDash([]);
        island.portals.forEach((p, pi) => {
          const on = nav?.island === ii && nav.portals.has(pi);
          if (!layers.navMesh && !on) return;
          const [x, y] = pt(p.x, p.y);
          ctx.globalAlpha = nav && !on ? 0.3 : 0.95;
          ctx.fillStyle = on ? HIGHLIGHT_COLOR : NAV_COLOR;
          const r = on ? 3.5 : 2;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
          if (on && nav.main === "portal") {
            ctx.strokeStyle = HIGHLIGHT_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 9, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      });
      ctx.globalAlpha = 1;
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
  }, [map, width, height, scale, layers.zones, layers.paths, layers.navMesh, JSON.stringify(highlight)]);

  return <canvas ref={ref} class="collision-overlay" width={width * scale} height={height * scale} />;
};

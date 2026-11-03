// タイルマップの上に当たり判定マップを重ねる canvas
// 各タイルの上面を projectToTilemap でタイルマップのピクセル座標に投影し (平らなタイルは菱形、階段は傾いた四角形)、色を付けて半透明で描く

import { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { type CollisionMap, type CollisionTile, tileQuad } from "./collision.ts";

export type OverlayMode = "height" | "attr" | "outline";

const TATTR_WALL = 1 << 1;

const fillColor = (t: CollisionTile, mode: OverlayMode): string | null => {
  switch (mode) {
    case "height":
      return `hsl(${(t.height * 23) % 360} 80% 55%)`;
    case "attr":
      if (t.attr === 0) return null;
      return t.attr & TATTR_WALL ? "hsl(0 85% 55%)" : `hsl(${(t.attr * 137.5) % 360} 70% 55%)`;
    case "outline":
      return null;
  }
};

// width, height はタイルマップのピクセル数
export const CollisionOverlay: FunctionComponent<{ map: CollisionMap; width: number; height: number; scale: number; mode: OverlayMode; opacity: number }> = ({ map, width, height, scale, mode, opacity }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width * scale, height * scale);
    ctx.lineWidth = 1;
    // 奥 (x + z が小さい) から手前へ描く
    const order: [number, number][] = [];
    for (let z = 0; z < map.height; z++) for (let x = 0; x < map.width; x++) order.push([x, z]);
    order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    for (const [x, z] of order) {
      const t = map.tiles[z * map.width + x];
      const q = tileQuad(map, x, z);
      ctx.beginPath();
      q.forEach(([px, py], k) => (k === 0 ? ctx.moveTo(px * scale, py * scale) : ctx.lineTo(px * scale, py * scale)));
      ctx.closePath();
      const fill = fillColor(t, mode);
      if (fill) {
        ctx.globalAlpha = opacity;
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.globalAlpha = Math.min(1, opacity + 0.3);
      ctx.strokeStyle = "rgb(255 255 255 / 0.8)";
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
    ctx.strokeStyle = "rgb(255 0 0 / 0.6)";
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

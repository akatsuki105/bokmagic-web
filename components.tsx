// MainSprite と AuxSprite のビューワで共通に使う部品

import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import type { ObjPltt } from "./objpltt.ts";
import type { Rendered } from "./render.ts";
import { BGP_NAMES, SPRITE_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import type { BgPlttFile } from "./bgpltt.ts";
import { GRAYSCALE_PLTT } from "./render.ts";

export const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;

// withDesc が false なら定数名まで
export const spriteLabel = (id: number, withDesc = true) => {
  const name = decomp(SPRITE_NAMES)[id];
  if (!name) return hex4(id);
  return withDesc ? `${hex4(id)} ${name[0]} ${name[1]}` : `${hex4(id)} ${name[0]}`;
};

// 見出しの下に出す説明 (decomp の定数のコメント), 無ければ何も出さない
export const Desc: FunctionComponent<{ text?: string }> = ({ text }) => (text ? <p>{text}</p> : null);

// 詳細の表 (本文の一番下に置く), [項目名, 値] の並び
export const InfoTable: FunctionComponent<{ rows: [string, ComponentChildren][] }> = ({ rows }) => (
  <table class="pltt-table info-table">
    <tbody>
      {rows.map(([k, v]) => (
        <tr key={k}>
          <th>{k}</th>
          <td>{v}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const spriteDesc = (id: number) => decomp(SPRITE_NAMES)[id]?.[1];
export const bgpDesc = (id: number) => decomp(BGP_NAMES)[id]?.[1];

// BG パレットのファイル, withDesc が false なら定数名まで
export const bgpLabel = (id: number, withDesc = true) => {
  const name = decomp(BGP_NAMES)[id];
  if (!name) return hex4(id);
  return withDesc && name[1] ? `${hex4(id)} ${name[0]} ${name[1]}` : `${hex4(id)} ${name[0]}`;
};

export const flagNames = (v: number, names: [number, string][]) => names.filter(([bit]) => v & bit).map(([, n]) => n).join("|") || "0";

export const GBA_FPS = 16777216 / 280896; // 約 59.73

// enabled の間、GBA のフレームレートで onFrame を呼ぶ, 1回の描画で進めたフレームがあれば onDraw を呼ぶ
export const useFrameLoop = (enabled: boolean, onFrame: () => void, onDraw: () => void) => {
  const cb = useRef({ onFrame, onDraw });
  cb.current = { onFrame, onDraw };

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      acc += now - last;
      last = now;
      // タブが裏にあった後などで溜まりすぎたら捨てる
      if (acc > 250) acc = 1000 / GBA_FPS;
      let advanced = false;
      while (acc >= 1000 / GBA_FPS) {
        acc -= 1000 / GBA_FPS;
        cb.current.onFrame();
        advanced = true;
      }
      if (advanced) cb.current.onDraw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
};

// origin が true なら原点に十字を描く, grid を渡すとその間隔 (画像のピクセル単位, [横, 縦] でも可) で格子を重ねる
// onHover には画像のピクセル単位の座標を渡す (外に出たら -1, -1)
export const SpriteCanvas: FunctionComponent<{ rendered: Rendered; scale: number; origin?: boolean; grid?: number | [number, number]; onHover?: (x: number, y: number) => void }> = ({ rendered, scale, origin, grid, onHover }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const { image } = rendered;

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    ctx?.putImageData(image, 0, 0);
  }, [image]);

  const hover = onHover && ((e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onHover(Math.floor((e.clientX - r.left) / scale), Math.floor((e.clientY - r.top) / scale));
  });

  return (
    <div class="canvas-wrap" style={{ width: image.width * scale, height: image.height * scale }} onMouseMove={hover} onMouseLeave={onHover && (() => onHover(-1, -1))}>
      <canvas ref={ref} width={image.width} height={image.height} style={{ width: image.width * scale, height: image.height * scale }} />
      {grid && <div class="grid-overlay" style={{ backgroundSize: typeof grid === "number" ? `${grid * scale}px ${grid * scale}px` : `${grid[0] * scale}px ${grid[1] * scale}px` }} />}
      {origin && <div class="origin-x" style={{ top: rendered.originY * scale }} />}
      {origin && <div class="origin-y" style={{ left: rendered.originX * scale }} />}
    </div>
  );
};

export const cssColor = (c: number) => `rgb(${c & 0xFF} ${(c >> 8) & 0xFF} ${(c >> 16) & 0xFF})`;
const hexRGB = (c: number) => "#" + [c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF].map((v) => v.toString(16).toUpperCase().padStart(2, "0")).join("");

// 16色を色見本で横に並べる, colors は RGBA8888 で start から16色
export const Swatches: FunctionComponent<{ colors: Uint32Array; start: number }> = ({ colors, start }) => (
  <>
    {Array.from({ length: 16 }, (_, i) => <span key={i} class="swatch" style={{ background: cssColor(colors[start + i]) }} />)}
  </>
);

export const PaletteRow: FunctionComponent<{ pltt: ObjPltt; plttID: number }> = ({ pltt, plttID }) => (
  <div class="pltt-row">
    <span>{plttID}</span>
    <Swatches colors={pltt.colors} start={plttID * 16} />
  </div>
);

// 16色の値の表, raw は rgb555, colors は raw を RGBA8888 にしたもので、どちらも start から16色
// note0 は色0 に添える注記 (OBJ と BG で色0 の扱いが違うので)
export const ColorTable: FunctionComponent<{ raw: Uint16Array; colors: Uint32Array; start: number; note0?: string }> = ({ raw, colors, start, note0 }) => (
  <table class="pltt-table">
    <thead>
      <tr>
        <th>#</th>
        <th></th>
        <th>rgb555</th>
        <th>rgb888</th>
        <th>r, g, b (5bit)</th>
      </tr>
    </thead>
    <tbody>
      {Array.from({ length: 16 }, (_, i) => {
        const v = raw[start + i];
        const c = colors[start + i];
        return (
          <tr key={i}>
            <td>{i}</td>
            <td>
              <span class="swatch large" style={{ background: cssColor(c) }} />
            </td>
            <td>
              {hex4(v)}
              {v & 0x8000 ? " (bit15)" : ""}
            </td>
            <td>{hexRGB(c)}</td>
            <td>
              {v & 0x1F}, {(v >> 5) & 0x1F}, {(v >> 10) & 0x1F}
              {i === 0 && note0 && ` (${note0})`}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

// 数値の入力欄と、1ずつ前後させるボタン
export const NumberStepper: FunctionComponent<{ label: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({ label, value, min, max, onChange }) => {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <span class="stepper">
      <label>
        {label} <input type="number" min={min} max={max} value={value} onInput={(e) => set(Number(e.currentTarget.value))} />
      </label>
      <button type="button" onClick={() => set(value - 1)}>◀</button>
      <button type="button" onClick={() => set(value + 1)}>▶</button>
    </span>
  );
};

// plttID の入力欄, reset で既定値に戻す
export const PlttControl: FunctionComponent<{ value: number; defaultValue: number; pltt: ObjPltt; onChange: (v: number) => void }> = ({ value, defaultValue, pltt, onChange }) => (
  <span class="stepper">
    <NumberStepper label="plttID" value={value} min={0} max={pltt.length - 1} onChange={onChange} />
    <button type="button" onClick={() => onChange(defaultValue)}>reset</button>
  </span>
);

// ポーズのサムネイル一覧, render は親で useCallback などして中身が変わったときだけ作り直すこと
export const PoseGrid: FunctionComponent<{ count: number; selected: number; onSelect: (i: number) => void; render: (i: number) => Rendered }> = ({ count, selected, onSelect, render }) => (
  <div class="thumbs">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} class={i === selected ? "thumb selected" : "thumb"} onClick={() => onSelect(i)} title={`pose ${i}`}>
        <PoseThumb poseIdx={i} render={render} />
        <span>{i}</span>
      </div>
    ))}
  </div>
);

const PoseThumb: FunctionComponent<{ poseIdx: number; render: (i: number) => Rendered }> = ({ poseIdx, render }) => {
  const rendered = useMemo(() => render(poseIdx), [render, poseIdx]);
  const { width, height } = rendered.image;
  return <SpriteCanvas rendered={rendered} scale={Math.min(1, 64 / Math.max(width, height))} />;
};

// BG の4bppタイルに当てるパレットの選択, file が null ならグレースケール
export type BgPlttChoice = { file: number | null; row: number };

// BgPlttChoice の16色 (RGBA8888)
export const bgPlttColors = (files: BgPlttFile[], choice: BgPlttChoice): Uint32Array => {
  const f = files.find((f) => f.id === choice.file);
  return f ? f.colors.subarray(choice.row * 16, choice.row * 16 + 16) : GRAYSCALE_PLTT;
};

export const BgPlttSelect: FunctionComponent<{ files: BgPlttFile[]; value: BgPlttChoice; onChange: (v: BgPlttChoice) => void; rowSelectable?: boolean }> = ({ files, value, onChange, rowSelectable = true }) => (
  <span class="stepper">
    <label>
      BG palette{" "}
      <select value={value.file ?? ""} onChange={(e) => onChange({ ...value, file: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}>
        <option value="">(grayscale)</option>
        {files.map((f) => <option key={f.id} value={f.id}>{bgpLabel(f.id, false)}</option>)}
      </select>
    </label>
    {rowSelectable && value.file !== null && <NumberStepper label="palette" value={value.row} min={0} max={15} onChange={(row) => onChange({ ...value, row })} />}
    {rowSelectable && <Swatches colors={bgPlttColors(files, value)} start={0} />}
  </span>
);

// URL の #tab/0xXXXX の 0xXXXX, 無ければ undefined
export const hashID = (tab: string): number | undefined => {
  const m = location.hash.match(/^#(\w+)\/(0x[0-9A-Fa-f]+)$/);
  return m && m[1] === tab ? parseInt(m[2], 16) : undefined;
};

// #tab/0xXXXX が変わったら onChange を呼ぶ
export const useHashID = (tab: string, onChange: (id: number) => void) => {
  useEffect(() => {
    const onHash = () => {
      const id = hashID(tab);
      if (id !== undefined) onChange(id);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [tab]);
};

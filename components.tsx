// MainSprite と AuxSprite のビューワで共通に使う部品

import { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import type { ObjPltt } from "./objpltt.ts";
import type { Rendered } from "./render.ts";
import { SPRITE_NAMES } from "./sprite_names.ts";

export const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;

// withDesc が false なら定数名まで
export const spriteLabel = (id: number, withDesc = true) => {
  const name = SPRITE_NAMES[id];
  if (!name) return hex4(id);
  return withDesc ? `${hex4(id)} ${name[0]} ${name[1]}` : `${hex4(id)} ${name[0]}`;
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

// origin が true なら原点に十字を描く
export const SpriteCanvas: FunctionComponent<{ rendered: Rendered; scale: number; origin?: boolean }> = ({ rendered, scale, origin }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const { image } = rendered;

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    ctx?.putImageData(image, 0, 0);
  }, [image]);

  return (
    <div class="canvas-wrap" style={{ width: image.width * scale, height: image.height * scale }}>
      <canvas ref={ref} width={image.width} height={image.height} style={{ width: image.width * scale, height: image.height * scale }} />
      {origin && <div class="origin-x" style={{ top: rendered.originY * scale }} />}
      {origin && <div class="origin-y" style={{ left: rendered.originX * scale }} />}
    </div>
  );
};

export const PaletteRow: FunctionComponent<{ pltt: ObjPltt; plttID: number }> = ({ pltt, plttID }) => {
  const colors = [...pltt.colors.subarray(plttID * 16, plttID * 16 + 16)];
  return (
    <div class="pltt-row">
      <span>{plttID}</span>
      {colors.map((c, i) => <span key={i} class="swatch" style={{ background: `rgb(${c & 0xFF} ${(c >> 8) & 0xFF} ${(c >> 16) & 0xFF})` }} />)}
    </div>
  );
};

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

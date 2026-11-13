// 各タブのビューワで共通に使う部品

import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ObjPltt } from "./objpltt.ts";
import type { Rendered } from "./render.ts";
import { BGP_NAMES, SPRITE_NAMES, STAGE_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import type { BgPlttFile } from "./bgpltt.ts";
import { GRAYSCALE_PLTT } from "./render.ts";

export const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;

// 一覧と見出しでの ID と名前の出し方
// 名前に ID の 16 進 4 桁が入っている (TILEMAP_7DB3, BGP_07E7 など) なら名前だけ, そうでなければ "ID 名前". 名前が無ければ ID
// withDesc なら説明 (decomp の定数のコメント) も続ける
export const idLabel = (id: number, entry: [name: string, desc: string] | undefined, withDesc = false) => {
  if (!entry) return hex4(id);
  const [name, desc] = entry;
  const head = name.toUpperCase().includes(hex4(id).slice(2)) ? name : `${hex4(id)} ${name}`;
  return withDesc && desc ? `${head} ${desc}` : head;
};

// カードの中での名前: 名前だけ (無ければ ID). ID はツールチップで出す (NameRef)
export const NameRef: FunctionComponent<{ id: number; name: string | undefined; href?: string }> = ({ id, name, href }) => href ? <a href={href} title={hex4(id)}>{name ?? hex4(id)}</a> : <span title={hex4(id)}>{name ?? hex4(id)}</span>;

// withDesc が false なら定数名まで
export const spriteLabel = (id: number, withDesc = true) => idLabel(id, decomp(SPRITE_NAMES)[id], withDesc);

// 見出しの下に出す説明 (decomp の定数のコメント), 無ければ何も出さない
export const Desc: FunctionComponent<{ text?: string }> = ({ text }) => (text ? <p class="desc">{text}</p> : null);

// 本文の作り (全タブ共通). 上に見出し、左に絵やコードなどの本体 (stage)、右に見出し付きのカード (children) を縦に並べる
// 左右はそれぞれスクロールする. 画面幅が 900px より狭いときは本体 → カードの順に縦に並べる (index.html の .split-*)
// narrow: 右の欄を細くする (本体が横に長いコードのとき)
export const AssetView: FunctionComponent<{ title: ComponentChildren; desc?: string; stage: ComponentChildren; narrow?: boolean }> = ({ title, desc, stage, narrow, children }) => (
  <div class="sprite-view split-view">
    <h2>{title}</h2>
    <div class="split">
      <div class="split-canvas">{stage}</div>
      <div class={narrow ? "split-side narrow" : "split-side"}>
        <Desc text={desc} />
        {children}
      </div>
    </div>
  </div>
);

// 右の欄のまとまり 1 つ (表示の操作, アニメ, 情報 など). tip は補足 (見出しの横の ? にマウスを乗せると出る)
// 見出しを押すと折り畳む (既定は開く). 閉じた状態はタブと見出しごとに localStorage に保存し、別のものを開いても読み直しても保つ
// 見出しの後ろの件数や番号 ("Zones (8)" の "(8)", "ポーズ 3" の "3") は除いて見分ける
export const Card: FunctionComponent<{ title?: string; tip?: string }> = ({ title, tip, children }) => {
  const tab = location.hash.slice(1).split("/")[0] || "main";
  const [collapsed, setCollapsed] = usePersistentState(`card.${tab}.${(title ?? "").replace(/\s*\(.*\)$/, "").replace(/\s+\d+$/, "")}`, false);
  return (
    <section class={collapsed ? "card collapsed" : "card"}>
      {title && (
        <h3 onClick={() => setCollapsed((c) => !c)} title={collapsed ? "押すと開く" : "押すと閉じる"}>
          <span class="card-chevron">{collapsed ? "▸" : "▾"}</span>
          {title}
          {tip && <Tip text={tip} />}
        </h3>
      )}
      {children}
    </section>
  );
};

// 補足のツールチップ. 本文には出さず、? にマウスを乗せると出す
export const Tip: FunctionComponent<{ text: string }> = ({ text }) => <span class="tip" title={text} onClick={(e) => e.stopPropagation()}>?</span>;

// マウスの下にあるものの情報. rows が null なら案内を出す
// minRows 行分の高さを取っておき、マウスを動かしても下のカードが上下に動かないようにする
export const CursorCard: FunctionComponent<{ rows: InfoRow[] | null; minRows?: number }> = ({ rows, minRows = 2 }) => (
  <Card title="カーソル">
    <div class="cursor-body" style={{ minHeight: `${minRows * 1.9}em` }}>
      {rows && rows.length > 0 ? <InfoTable rows={rows} /> : <p class="note">絵の上にマウスを乗せると、ここに出ます</p>}
    </div>
  </Card>
);

// リンクなどを 1 行に 1 つずつ並べる (情報の表の値が長くなるとき)
export const LinkList: FunctionComponent = ({ children }) => <div class="link-list">{children}</div>;

// ---- Used by: そのアセットを使っているもの (Map, Script, スプライト, ソースの行など). 全タブで同じ形 (種類 | リンク | 補足) で出す ----
export type UseRef = { key: string; kind: string; link: ComponentChildren; detail?: ComponentChildren; title?: string };

export const UsedByCard: FunctionComponent<{ refs: UseRef[]; tip: string; empty: string }> = ({ refs, tip, empty }) => (
  <Card title={refs.length > 0 ? `Used by (${refs.length})` : "Used by"} tip={tip}>
    {refs.length > 0
      ? (
        <div class="ref-list">
          {refs.map((r) => (
            <div key={r.key} class="ref-item" title={r.title}>
              <span class="ref-kind">{r.kind}</span>
              <span class="ref-link">{r.link}</span>
              {r.detail && <span class="ref-detail">{r.detail}</span>}
            </div>
          ))}
        </div>
      )
      : <p class="note">{empty}</p>}
  </Card>
);

// ステージの短い名前 (include/constants/map.h のコメントの最初の部分, 名前が無ければ番号)
export const stageShort = (stage: number | null) => {
  if (stage === null) return "";
  const name = decomp(STAGE_NAMES)[stage];
  return name ? name[1].split(/ \(|, /)[0] : `ST ${stage}`;
};

// Map へのリンク ("0x02BF 6番街")
export const MapLink: FunctionComponent<{ root: number; stage: number | null }> = ({ root, stage }) => <a href={`#map/${hex4(root - 1)}`}>{`${hex4(root - 1)} ${stageShort(stage)}`.trim()}</a>;

// 本体の欄の中の見出し (ポーズ一覧 など)
export const StageTitle: FunctionComponent<{ tip?: string }> = ({ tip, children }) => (
  <h3 class="stage-title">
    {children}
    {tip && <Tip text={tip} />}
  </h3>
);

// 詳細の表 (本文の一番下に置く), [項目名, 値] の並び
// 1 行は [項目名, 値] か [項目名, 値, 説明]. 項目名はデータの欄名 (英語のまま)
// 説明は補足なので本文に出さず、項目名にマウスを乗せると出す (点線の下線で説明があることを示す). 単位は値の中に書く
export type InfoRow = [string, ComponentChildren] | [string, ComponentChildren, string];
export const InfoTable: FunctionComponent<{ rows: InfoRow[] }> = ({ rows }) => (
  <table class="info-table">
    <tbody>
      {rows.map(([k, v, note]) => (
        <tr key={k}>
          <th class={note ? "has-tip" : undefined} title={typeof note === "string" ? note : undefined}>{k}</th>
          <td>{v}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const spriteDesc = (id: number) => decomp(SPRITE_NAMES)[id]?.[1];
export const bgpDesc = (id: number) => decomp(BGP_NAMES)[id]?.[1];

// BG パレットのファイル, withDesc が false なら定数名まで
export const bgpLabel = (id: number, withDesc = true) => idLabel(id, decomp(BGP_NAMES)[id], withDesc);
export const bgpName = (id: number) => decomp(BGP_NAMES)[id]?.[0];

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
    if (ctx && image.width > 0 && image.height > 0) ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
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
  <div class="pltt-row" title={`plttID ${plttID}`}>
    <span>{plttID}</span>
    <Swatches colors={pltt.colors} start={plttID * 16} />
  </div>
);

// 16色の値の表, raw は rgb555, colors は raw を RGBA8888 にしたもので、どちらも start から16色
// note0 は色0 に添える注記 (OBJ と BG で色0 の扱いが違うので)
export const ColorTable: FunctionComponent<{ raw: Uint16Array; colors: Uint32Array; start: number; note0?: string }> = ({ raw, colors, start, note0 }) => (
  <>
    <table class="pltt-table striped color-table">
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
              <td class={i === 0 && note0 ? "has-tip" : undefined} title={i === 0 ? note0 : undefined}>{i}</td>
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
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </>
);

// 数値の入力欄と、1ずつ前後させるボタン
// label は Field の外で使うときだけ (Field の中ではラベルを Field が出す)
export const NumberStepper: FunctionComponent<{ label?: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({ label, value, min, max, onChange }) => {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <span class="stepper">
      {label && <span>{label}</span>}
      <input type="number" min={min} max={max} value={value} onInput={(e) => set(Number(e.currentTarget.value))} />
      <span class="button-group">
        <button type="button" title="1 つ前" onClick={() => set(value - 1)}>◀</button>
        <button type="button" title="1 つ後" onClick={() => set(value + 1)}>▶</button>
      </span>
    </span>
  );
};

// 範囲の決まった数値のスライダー. 横に今の値を出す (format で書式を変える). stepButtons で 1 つずつ動かす ◀ ▶ も付ける
export const Slider: FunctionComponent<{ value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; stepButtons?: boolean }> = ({ value, min, max, step = 1, onChange, format, stepButtons }) => {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <span class="slider">
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => set(Number(e.currentTarget.value))} />
      <span class="slider-value">{format ? format(value) : value}</span>
      {stepButtons && (
        <span class="button-group">
          <button type="button" title="1 つ前" disabled={value <= min} onClick={() => set(value - step)}>◀</button>
          <button type="button" title="1 つ後" disabled={value >= max} onClick={() => set(value + step)}>▶</button>
        </span>
      )}
    </span>
  );
};

// localStorage に保存する状態 (別のものを開いても、読み直しても前の値のまま). key は "bokmagic-web." の後ろ
// 保存できない・読めないとき (プライベートブラウズなど) は、その画面の中だけで覚える. 保存した値の形が違えば既定値を使う
// 更新は値か、直前の値から作る関数 (続けて変えても前の変更を落とさない)
export const usePersistentState = <T,>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] => {
  const fullKey = `bokmagic-web.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const s = localStorage.getItem(fullKey);
      if (s === null) return initial;
      const v = JSON.parse(s);
      return typeof v === typeof initial ? v as T : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T | ((prev: T) => T)) =>
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (prev: T) => T)(prev) : v;
      try {
        localStorage.setItem(fullKey, JSON.stringify(next));
      } catch {
        // 保存できなくても今の画面では効く
      }
      return next;
    });
  return [value, set];
};

// ---- カードの中の部品 ----
// カードの中は「左にラベル、右に部品」の行を縦に並べる (Fields の中に Field を置く). ラベルの列は Fields ごとにそろう
export const Fields: FunctionComponent = ({ children }) => <div class="fields">{children}</div>;

export const Field: FunctionComponent<{ label: ComponentChildren; title?: string }> = ({ label, title, children }) => (
  <>
    <span class={title ? "field-label has-tip" : "field-label"} title={title}>{label}</span>
    <div class="field-value">{children}</div>
  </>
);

// どれか 1 つを選ぶ切り替え (つながったボタン). ラジオボタンの代わり
export function Segmented<T extends string | number>({ options, value, onChange }: { options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <span class="button-group segmented">
      {options.map(([v, label]) => (
        <button type="button" key={String(v)} class={v === value ? "selected" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </span>
  );
}

// チェックボックス 1 つ
export const Check: FunctionComponent<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }> = ({ checked, onChange, disabled, title, children }) => (
  <label class="check" title={title}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
    {children}
  </label>
);

// アニメのコマンド列. 各コマンドを長さ (フレーム数) に比例した幅で横に並べ、今のコマンドを強調する. onSelect があれば押したコマンドへ飛ぶ
export const AnimTimeline: FunctionComponent<{ items: { label: string; duration: number; title?: string }[]; current: number; onSelect?: (i: number) => void }> = ({ items, current, onSelect }) => (
  <div class="anim-timeline">
    {items.map((it, i) => (
      <span
        key={i}
        class={i === current ? "anim-step current" : "anim-step"}
        style={{ flexGrow: Math.max(1, it.duration) }}
        title={`コマンド ${i}: ${it.label}, ${it.duration}f${it.title ? `\n${it.title}` : ""}`}
        onClick={onSelect && (() => onSelect(i))}
      >
        <span class="anim-step-label">{it.label}</span>
        <span class="anim-step-dur">{it.duration}f</span>
      </span>
    ))}
  </div>
);

// 表示するものを選ぶ一覧 (BG, レイヤ など、それぞれに中身があるもの). 1 行に 1 つ、チェック・名前・補足を同じ形で並べる
// 短いオンオフの組 (反転, flags など) は Check を横に並べる
export type ToggleItem = { key: string | number; label: ComponentChildren; detail?: ComponentChildren; checked: boolean; onChange: (v: boolean) => void };
export const ToggleList: FunctionComponent<{ items: ToggleItem[] }> = ({ items }) => (
  <div class="toggle-list">
    {items.map((it) => (
      <label key={it.key} class="toggle-item">
        <input type="checkbox" checked={it.checked} onChange={(e) => it.onChange(e.currentTarget.checked)} />
        <span class="toggle-label">{it.label}</span>
        {it.detail && <span class="toggle-detail">{it.detail}</span>}
      </label>
    ))}
  </div>
);

// 操作ボタンの 1 行 (再生, SetAnim など)
export const ButtonRow: FunctionComponent = ({ children }) => <div class="button-row">{children}</div>;

// plttID の入力欄, reset で既定値に戻す
// plttID の数値の増減と、既定値に戻すボタン (Field の中で使う)
export const PlttControl: FunctionComponent<{ value: number; defaultValue: number; pltt: ObjPltt; onChange: (v: number) => void }> = ({ value, defaultValue, pltt, onChange }) => (
  <>
    <NumberStepper value={value} min={0} max={pltt.length - 1} onChange={onChange} />
    <button type="button" disabled={value === defaultValue} title={`既定の plttID (${defaultValue}) に戻す`} onClick={() => onChange(defaultValue)}>既定 ({defaultValue}) に戻す</button>
  </>
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

// BG パレットのファイルと行 (Fields の中で使う. 行を選べるときは「行」と「色」の Field も出す)
export const BgPlttSelect: FunctionComponent<{ files: BgPlttFile[]; value: BgPlttChoice; onChange: (v: BgPlttChoice) => void; rowSelectable?: boolean }> = ({ files, value, onChange, rowSelectable = true }) => (
  <>
    <Field label="BG パレット">
      <select class="wide" value={value.file ?? ""} onChange={(e) => onChange({ ...value, file: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}>
        <option value="">(灰色)</option>
        {files.map((f) => <option key={f.id} value={f.id} title={hex4(f.id)}>{bgpName(f.id) ?? hex4(f.id)}</option>)}
      </select>
    </Field>
    {rowSelectable && value.file !== null && (
      <Field label="行">
        <NumberStepper value={value.row} min={0} max={15} onChange={(row) => onChange({ ...value, row })} />
      </Field>
    )}
    {rowSelectable && (
      <Field label="色">
        <Swatches colors={bgPlttColors(files, value)} start={0} />
      </Field>
    )}
  </>
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

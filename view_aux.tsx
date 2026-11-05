// AuxSprite (DIR_AUX_SPRITE) のタブ, アニメは別ファイル (DIR_ANIMATION) から選ぶ

import { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ObjPltt } from "./objpltt.ts";
import type { ROMFile } from "./rom.ts";
import { auxPoseToObjs, type AuxSpriteGfx, parseAuxSprites } from "./sprite_aux.ts";
import { ANIM_PLAY_REVERSE, ANIM_PLAY_XFLIP, ANIM_PLAY_YFLIP, type AuxAnimFile, AuxAnimState, cmdDuration, cmdFlip, cmdPose, parseAuxAnimFiles } from "./anim_aux.ts";
import { OBJ_SIZE, renderObjs } from "./render.ts";
import { AUX_ANIM_REFS } from "./generated/aux_anims.ts";
import { ANIM_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import { AnimTimeline, AssetView, ButtonRow, Card, Check, Field, Fields, flagNames, hashID, hex4, InfoTable, PaletteRow, PlttControl, PoseGrid, Segmented, Slider, SpriteCanvas, spriteDesc, spriteLabel, StageTitle, useFrameLoop, useHashID } from "./components.tsx";

export const auxSpriteHref = (id: number) => `#aux/${hex4(id)}`;

export const AuxSpriteViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const sprites = useMemo(() => parseAuxSprites(rom.data, rom.fs), [rom]);
  const animFiles = useMemo(() => parseAuxAnimFiles(rom.data, rom.fs), [rom]);
  const byID = (id: number | undefined) => sprites.find((g) => g.id === id);
  const [selected, setSelected] = useState<AuxSpriteGfx>(byID(hashID("aux")) ?? sprites[0]);
  useHashID("aux", (id) => {
    const g = byID(id);
    if (g) setSelected(g);
  });

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {sprites.map((g) => (
          <li key={g.id} class={g === selected ? "selected" : ""}>
            <a href={auxSpriteHref(g.id)}>{spriteLabel(g.id, false)}</a>
          </li>
        ))}
      </ul>
      <AuxSpriteView key={selected.id} gfx={selected} pltt={rom.objPltt} animFiles={animFiles} />
    </div>
  );
};

const AuxSpriteView: FunctionComponent<{ gfx: AuxSpriteGfx; pltt: ObjPltt; animFiles: AuxAnimFile[] }> = ({ gfx, pltt, animFiles }) => {
  const [poseIdx, setPoseIdx] = useState(0);
  const [plttID, setPlttID] = useState(gfx.plttID);
  const [scale, setScale] = useState(3);
  const [xflip, setXflip] = useState(false);
  const [yflip, setYflip] = useState(false);
  const [animActive, setAnimActive] = useState(false); // アニメがポーズを動かしている

  const pose = gfx.poses[poseIdx];
  const rendered = useMemo(() => renderObjs(auxPoseToObjs(gfx, poseIdx, pltt.colors, plttID, xflip, yflip)), [gfx, poseIdx, plttID, xflip, yflip, pltt]);
  const renderThumb = useCallback((i: number) => renderObjs(auxPoseToObjs(gfx, i, pltt.colors, plttID)), [gfx, pltt, plttID]);

  // 手でポーズを選んだらアニメの表示はやめる
  const setPose = (i: number) => {
    setAnimActive(false);
    setPoseIdx(i);
  };

  return (
    <AssetView
      title={spriteLabel(gfx.id, false)}
      desc={spriteDesc(gfx.id)}
      stage={
        <>
          <SpriteCanvas rendered={rendered} scale={scale} origin />
          <div class="pltts">
            <PaletteRow pltt={pltt} plttID={plttID} />
          </div>
          <StageTitle tip={`次のエントリの先頭までの数 (ROM には無い推定値). ゲームはその後ろの ${gfx.poses.length - gfx.poseCount} 個も添字で引ける`}>ポーズ ({gfx.poseCount})</StageTitle>
          <PoseGrid count={gfx.poseCount} selected={poseIdx} onSelect={setPose} render={renderThumb} />
        </>
      }
    >
      <Card title="表示">
        <Fields>
          <Field label="ポーズ">
            <Slider value={poseIdx} min={0} max={gfx.poses.length - 1} onChange={setPose} format={(v) => `${v} / ${gfx.poseCount - 1}`} stepButtons />
          </Field>
          <Field label="パレット" title="plttID (OBJ パレットの番号)">
            <PlttControl value={plttID} defaultValue={gfx.plttID} pltt={pltt} onChange={setPlttID} />
          </Field>
          <Field label="拡大">
            <Slider value={scale} min={1} max={8} onChange={setScale} format={(v) => `${v}x`} />
          </Field>
          <Field label="反転">
            <Check checked={xflip} disabled={animActive} onChange={setXflip}>左右</Check>
            <Check checked={yflip} disabled={animActive} onChange={setYflip}>上下</Check>
          </Field>
        </Fields>
      </Card>
      <AuxAnimPanel
        refs={decomp(AUX_ANIM_REFS)[gfx.id] ?? []}
        poseCount={gfx.poseCount}
        poseLimit={gfx.poses.length}
        animFiles={animFiles}
        active={animActive}
        setActive={setAnimActive}
        onPose={(i, x, y) => {
          setPoseIdx(i);
          setXflip(x);
          setYflip(y);
        }}
      />
      {pose && (
        <Card title={`ポーズ ${poseIdx}${poseIdx >= gfx.poseCount ? " (後ろのエントリのもの)" : ""}`} tip="表はサブスプライト (OBJ 1 枚ずつ). タイルは先頭から順に詰めて使う. 位置は原点から">
          <InfoTable
            rows={[
              ["tiles", `${pose.tileCount} 枚`, `ファイル全体のタイルの ${pose.tileNum} 枚目から続けて使う`],
              ["plttID", pose.plttID, poseIdx === 0 ? "描画に使うのは最初のポーズのこの値" : "ゲームは描画に使わない (最初のポーズの値を使う)"],
            ]}
          />
          <table class="pltt-table striped sub-table">
            <thead>
              <tr>
                <th>OBJ</th>
                <th>大きさ</th>
                <th>位置 (px)</th>
              </tr>
            </thead>
            <tbody>
              {pose.subsprites.map((sub, i) => {
                const [w, h] = OBJ_SIZE[sub.shape] ?? [0, 0];
                return (
                  <tr key={i}>
                    <td>{i}</td>
                    <td>{w}x{h}</td>
                    <td>({sub.x}, {sub.y})</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <Card title="Metadata">
        <InfoTable
          rows={[
            ["box", `${gfx.pw}x${gfx.ph} px, 原点から (${gfx.px}, ${gfx.py})`, "画面外判定の矩形 (pw, ph, px, py). 表示には影響しない"],
            ["plttID", gfx.plttID, "パレットの既定値 (最初のポーズの値)"],
          ]}
        />
      </Card>
    </AssetView>
  );
};

const ANIM_PLAY_FLAG_NAMES: [number, string][] = [
  [ANIM_PLAY_XFLIP, "XFLIP"],
  [ANIM_PLAY_YFLIP, "YFLIP"],
  [ANIM_PLAY_REVERSE, "REVERSE"],
];

// poseCount: スプライト自身のポーズ数, poseLimit: 添字で引けるポーズ数 (AuxSprite は後ろのエントリのポーズも引ける)
const animFileLabel = (f: AuxAnimFile, poseCount: number, poseLimit: number) => {
  const name = decomp(ANIM_NAMES)[f.id]?.[0] ?? hex4(f.id);
  // ポーズ番号がこのエントリに収まるか, 後ろのエントリまで使うか, ポーズ配列からはみ出すか
  const fit = f.maxPose < poseCount ? "" : f.maxPose < poseLimit ? " +" : " !";
  return `${name}${name.endsWith(hex4(f.id).slice(2)) ? "" : ` (${hex4(f.id)})`}, max pose ${f.maxPose}${fit}`;
};

// アニメファイルを選んで AuxAnimState で再生する, 1フレームごとに AuxSprite_AdvanceAnim (particle なら Particle_AdvanceAnim) と同じ処理で進め、当たったポーズと反転を onPose で返す
// refs はソースで一緒に使われているアニメファイルの候補
export const AuxAnimPanel: FunctionComponent<{
  refs: [anim: number, where: string][];
  poseCount: number;
  poseLimit: number;
  particle?: boolean;
  animFiles: AuxAnimFile[];
  active: boolean;
  setActive: (v: boolean) => void;
  onPose: (poseIdx: number, xflip: boolean, yflip: boolean) => void;
}> = ({ refs, poseCount, poseLimit, particle = false, animFiles, active, setActive, onPose }) => {
  const refIDs = new Set(refs.map(([id]) => id));
  const [fileID, setFileID] = useState<number | null>(refs[0]?.[0] ?? null);
  const [animIdx, setAnimIdx] = useState(0);
  const [variant, setVariant] = useState(0);
  const [flags, setFlags] = useState(0);
  const [speed, setSpeed] = useState(0x40);
  const [playing, setPlaying] = useState(true);
  const state = useRef(new AuxAnimState());
  const frames = useRef(0); // SetAnim してから進めたフレーム数
  const loops = useRef(0); // AuxSprite_AdvanceAnim が TRUE (一巡) を返した回数
  const [, setVersion] = useState(0);

  const file = animFiles.find((f) => f.id === fileID);
  const s = state.current;

  const sync = () => {
    onPose(state.current.poseIdx, state.current.xflip, state.current.yflip);
    setVersion((v) => v + 1);
  };

  // AuxAnim_SetAnim (fresh なら AuxAnimState を作り直してから), 速度は SetAnim が等速に戻すのでその後に AuxAnim_SetAnimSpeed で当て直す
  const start = (f: AuxAnimFile, a: number, v: number, fl: number, fresh = false) => {
    if (fresh) state.current = new AuxAnimState();
    state.current.setAnim(f, a, v, fl);
    state.current.setAnimSpeed(speed);
    frames.current = 0;
    loops.current = 0;
    setActive(true);
    sync();
  };

  // 対応するアニメファイルが分かっていれば開いたときから再生する
  useEffect(() => {
    if (file) start(file, 0, 0, flags, true);
  }, []);

  const changeFile = (id: number | null) => {
    setFileID(id);
    setAnimIdx(0);
    setVariant(0);
    const f = animFiles.find((f) => f.id === id);
    if (f) start(f, 0, 0, flags, true);
    else setActive(false);
  };

  const changeAnim = (a: number) => {
    setAnimIdx(a);
    setVariant(0);
    if (file) start(file, a, 0, flags);
  };

  const changeVariant = (v: number) => {
    setVariant(v);
    if (file) start(file, animIdx, v, flags);
  };

  const changeFlags = (fl: number) => {
    setFlags(fl);
    if (file) start(file, animIdx, variant, fl);
  };

  const changeSpeed = (v: number) => {
    setSpeed(v);
    if (file && active) {
      s.setAnimSpeed(v);
      sync();
    }
  };

  const advance = () => {
    if (particle ? state.current.advanceParticle() : state.current.advance()) loops.current++;
    frames.current++;
  };

  useFrameLoop(playing && active && file !== undefined, advance, sync);

  const anim = file?.anims[animIdx];
  const cmds = anim?.variants[variant] ?? [];
  const sortedFiles = [...animFiles].sort((a, b) => a.id - b.id);

  return (
    <>
      <Card title="アニメ">
        <Fields>
          <Field label="アニメファイル">
            <select class="wide" value={fileID ?? ""} onChange={(e) => changeFile(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}>
              <option value="">(なし)</option>
              {refs.length > 0 && (
                <optgroup label="ソースで一緒に使われているもの">
                  {sortedFiles.filter((f) => refIDs.has(f.id)).map((f) => <option key={f.id} value={f.id}>{animFileLabel(f, poseCount, poseLimit)}</option>)}
                </optgroup>
              )}
              <optgroup label="その他">
                {sortedFiles.filter((f) => !refIDs.has(f.id)).map((f) => <option key={f.id} value={f.id}>{animFileLabel(f, poseCount, poseLimit)}</option>)}
              </optgroup>
            </select>
          </Field>
          {fileID !== null && refIDs.has(fileID) && (
            <Field label="使われ方">
              <span class="note mono">{refs.find(([id]) => id === fileID)![1]}</span>
            </Field>
          )}
          {file && (
            <>
              <Field label="アニメ">
                <select class="wide" value={animIdx} onChange={(e) => changeAnim(Number(e.currentTarget.value))}>
                  {file.anims.map((a, i) => (
                    <option key={i} value={i}>
                      {i}: {a.cmdCount} コマ, バリアント {a.variants.length} 個, {a.variants[0].reduce((t, c) => t + cmdDuration(c), 0)}f
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="バリアント" title="AuxAnim の variant">
                <Segmented options={(anim?.variants ?? []).map((_, i) => [i, String(i)] as const)} value={variant} onChange={changeVariant} />
              </Field>
              <Field label="フラグ" title="AuxAnim_SetAnim の flags">
                {ANIM_PLAY_FLAG_NAMES.map(([bit, n]) => (
                  <Check key={bit} checked={(flags & bit) !== 0} onChange={(on) => changeFlags(on ? flags | bit : flags & ~bit)}>
                    {n}
                  </Check>
                ))}
              </Field>
              <Field label="速度">
                <Slider value={speed} min={0} max={256} onChange={changeSpeed} format={(v) => `${v} (${(v / 64).toFixed(2)}x)`} />
              </Field>
            </>
          )}
        </Fields>
        {file && (
          <ButtonRow>
            <button type="button" disabled={!active} onClick={() => setPlaying(!playing)}>{playing ? "❚❚ 一時停止" : "▶ 再生"}</button>
            <button
              type="button"
              disabled={!active || playing}
              onClick={() => {
                advance();
                sync();
              }}
            >
              ▸| 1 フレーム
            </button>
            <button type="button" onClick={() => start(file, animIdx, variant, flags)} title="今の状態のまま AuxAnim_SetAnim を呼ぶ (同じアニメを同じ向きで再生中なら flags だけ変わる)">SetAnim</button>
            <button type="button" onClick={() => start(file, animIdx, variant, flags, true)} title="AuxAnimState を作り直してから AuxAnim_SetAnim する">最初から</button>
          </ButtonRow>
        )}
      </Card>
      {file && active && (
        <Card title="アニメの状態">
          <InfoTable
            rows={[
              ["frame", frames.current, "SetAnim してから進めたフレーム数"],
              ["cmd", `${s.cmdIdx} / ${s.cmdCount}`, "今のコマ / コマ数"],
              ["tick", `${s.tick} / ${s.wait}`, "今のコマで経ったフレーム / 速度を掛けた後のコマの長さ"],
              ["duration", s.duration, "コマの長さ (速度を掛ける前)"],
              ["speed", `${s.speed} (${(s.speed / 64).toFixed(2)}x)`],
              ["flags", flagNames(s.flags, ANIM_PLAY_FLAG_NAMES)],
              ["sprite", `pose ${s.poseIdx}${s.xflip ? ", 左右反転" : ""}${s.yflip ? ", 上下反転" : ""}`],
              ["loops", loops.current, "一巡した回数"],
            ]}
          />
          <AnimTimeline
            items={cmds.map((c) => ({ label: `pose ${cmdPose(c)}${cmdFlip(c) ? ` ${flagNames(cmdFlip(c), ANIM_PLAY_FLAG_NAMES)}` : ""}`, duration: cmdDuration(c) }))}
            current={s.cmdIdx}
          />
        </Card>
      )}
    </>
  );
};

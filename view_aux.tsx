// AuxSprite (DIR_AUX_SPRITE) のタブ, アニメは別ファイル (DIR_ANIMATION) から選ぶ

import { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ObjPltt } from "./pltt.ts";
import type { ROMFile } from "./rom.ts";
import { auxPoseToObjs, type AuxSpriteGfx, parseAuxSprites } from "./sprite_aux.ts";
import { ANIM_PLAY_REVERSE, ANIM_PLAY_XFLIP, ANIM_PLAY_YFLIP, type AuxAnimFile, AuxAnimState, cmdDuration, cmdFlip, cmdPose, parseAuxAnimFiles } from "./anim_aux.ts";
import { renderObjs } from "./render.ts";
import { AUX_ANIM_REFS } from "./aux_anims.ts";
import { ANIM_NAMES } from "./sprite_names.ts";
import { flagNames, hex4, NumberStepper, PaletteRow, PlttControl, PoseGrid, SpriteCanvas, spriteLabel, useFrameLoop } from "./components.tsx";

export const AuxSpriteViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const sprites = useMemo(() => parseAuxSprites(rom.data, rom.fs), [rom]);
  const animFiles = useMemo(() => parseAuxAnimFiles(rom.data, rom.fs), [rom]);
  const [selected, setSelected] = useState<AuxSpriteGfx>(sprites[0]);

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {sprites.map((g) => (
          <li key={g.id} class={g === selected ? "selected" : ""} onClick={() => setSelected(g)}>
            {spriteLabel(g.id, false)}
          </li>
        ))}
      </ul>
      <AuxSpriteView key={selected.id} gfx={selected} pltt={rom.pltt} animFiles={animFiles} />
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
    <div class="sprite-view">
      <h2>{spriteLabel(gfx.id)}</h2>
      <p>
        poses: {gfx.poseCount} (+{gfx.poses.length - gfx.poseCount} after this entry), size: {gfx.pw}x{gfx.ph}, offset: ({gfx.px}, {gfx.py}), plttID: {gfx.plttID}
      </p>
      <div class="controls">
        <NumberStepper label="pose" value={poseIdx} min={0} max={gfx.poses.length - 1} onChange={setPose} />
        <PlttControl value={plttID} defaultValue={gfx.plttID} pltt={pltt} onChange={setPlttID} />
        <label>
          scale <input type="number" min={1} max={8} value={scale} onInput={(e) => setScale(Number(e.currentTarget.value))} />
        </label>
        <label>
          <input type="checkbox" checked={xflip} disabled={animActive} onChange={(e) => setXflip(e.currentTarget.checked)} /> xflip
        </label>
        <label>
          <input type="checkbox" checked={yflip} disabled={animActive} onChange={(e) => setYflip(e.currentTarget.checked)} /> yflip
        </label>
      </div>
      {pose && (
        <p>
          subsprites: {pose.subsprites.length}, tiles: {pose.tileCount} (from {pose.tileNum}), pose plttID: {pose.plttID}
          {poseIdx >= gfx.poseCount && " (後ろのエントリのポーズ)"}
        </p>
      )}
      <AuxAnimPanel
        gfx={gfx}
        animFiles={animFiles}
        active={animActive}
        setActive={setAnimActive}
        onPose={(i, x, y) => {
          setPoseIdx(i);
          setXflip(x);
          setYflip(y);
        }}
      />
      <SpriteCanvas rendered={rendered} scale={scale} origin />
      <div class="pltts">
        <PaletteRow pltt={pltt} plttID={plttID} />
      </div>
      <PoseGrid count={gfx.poseCount} selected={poseIdx} onSelect={setPose} render={renderThumb} />
    </div>
  );
};

const ANIM_PLAY_FLAG_NAMES: [number, string][] = [
  [ANIM_PLAY_XFLIP, "XFLIP"],
  [ANIM_PLAY_YFLIP, "YFLIP"],
  [ANIM_PLAY_REVERSE, "REVERSE"],
];

const animFileLabel = (f: AuxAnimFile, gfx: AuxSpriteGfx) => {
  const name = ANIM_NAMES[f.id]?.[0] ?? hex4(f.id);
  // ポーズ番号がこのエントリに収まるか, 後ろのエントリまで使うか, ポーズ配列からはみ出すか
  const fit = f.maxPose < gfx.poseCount ? "" : f.maxPose < gfx.poses.length ? " +" : " !";
  return `${name}${name.endsWith(hex4(f.id).slice(2)) ? "" : ` (${hex4(f.id)})`}, max pose ${f.maxPose}${fit}`;
};

// アニメファイルを選んで AuxAnimState で再生する, 1フレームごとに AuxSprite_AdvanceAnim と同じ処理で進め、AuxSprite に当たったポーズと反転を onPose で返す
const AuxAnimPanel: FunctionComponent<{
  gfx: AuxSpriteGfx;
  animFiles: AuxAnimFile[];
  active: boolean;
  setActive: (v: boolean) => void;
  onPose: (poseIdx: number, xflip: boolean, yflip: boolean) => void;
}> = ({ gfx, animFiles, active, setActive, onPose }) => {
  const refs = AUX_ANIM_REFS[gfx.id] ?? [];
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
    if (state.current.advance()) loops.current++;
    frames.current++;
  };

  useFrameLoop(playing && active && file !== undefined, advance, sync);

  const anim = file?.anims[animIdx];
  const cmds = anim?.variants[variant] ?? [];
  const sortedFiles = [...animFiles].sort((a, b) => a.id - b.id);

  return (
    <div class="anim-panel">
      <div class="controls">
        <label>
          anim file{" "}
          <select value={fileID ?? ""} onChange={(e) => changeFile(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}>
            <option value="">(none)</option>
            {refs.length > 0 && (
              <optgroup label="ソースで一緒に使われているもの">
                {sortedFiles.filter((f) => refIDs.has(f.id)).map((f) => <option key={f.id} value={f.id}>{animFileLabel(f, gfx)}</option>)}
              </optgroup>
            )}
            <optgroup label="その他">
              {sortedFiles.filter((f) => !refIDs.has(f.id)).map((f) => <option key={f.id} value={f.id}>{animFileLabel(f, gfx)}</option>)}
            </optgroup>
          </select>
        </label>
        {file && (
          <>
            <label>
              anim{" "}
              <select value={animIdx} onChange={(e) => changeAnim(Number(e.currentTarget.value))}>
                {file.anims.map((a, i) => (
                  <option key={i} value={i}>
                    {i}: {a.cmdCount} cmds, {a.variantCount} variants, {a.variants[0].reduce((t, c) => t + cmdDuration(c), 0)}f
                  </option>
                ))}
              </select>
            </label>
            <label>
              variant{" "}
              <select value={variant} onChange={(e) => changeVariant(Number(e.currentTarget.value))}>
                {anim?.variants.map((_, i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      {fileID !== null && refIDs.has(fileID) && <p class="anim-refs">{refs.find(([id]) => id === fileID)![1]}</p>}
      {file && (
        <>
          <div class="controls">
            {ANIM_PLAY_FLAG_NAMES.map(([bit, n]) => (
              <label key={bit}>
                <input type="checkbox" checked={(flags & bit) !== 0} onChange={(e) => changeFlags(e.currentTarget.checked ? flags | bit : flags & ~bit)} /> {n}
              </label>
            ))}
            <label title="0x40 (64) で等速">
              speed <input type="number" min={0} max={0xFFFF} value={speed} onInput={(e) => changeSpeed(Number(e.currentTarget.value))} />
            </label>
          </div>
          <div class="controls">
            <button type="button" onClick={() => start(file, animIdx, variant, flags)} title="今の状態のまま AuxAnim_SetAnim を呼ぶ (同じアニメを同じ向きで再生中なら flags だけ変わる)">SetAnim</button>
            <button type="button" onClick={() => start(file, animIdx, variant, flags, true)} title="AuxAnimState を作り直してから AuxAnim_SetAnim する">restart</button>
            <button type="button" disabled={!active} onClick={() => setPlaying(!playing)}>{playing ? "pause" : "play"}</button>
            <button
              type="button"
              disabled={!active || playing}
              onClick={() => {
                advance();
                sync();
              }}
            >
              step
            </button>
          </div>
          {active && (
            <>
              <p class="anim-status">
                frame {frames.current}, cmd {s.cmdIdx}/{s.cmdCount}, tick {s.tick}/{s.wait}, duration {s.duration}, speed {s.speed}, flags {flagNames(s.flags, ANIM_PLAY_FLAG_NAMES)}, sprite: pose {s.poseIdx}
                {s.xflip && " XFLIP"}
                {s.yflip && " YFLIP"}, loops {loops.current}
              </p>
              <div class="anim-cmds">
                {cmds.map((c, i) => (
                  <span key={i} class={i === s.cmdIdx ? "anim-cmd current" : "anim-cmd"}>
                    #{i} pose {cmdPose(c)} / {cmdDuration(c)}f{cmdFlip(c) ? ` ${flagNames(cmdFlip(c), ANIM_PLAY_FLAG_NAMES)}` : ""}
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

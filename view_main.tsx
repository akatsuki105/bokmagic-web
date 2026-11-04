// MainSprite (DIR_MAIN_SPRITE) のタブ

import { FunctionComponent } from "preact";
import { useCallback, useMemo, useRef, useState } from "preact/hooks";
import { DIR_MAIN_SPRITE, type FileEntry } from "./fs.ts";
import type { ObjPltt } from "./objpltt.ts";
import type { ROMFile } from "./rom.ts";
import { type MainSpriteGfx, parseMainSprite, poseToObjs } from "./sprite_main.ts";
import { renderObjs } from "./render.ts";
import { MAIN_ANIM_EVENT_ADVANCED, MAIN_ANIM_EVENT_ENDED, MAIN_ANIM_EVENT_WILL_END, MAIN_ANIM_FORCE_POSE, MAIN_ANIM_KEEP_FRAME, MAIN_ANIM_REVERSE, MainSpriteAnimState, PLAYMODE_LOOP, PLAYMODE_ONCE_AND_STOP, PLAYMODE_PAUSE, PLAYMODE_PLAY_ONCE_HIDE } from "./anim_main.ts";
import { Desc, flagNames, hashID, hex4, NumberStepper, PaletteRow, PlttControl, PoseGrid, SpriteCanvas, spriteDesc, spriteLabel, useFrameLoop, useHashID } from "./components.tsx";

export const mainSpriteHref = (id: number) => `#main/${hex4(id)}`;

export const MainSpriteViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const files = useMemo(() => rom.fs.list(DIR_MAIN_SPRITE), [rom]);
  const byID = (id: number | undefined) => files.find((f) => f.id === id);
  const [selected, setSelected] = useState<FileEntry>(byID(hashID("main")) ?? files[0]);
  useHashID("main", (id) => {
    const f = byID(id);
    if (f) setSelected(f);
  });
  const gfx = useMemo(() => parseMainSprite(rom.data, selected.offset), [rom, selected]);

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {files.map((f) => (
          <li key={f.id} class={f === selected ? "selected" : ""}>
            <a href={mainSpriteHref(f.id)}>{spriteLabel(f.id, false)}</a>
          </li>
        ))}
      </ul>
      <MainSpriteView key={selected.id} id={selected.id} gfx={gfx} pltt={rom.objPltt} />
    </div>
  );
};

const MainSpriteView: FunctionComponent<{ id: number; gfx: MainSpriteGfx; pltt: ObjPltt }> = ({ id, gfx, pltt }) => {
  const [poseIdx, setPoseIdx] = useState(0);
  const [plttID, setPlttID] = useState(gfx.palStart);
  const [scale, setScale] = useState(3);
  const [xflip, setXflip] = useState(false);
  const [hidden, setHidden] = useState(false); // アニメが PLAYMODE_PLAY_ONCE_HIDE で終わって非表示になった
  const [animIdx, setAnimIdx] = useState<number | null>(null); // null ならアニメを再生していない

  const pose = gfx.poses[poseIdx];
  const rendered = useMemo(() => renderObjs(hidden ? [] : poseToObjs(gfx, poseIdx, pltt.colors, plttID, xflip)), [gfx, poseIdx, plttID, xflip, pltt, hidden]);
  const renderThumb = useCallback((i: number) => renderObjs(poseToObjs(gfx, i, pltt.colors, plttID)), [gfx, pltt, plttID]);
  const usedPltts = pose ? [...new Set(pose.subsprites.map((s) => s.paletteNum))].sort((a, b) => a - b) : [];

  // 手でポーズを選んだらアニメの表示はやめる
  const setPose = (i: number) => {
    setAnimIdx(null);
    setHidden(false);
    setPoseIdx(i);
  };

  return (
    <div class="sprite-view">
      <h2>{spriteLabel(id, false)}</h2>
      <Desc text={spriteDesc(id)} />
      <p>
        poses: {gfx.poses.length}, anims: {gfx.anims.length}, tiles: {gfx.tiles.length / 32}, palStart: {gfx.palStart}
      </p>
      <div class="controls">
        <NumberStepper label="pose" value={poseIdx} min={0} max={gfx.poses.length - 1} onChange={setPose} />
        <PlttControl value={plttID} defaultValue={gfx.palStart} pltt={pltt} onChange={setPlttID} />
        <label>
          scale <input type="number" min={1} max={8} value={scale} onInput={(e) => setScale(Number(e.currentTarget.value))} />
        </label>
        <label>
          <input type="checkbox" checked={xflip} onChange={(e) => setXflip(e.currentTarget.checked)} /> xflip
        </label>
      </div>
      {pose && (
        <p>
          subsprites: {pose.subsprites.length}, unk_0: {hex4(pose.unk_0)}, offset: ({pose.offsetX}, {pose.offsetY}), box: L{pose.box.left} T{pose.box.top} R{pose.box.right} B{pose.box.bottom}
        </p>
      )}
      {gfx.anims.length > 0 && (
        <MainAnimPanel
          gfx={gfx}
          animIdx={animIdx}
          setAnimIdx={setAnimIdx}
          onPose={(i, h) => {
            setPoseIdx(i);
            setHidden(h);
          }}
        />
      )}
      <SpriteCanvas rendered={rendered} scale={scale} origin />
      <div class="pltts">
        {usedPltts.map((n) => <PaletteRow key={n} pltt={pltt} plttID={plttID + n} />)}
      </div>
      <PoseGrid count={gfx.poses.length} selected={poseIdx} onSelect={setPose} render={renderThumb} />
    </div>
  );
};

const PLAYMODE_NAMES: [number, string][] = [
  [PLAYMODE_PAUSE, "PAUSE"],
  [PLAYMODE_LOOP, "LOOP"],
  [PLAYMODE_ONCE_AND_STOP, "ONCE_AND_STOP"],
  [PLAYMODE_PLAY_ONCE_HIDE, "PLAY_ONCE_HIDE"],
];

const ANIM_FLAG_NAMES: [number, string][] = [
  [MAIN_ANIM_KEEP_FRAME, "KEEP_FRAME"],
  [MAIN_ANIM_REVERSE, "REVERSE"],
  [MAIN_ANIM_FORCE_POSE, "FORCE_POSE"],
];

const ANIM_EVENT_NAMES: [number, string][] = [
  [MAIN_ANIM_EVENT_WILL_END, "WILL_END"],
  [MAIN_ANIM_EVENT_ENDED, "ENDED"],
  [MAIN_ANIM_EVENT_ADVANCED, "ADVANCED"],
];

// アニメの選択と再生, 1フレームごとに MainSprite_AdvanceAnim と同じ処理で進め、そのときのポーズを onPose で返す
const MainAnimPanel: FunctionComponent<{
  gfx: MainSpriteGfx;
  animIdx: number | null;
  setAnimIdx: (i: number | null) => void;
  onPose: (poseIdx: number, hidden: boolean) => void;
}> = ({ gfx, animIdx, setAnimIdx, onPose }) => {
  const state = useRef(new MainSpriteAnimState());
  const frames = useRef(0); // SetAnim してから進めたフレーム数
  const [playMode, setPlayMode] = useState(PLAYMODE_LOOP);
  const [flags, setFlags] = useState(0);
  const [speed, setSpeed] = useState(64);
  const [playing, setPlaying] = useState(true);
  const [, setVersion] = useState(0);

  const s = state.current;
  const sync = () => {
    onPose(state.current.poseIdx, state.current.hidden);
    setVersion((v) => v + 1);
  };

  // MainSprite_SetAnim, 速度は SetAnim が 1.0 に戻すのでその後に MainSprite_SetAnimSpeed で当て直す
  // 非表示になっていたら表示に戻す (ゲームでは MainSprite_Show を呼ぶ側の仕事)
  const start = (i: number) => {
    const st = state.current;
    st.hidden = false;
    st.setAnim(gfx, i, playMode, flags);
    if (speed !== 64) st.setAnimSpeed(speed);
    frames.current = 0;
    setAnimIdx(i);
    sync();
  };

  // MainSprite_Add 直後の状態から SetAnim し直す
  const restart = () => {
    if (animIdx === null) return;
    state.current = new MainSpriteAnimState();
    start(animIdx);
  };

  const advance = () => {
    state.current.advance();
    frames.current++;
  };

  useFrameLoop(playing && animIdx !== null, advance, sync);

  const changeSpeed = (v: number) => {
    setSpeed(v);
    if (animIdx !== null) {
      s.setAnimSpeed(v);
      sync();
    }
  };

  const anim = animIdx !== null ? gfx.anims[animIdx] : undefined;

  return (
    <div class="anim-panel">
      <div class="controls">
        <label>
          anim{" "}
          <select value={animIdx ?? ""} onChange={(e) => e.currentTarget.value === "" ? setAnimIdx(null) : start(Number(e.currentTarget.value))}>
            <option value="">(none)</option>
            {gfx.anims.map((a, i) => (
              <option key={i} value={i}>
                {i}: {hex4(a.unk_0)} ({a.cmds.length} cmds, {a.cmds.reduce((t, c) => t + c.duration, 0)}f)
              </option>
            ))}
          </select>
        </label>
        <label>
          playMode{" "}
          <select value={playMode} onChange={(e) => setPlayMode(Number(e.currentTarget.value))}>
            {PLAYMODE_NAMES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </label>
        {ANIM_FLAG_NAMES.map(([bit, n]) => (
          <label key={bit}>
            <input type="checkbox" checked={(flags & bit) !== 0} onChange={(e) => setFlags(e.currentTarget.checked ? flags | bit : flags & ~bit)} /> {n}
          </label>
        ))}
        <label title="u10.6 固定小数, 64 で等速">
          speed <input type="number" min={0} max={0xFFFF} value={speed} onInput={(e) => changeSpeed(Number(e.currentTarget.value))} />
        </label>
      </div>
      <div class="controls">
        <button type="button" disabled={animIdx === null} onClick={() => animIdx !== null && start(animIdx)} title="今の状態のまま MainSprite_SetAnim を呼ぶ">SetAnim</button>
        <button type="button" disabled={animIdx === null} onClick={restart} title="MainSprite_Add 直後の状態から SetAnim する">restart</button>
        <button type="button" disabled={animIdx === null} onClick={() => setPlaying(!playing)}>{playing ? "pause" : "play"}</button>
        <button
          type="button"
          disabled={animIdx === null || playing}
          onClick={() => {
            advance();
            sync();
          }}
        >
          step
        </button>
      </div>
      {anim && (
        <>
          <p class="anim-status">
            frame {frames.current}, cmd {s.animCmdIdx}/{s.animCmdLength}, timer {s.animCmdTimer}/{s.animCmdDuration}, pose {s.poseIdx}, playMode {PLAYMODE_NAMES.find(([v]) => v === s.playMode)?.[1] ?? s.playMode}, flags {flagNames(s.animFlags, ANIM_FLAG_NAMES)}, events {flagNames(s.animEvents, ANIM_EVENT_NAMES)}
            {s.hidden && ", hidden"}
          </p>
          <div class="anim-cmds">
            {anim.cmds.map((c, i) => (
              <span
                key={i}
                class={i === s.animCmdIdx ? "anim-cmd current" : "anim-cmd"}
                title="MainSprite_SetAnimFrame"
                onClick={() => {
                  s.setAnimFrame(gfx, animIdx!, i);
                  sync();
                }}
              >
                #{i} pose {c.poseIdx} / {c.duration}f
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

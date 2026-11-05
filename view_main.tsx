// MainSprite (DIR_MAIN_SPRITE) のタブ

import { FunctionComponent } from "preact";
import { useCallback, useMemo, useRef, useState } from "preact/hooks";
import { DIR_MAIN_SPRITE, type FileEntry } from "./fs.ts";
import type { ObjPltt } from "./objpltt.ts";
import type { ROMFile } from "./rom.ts";
import { MAIN_SPRITE_SHEET_TILES, type MainSpriteGfx, type MainSpritePose, parseMainSprite, poseToObjs } from "./sprite_main.ts";
import { OBJ_SIZE, renderObjs } from "./render.ts";
import { MAIN_ANIM_EVENT_ADVANCED, MAIN_ANIM_EVENT_ENDED, MAIN_ANIM_EVENT_WILL_END, MAIN_ANIM_FORCE_POSE, MAIN_ANIM_KEEP_FRAME, MAIN_ANIM_REVERSE, MainSpriteAnimState, PLAYMODE_LOOP, PLAYMODE_ONCE_AND_STOP, PLAYMODE_PAUSE, PLAYMODE_PLAY_ONCE_HIDE } from "./anim_main.ts";
import { AnimTimeline, AssetView, ButtonRow, Card, Check, Field, Fields, flagNames, hashID, hex4, type InfoRow, InfoTable, PaletteRow, PlttControl, PoseGrid, Slider, SpriteCanvas, spriteDesc, spriteLabel, StageTitle, useFrameLoop, useHashID } from "./components.tsx";

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
    <AssetView
      title={spriteLabel(id, false)}
      desc={spriteDesc(id)}
      stage={
        <>
          <SpriteCanvas rendered={rendered} scale={scale} origin />
          <div class="pltts">
            {usedPltts.map((n) => <PaletteRow key={n} pltt={pltt} plttID={plttID + n} />)}
          </div>
          <StageTitle>ポーズ ({gfx.poses.length})</StageTitle>
          <PoseGrid count={gfx.poses.length} selected={poseIdx} onSelect={setPose} render={renderThumb} />
        </>
      }
    >
      <Card title="表示">
        <Fields>
          <Field label="ポーズ">
            <Slider value={poseIdx} min={0} max={gfx.poses.length - 1} onChange={setPose} format={(v) => `${v} / ${gfx.poses.length - 1}`} stepButtons />
          </Field>
          <Field label="パレット" title="plttID (OBJ パレットの番号). スプライトは palStart から使う">
            <PlttControl value={plttID} defaultValue={gfx.palStart} pltt={pltt} onChange={setPlttID} />
          </Field>
          <Field label="拡大">
            <Slider value={scale} min={1} max={8} onChange={setScale} format={(v) => `${v}x`} />
          </Field>
          <Field label="反転">
            <Check checked={xflip} onChange={setXflip}>左右</Check>
          </Field>
        </Fields>
      </Card>
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
      {pose && (
        <Card title={`ポーズ ${poseIdx}`} tip="表はサブスプライト (OBJ 1 枚ずつ). 後ろほど手前に描く. 位置はポーズの原点から">
          <InfoTable
            rows={[
              ["offset", `(${pose.offsetX}, ${pose.offsetY}) px`, "描画の座標に足すずれ. 反転しても向きは変わらない"],
              ["box", `左 ${pose.box.left}, 上 ${pose.box.top}, 右 ${pose.box.right}, 下 ${pose.box.bottom} px`, "画面外判定の矩形 (原点から). 表示には影響しない"],
              ["unk_0", hex4(pose.unk_0), "意味は分かっていない"],
            ]}
          />
          <SubspriteTable gfx={gfx} pose={pose} plttID={plttID} />
        </Card>
      )}
      <Card title="Metadata">
        <InfoTable
          rows={[
            ["anims", gfx.anims.length],
            ["tiles", gfx.tiles.length / 32, `横 ${MAIN_SPRITE_SHEET_TILES} タイルのシートに並ぶ`],
            ["palStart", gfx.palStart, "パレット (plttID) の既定値. サブスプライトはここからの相対で選ぶ"],
          ]}
        />
      </Card>
    </AssetView>
  );
};

// ポーズを組み立てる OBJ の一覧. 後ろのものほど手前に描く
const SubspriteTable: FunctionComponent<{ gfx: MainSpriteGfx; pose: MainSpritePose; plttID: number }> = ({ pose, plttID }) => (
  <>
    <table class="pltt-table striped sub-table">
      <thead>
        <tr>
          <th title="後ろほど手前">OBJ</th>
          <th>大きさ</th>
          <th>位置 (px)</th>
          <th title="横 16 タイルのシートでの左上のタイル">tileNum</th>
          <th title="palStart + paletteNum">plttID</th>
          <th>反転</th>
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
              <td>{sub.tileNum}</td>
              <td>{plttID + sub.paletteNum}</td>
              <td>{[sub.flip & 4 ? "左右" : "", sub.flip & 8 ? "上下" : ""].filter(Boolean).join(", ") || "-"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </>
);

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
    <>
      <Card title="アニメ">
        <Fields>
          <Field label="アニメ">
            <select class="wide" value={animIdx ?? ""} onChange={(e) => e.currentTarget.value === "" ? setAnimIdx(null) : start(Number(e.currentTarget.value))}>
              <option value="">(なし)</option>
              {gfx.anims.map((a, i) => (
                <option key={i} value={i}>
                  {i}: {a.cmds.length} コマ, {a.cmds.reduce((t, c) => t + c.duration, 0)}f (unk_0 {hex4(a.unk_0)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="再生モード" title="MainSprite_SetAnim の playMode">
            <select value={playMode} onChange={(e) => setPlayMode(Number(e.currentTarget.value))}>
              {PLAYMODE_NAMES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </Field>
          <Field label="フラグ" title="MainSprite_SetAnim の flags">
            {ANIM_FLAG_NAMES.map(([bit, n]) => (
              <Check key={bit} checked={(flags & bit) !== 0} onChange={(on) => setFlags(on ? flags | bit : flags & ~bit)}>
                {n}
              </Check>
            ))}
          </Field>
          <Field label="速度" title="u10.6 固定小数">
            <Slider value={speed} min={0} max={256} onChange={changeSpeed} format={(v) => `${v} (${(v / 64).toFixed(2)}x)`} />
          </Field>
        </Fields>
        <ButtonRow>
          <button type="button" disabled={animIdx === null} onClick={() => setPlaying(!playing)}>{playing ? "❚❚ 一時停止" : "▶ 再生"}</button>
          <button
            type="button"
            disabled={animIdx === null || playing}
            onClick={() => {
              advance();
              sync();
            }}
          >
            ▸| 1 フレーム
          </button>
          <button type="button" disabled={animIdx === null} onClick={() => animIdx !== null && start(animIdx)} title="今の状態のまま MainSprite_SetAnim を呼ぶ">SetAnim</button>
          <button type="button" disabled={animIdx === null} onClick={restart} title="MainSprite_Add 直後の状態から SetAnim する">最初から</button>
        </ButtonRow>
      </Card>
      {anim && (
        <Card title="アニメの状態">
          <InfoTable
            rows={[
              ["frame", frames.current, "SetAnim してから進めたフレーム数"],
              ["cmd", `${s.animCmdIdx} / ${s.animCmdLength}`, "今のコマ / コマ数"],
              ["timer", `${s.animCmdTimer} / ${s.animCmdDuration}`, "今のコマで経ったフレーム / 速度を掛けた後のコマの長さ"],
              ["pose", s.poseIdx],
              ["playMode", PLAYMODE_NAMES.find(([v]) => v === s.playMode)?.[1] ?? s.playMode],
              ["flags", flagNames(s.animFlags, ANIM_FLAG_NAMES)],
              ["events", flagNames(s.animEvents, ANIM_EVENT_NAMES), "このフレームで起きたこと"],
              ...(s.hidden ? [["hidden", "非表示", "PLAY_ONCE_HIDE で終わった"] as InfoRow] : []),
            ]}
          />
          <AnimTimeline
            items={anim.cmds.map((c) => ({ label: `pose ${c.poseIdx}`, duration: c.duration, title: "押すと MainSprite_SetAnimFrame でこのコマンドへ" }))}
            current={s.animCmdIdx}
            onSelect={(i) => {
              s.setAnimFrame(gfx, animIdx!, i);
              sync();
            }}
          />
        </Card>
      )}
    </>
  );
};

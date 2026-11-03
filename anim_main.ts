// MainSprite のアニメーション再生, see src/sprite_anim_main.c in boktai2 decomp
// MainSprite のうちアニメに関わるメンバだけを持ち、C の実装をそのまま移している

import type { MainAnimCmd, MainSpriteGfx } from "./sprite_main.ts";

// MainSprite.playMode
export const PLAYMODE_PAUSE = 0; // 停止
export const PLAYMODE_LOOP = 1; // ループ (0/2/3 以外はすべてループ扱い)
export const PLAYMODE_ONCE_AND_STOP = 2; // 1回再生して停止
export const PLAYMODE_PLAY_ONCE_HIDE = 3; // 1回再生して非表示

// MainAnimPlayFlags16
export const MAIN_ANIM_KEEP_FRAME = 1 << 0; // 頭出しせずに今のコマ番号から続ける
export const MAIN_ANIM_REVERSE = 1 << 1; // 逆再生
export const MAIN_ANIM_FORCE_POSE = 1 << 2; // 同じアニメを指定してもポーズを当て直す

// MainAnimEvents8
export const MAIN_ANIM_EVENT_WILL_END = 1 << 0; // 次のコマで終わる
export const MAIN_ANIM_EVENT_ENDED = 1 << 1; // 今終わった
export const MAIN_ANIM_EVENT_ADVANCED = 1 << 2; // コマが進んだ

const Q6_ONE = 64; // u10_6 の 1.0

const fixToInt6 = (v: number) => v >= 0 ? v >> 6 : -((-v) >> 6);

// u16 に収めてから 0 なら 1 にする
const cmdDuration = (cmd: MainAnimCmd, speed: number) => (fixToInt6(cmd.duration * speed) & 0xFFFF) || 1;

export class MainSpriteAnimState {
  poseIdx: number; // MainSprite_SetPose で最後に当てたポーズ
  hidden = false; // SPRFLAG_HIDDEN
  unk_12 = 0; // 再生中の MainAnim.unk_0
  animCmdTimer = 0;
  animCmdDuration: number;
  animSpeed = Q6_ONE;
  animCmdIdx = 0;
  animCmdLength = 0;
  animFlags = 0;
  playMode: number;
  animEvents = 0;
  animCmds: MainAnimCmd[] = [];

  // MainSprite_Add(p, gfx, poseIdx, flags, prio, playMode, animCmdDuration, pos) 直後の状態
  constructor(poseIdx = 0, playMode = PLAYMODE_PAUSE, animCmdDuration = 0) {
    this.poseIdx = poseIdx;
    this.playMode = playMode;
    this.animCmdDuration = animCmdDuration;
  }

  private setPose(poseIdx: number, playMode: number) {
    this.poseIdx = poseIdx;
    this.playMode = playMode;
  }

  // 「次で終わる」通知を立てる条件, MainSprite_SetAnimFrame / SetAnimSpeed / AdvanceAnim で共通
  private willEnd(): boolean {
    if (this.animCmdTimer + 1 < this.animCmdDuration) return false;
    if (this.animFlags & MAIN_ANIM_REVERSE) return this.animCmdIdx === 0;
    return this.animCmdIdx + 1 >= this.animCmdLength;
  }

  // MainSprite_SetAnim
  setAnim(gfx: MainSpriteGfx, animIdx: number, playMode: number, flags: number) {
    const anim = gfx.anims[animIdx];
    const cmds = anim.cmds;
    let cmd: MainAnimCmd;
    if (flags & MAIN_ANIM_KEEP_FRAME) {
      cmd = cmds[this.animCmdIdx] ?? cmds[cmds.length - 1]; // 元は範囲外も読んでしまう
    } else if (flags & MAIN_ANIM_REVERSE) {
      cmd = cmds[cmds.length - 1];
    } else {
      cmd = cmds[0];
    }
    if (this.unk_12 !== anim.unk_0 || (flags & MAIN_ANIM_FORCE_POSE)) {
      this.setPose(cmd.poseIdx, playMode);
    }
    this.unk_12 = anim.unk_0;
    this.animCmdLength = cmds.length;
    this.animCmdDuration = cmdDuration(cmd, this.animSpeed); // 速度を 1.0 に戻す前の値で計算される
    this.animFlags = flags;
    this.animCmds = cmds;
    this.playMode = playMode;
    if (!(flags & MAIN_ANIM_KEEP_FRAME)) {
      this.animCmdIdx = (flags & MAIN_ANIM_REVERSE) ? this.animCmdLength - 1 : 0;
      this.animCmdTimer = 0;
      this.animEvents = 0;
      this.animSpeed = Q6_ONE;
    }
  }

  // MainSprite_SetAnimFrame
  setAnimFrame(gfx: MainSpriteGfx, animIdx: number, cmdIdx: number) {
    const cmds = gfx.anims[animIdx].cmds;
    this.animCmdIdx = Math.min(cmdIdx, cmds.length - 1);
    const cmd = cmds[this.animCmdIdx];
    this.setPose(cmd.poseIdx, this.playMode);
    this.animCmdLength = cmds.length;
    this.animCmdDuration = cmdDuration(cmd, this.animSpeed);
    this.animCmdTimer = 0;
    this.animEvents = this.willEnd() ? MAIN_ANIM_EVENT_WILL_END : 0;
  }

  // MainSprite_SetAnimSpeed, speed は u10_6 (64 で等速)
  setAnimSpeed(speed: number) {
    const cmd = this.animCmds[this.animCmdIdx];
    this.animSpeed = speed;
    if (cmd) this.animCmdDuration = cmdDuration(cmd, this.animSpeed);
    this.animEvents &= ~MAIN_ANIM_EVENT_WILL_END;
    if (this.willEnd()) this.animEvents |= MAIN_ANIM_EVENT_WILL_END;
  }

  // MainSprite_AdvanceAnim, アニメが終わったフレームなら true
  advance(): boolean {
    if (this.playMode === PLAYMODE_PAUSE) return false;
    let finished = false;
    this.animEvents = 0;
    if (this.animCmdTimer === 0) {
      this.setPose(this.animCmds[this.animCmdIdx].poseIdx, this.playMode);
    }
    this.animCmdTimer++;
    if (this.animCmdTimer >= this.animCmdDuration) {
      if (this.animFlags & MAIN_ANIM_REVERSE) {
        if (this.animCmdIdx === 0) {
          finished = true;
        } else {
          this.animCmdIdx--;
        }
      } else {
        this.animCmdIdx++;
        if (this.animCmdIdx >= this.animCmdLength) {
          finished = true;
          this.animCmdIdx = this.animCmdLength - 1;
        }
      }
      if (finished) {
        this.animEvents |= MAIN_ANIM_EVENT_ENDED;
        if (this.playMode === PLAYMODE_ONCE_AND_STOP) {
          this.playMode = PLAYMODE_PAUSE;
        } else if (this.playMode === PLAYMODE_PLAY_ONCE_HIDE) {
          this.playMode = PLAYMODE_PAUSE;
          this.hidden = true;
        } else {
          this.animCmdIdx = (this.animFlags & MAIN_ANIM_REVERSE) ? this.animCmdLength - 1 : 0;
          this.animEvents |= MAIN_ANIM_EVENT_ADVANCED;
        }
      } else {
        this.animEvents |= MAIN_ANIM_EVENT_ADVANCED;
      }
      this.animCmdTimer = 0;
      this.animCmdDuration = cmdDuration(this.animCmds[this.animCmdIdx], this.animSpeed);
    } else if (this.willEnd()) {
      this.animEvents |= MAIN_ANIM_EVENT_WILL_END;
    }
    return finished;
  }
}

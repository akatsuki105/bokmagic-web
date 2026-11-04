// AuxSprite のアニメーション (DIR_ANIMATION), see include/sprite_animation.h, src/sprite_anim_aux.c in boktai2 decomp
// AuxSprite はアニメを持たず、外部の AuxAnimState が AuxAnimFile のコマを AuxSprite に当てていく

import { DIR_ANIMATION, FileSystem } from "./fs.ts";

// AuxAnimPlayFlags
export const ANIM_PLAY_XFLIP = 1 << 0;
export const ANIM_PLAY_YFLIP = 1 << 1;
export const ANIM_PLAY_REVERSE = 1 << 2;

// AuxAnimCmd, bit0-3: duration, bit4: xflip, bit5: yflip, bit6-15: poseIdx
export type AuxAnimCmd = number;
export const cmdDuration = (cmd: AuxAnimCmd) => cmd & 0xF;
export const cmdFlip = (cmd: AuxAnimCmd) => (cmd & 0x30) >> 4; // AuxAnimPlayFlags と同じ並び
export const cmdPose = (cmd: AuxAnimCmd) => cmd >> 6;

// AuxAnim, cmds は variant ごとに cmdCount 個ずつ並ぶ
// 先頭バイトの上位4ビットが variant 数 (decomp の AuxAnim は unk_0:4 と variantCount:4 のビットフィールド)
// 根拠: 全ファイルで sum(cmdCount * max(1, variantCount)) が AuxAnimFile.cmdCount と一致する
export type AuxAnim = {
  variantCount: number; // variant 数 (0 のものも variant 0 だけは読める)
  cmdCount: number;
  variants: AuxAnimCmd[][];
};

export type AuxAnimFile = {
  id: number;
  anims: AuxAnim[];
  maxPose: number; // 全コマの poseIdx の最大値, スプライトのポーズ数と見比べる用
};

export const parseAuxAnimFiles = (rom: DataView, fs: FileSystem): AuxAnimFile[] =>
  fs.list(DIR_ANIMATION).map(({ id, offset }) => {
    const animCount = rom.getUint16(offset, true);
    const anims: AuxAnim[] = [];
    let maxPose = 0;
    for (let i = 0; i < animCount; i++) {
      const a = offset + 4 + i * 4;
      const variantCount = rom.getUint8(a) >> 4;
      const cmdCount = rom.getUint8(a + 1);
      const cmdOffset = rom.getUint16(a + 2, true);
      const variants: AuxAnimCmd[][] = [];
      // variantCount が 0 でも variant 0 は読める
      for (let v = 0; v < Math.max(1, variantCount); v++) {
        const cmds: AuxAnimCmd[] = [];
        for (let j = 0; j < cmdCount; j++) {
          const cmd = rom.getUint16(offset + cmdOffset + (v * cmdCount + j) * 2, true);
          maxPose = Math.max(maxPose, cmdPose(cmd));
          cmds.push(cmd);
        }
        variants.push(cmds);
      }
      anims.push({ variantCount, cmdCount, variants });
    }
    return { id, anims, maxPose };
  });

// AuxAnimState と、それを当てられる AuxSprite の poseIdx / 反転フラグ
export class AuxAnimState {
  cmds: AuxAnimCmd[] = [];
  flags = 0;
  cmdCount = 0;
  duration = 0;
  wait = 0;
  cmdIdx = 0;
  animIdx = 0;
  speed = 0;
  tick = 0;

  // AuxSprite 側
  poseIdx = 0;
  xflip = false; // SPRFLAG_XFLIP
  yflip = false; // SPRFLAG_YFLIP

  // AuxAnim_SetAnim, 同じアニメを同じ向きで再生中なら flags だけ更新して false を返す
  setAnim(file: AuxAnimFile, animIdx: number, variant: number, flags: number): boolean {
    const a = file.anims[animIdx];
    this.cmds = a.variants[variant] ?? a.variants[0];
    this.speed = 0x40;
    const reverseChanged = ((flags & ANIM_PLAY_REVERSE) !== 0) !== ((this.flags & ANIM_PLAY_REVERSE) !== 0);
    if (this.animIdx !== animIdx || this.cmdCount === 0 || reverseChanged) {
      this.cmdCount = a.cmdCount;
      this.cmdIdx = (flags & ANIM_PLAY_REVERSE) ? this.cmdCount - 1 : 0;
      this.wait = this.duration = cmdDuration(this.cmds[this.cmdIdx]);
      this.tick = 0;
      this.animIdx = animIdx;
      this.flags = flags;
      return true;
    }
    this.flags = flags;
    return false;
  }

  // AuxAnim_RestartAnim
  restartAnim(file: AuxAnimFile, animIdx: number, variant: number, flags: number): boolean {
    this.cmdCount = 0;
    return this.setAnim(file, animIdx, variant, flags);
  }

  // AuxAnim_SetAnimSpeed, speed は 0x40 で等速
  setAnimSpeed(speed: number) {
    if (this.speed !== speed) {
      this.wait = ((speed * this.duration) >> 6) & 0xFF || 1;
      this.speed = speed;
    }
  }

  // AuxSprite_AdvanceAnim, 今のコマを AuxSprite に当ててから1コマ分進める, 一巡したら true
  advance(): boolean {
    return this.step(false);
  }

  // Particle_AdvanceAnim (include/particle.h), AuxSprite_AdvanceAnim とは次の2点だけが違う
  // - 次のコマの wait が 0 になっても 1 に直さない (次のフレームで tick >= wait になるので結果は同じ)
  // - duration を更新しない (後で AuxAnim_SetAnimSpeed したときの wait が変わる)
  advanceParticle(): boolean {
    return this.step(true);
  }

  private step(particle: boolean): boolean {
    const cmd = this.cmds[this.cmdIdx];
    this.poseIdx = cmdPose(cmd);
    this.xflip = (this.flags & ANIM_PLAY_XFLIP) !== (cmdFlip(cmd) & ANIM_PLAY_XFLIP);
    this.yflip = (this.flags & ANIM_PLAY_YFLIP) !== (cmdFlip(cmd) & ANIM_PLAY_YFLIP);

    let finished = false;
    this.tick++;
    if (this.tick >= this.wait) {
      this.tick = 0;
      if (this.flags & ANIM_PLAY_REVERSE) {
        if (this.cmdIdx === 0) {
          this.cmdIdx = this.cmdCount - 1;
          finished = true;
        } else {
          this.cmdIdx--;
        }
      } else {
        this.cmdIdx++;
        if (this.cmdIdx >= this.cmdCount) {
          this.cmdIdx = 0;
          finished = true;
        }
      }
      const next = this.cmds[this.cmdIdx];
      if (particle) {
        this.wait = ((cmdDuration(next) * this.speed) >> 6) & 0xFF;
      } else {
        this.duration = cmdDuration(next);
        this.wait = ((this.duration * this.speed) >> 6) & 0xFF || 1;
      }
    }
    return finished;
  }
}

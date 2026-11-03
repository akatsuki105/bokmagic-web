// スクリプト (gScriptDirectory), see include/vm.h in boktai2 decomp
// バイトコードは bokcc (boktai2 decomp の tools/bokcc, ./bokcc にコピー) で命令木にして .bokc として描く

import { FileSystem } from "./fs.ts";
import { ByteStream, InstructionReader } from "./bokcc/instruction_reader.ts";
import type { Instruction } from "./bokcc/instruction.ts";

// gFS で gScriptDirectory を指すエントリ (src/file.c)
const SCRIPT_DIRECTORY = (0xA8D9 << 16) | 0xA41E;

export type ScriptEntry = {
  id: number; // スクリプトID (script_entries の添字 + 1)
  offset: number; // ROM オフセット
  varCount: number; // ScriptOffset の bit24-31, ローカル変数の個数
};

export type ScriptDirectory = {
  buildDate: Date;
  scripts: ScriptEntry[];
};

// VM_MountScriptDirectory と同じく相対オフセットを解決する
export const parseScriptDirectory = (rom: DataView, fs: FileSystem): ScriptDirectory => {
  const start = fs.rawEntry(SCRIPT_DIRECTORY);
  if (start === undefined) throw new Error("ScriptDirectory not found");
  const u32 = (ofs: number) => rom.getUint32(ofs, true);

  const entries: number[] = [];
  let p = start + 4;
  for (;; p += 4) {
    const e = u32(p);
    if (e === 0xFFFFFFFF) break;
    entries.push(e);
  }
  p += 4; // ScriptDirectoryOffsets
  const bytecode = p + u32(p) + 4; // script_data は bytecodeSize を指すので、その4バイト後ろから

  return {
    buildDate: new Date(u32(start) * 1000),
    scripts: entries.map((e, i) => ({ id: i + 1, offset: bytecode + (e & 0xFFFFFF), varCount: e >>> 24 })),
  };
};

// スクリプト1本を命令木にする, スクリプトはブロック命令 (0x80) 1つ
export const decodeScript = (rom: DataView, s: ScriptEntry): Instruction[] => new InstructionReader(new ByteStream(rom, s.offset)).decompile();

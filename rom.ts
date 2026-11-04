import * as gba from "./gba.ts";
import { FileSystem } from "./fs.ts";
import { loadObjPltt, type ObjPltt } from "./objpltt.ts";

const GAME_IDS = ["U3IJ", "U32J", "U32J_rev1", "U33J"] as const; // U3IJ はボクタイ1 (I は英字)
export type gameid = typeof GAME_IDS[number];

// 作品ごとに、形式が違ってまだ読めないアセット (画面のタブ名・コマンドラインの種類名)
// U3IJ は当たり判定・スクリプトの形式が違う (bokmagic の engine == 1 の分岐). マップの画面はスクリプトを読むので一緒に止める
const UNSUPPORTED: Partial<Record<gameid, readonly string[]>> = {
  U3IJ: ["collision", "script", "map"],
};

export const isSupported = (rom: ROMFile, kind: string): boolean => !UNSUPPORTED[rom.id]?.includes(kind);

// check function to ensure gameID satisfies the type gameid
const isSupportedGameID = (id: string): id is gameid => {
  return GAME_IDS.includes(id as typeof GAME_IDS[number]);
};

export type ROMFile = {
  name: string; // filename
  id: gameid;
  data: DataView; // file data
  fs: FileSystem;
  objPltt: ObjPltt; // gObjPlttData
};

export const LoadROM = (filename: string, data: ArrayBuffer): ROMFile => {
  const dv = new DataView(data);
  const gameID = gba.getGameID(dv);
  if (!isSupportedGameID(gameID)) {
    throw new Error(`Unsupported gameID: ${gameID} (supported: ${GAME_IDS.join(", ")})`);
  }
  const fs = new FileSystem(dv, gameID);
  return {
    name: filename,
    id: gameID,
    data: dv,
    fs,
    objPltt: loadObjPltt(dv, fs),
  };
};

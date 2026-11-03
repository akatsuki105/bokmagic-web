import * as gba from "./gba.ts";
import { FileSystem } from "./fs.ts";
import { loadObjPltt, type ObjPltt } from "./objpltt.ts";
import { setDecompGame } from "./decomp.ts";

const GAME_IDS = ["U32J_rev1", "U33J"] as const;
type gameid = typeof GAME_IDS[number];

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
  setDecompGame(gameID);
  return {
    name: filename,
    id: gameID,
    data: dv,
    fs,
    objPltt: loadObjPltt(dv, fs),
  };
};

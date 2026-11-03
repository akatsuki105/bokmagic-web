// "U32J" や "BZ3J" みたいな、4バイトの文字列
const getGameCode = (rom: DataView): string => {
  const idBytes = new Uint8Array(rom.buffer.slice(0xAC, 0xB0));
  return String.fromCharCode(...idBytes);
};

const getGameRevision = (rom: DataView): number => {
  return rom.getUint8(0xBC);
};

export const getGameID = (rom: DataView): string => {
  const gamecode = getGameCode(rom); // e.g. "BZ3J"
  const revision = getGameRevision(rom); // e.g. 0, 1
  if (revision !== 0) {
    return `${gamecode}_rev${revision}`; // e.g. "BZ3J_rev1"
  } else {
    return gamecode; // e.g. "BZ3J"
  }
};

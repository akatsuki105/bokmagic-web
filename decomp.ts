// boktai2 decomp から作った表 (names.ts, charmap.ts, *_refs.ts など) は U32J rev1 のもの
// ほかの作品ではスクリプトIDや文字列IDなどの意味が違うので、開いている ROM が U32J でなければ空の表を返す
// rev0 はファイルID・スクリプト・曲の並びが rev1 と同じ (docs/rom/filesystem.md) なので同じ表を使う

const DECOMP_GAMES = ["U32J_rev1", "U32J"];
let enabled = true;

// ROM を読み込んだときに呼ぶ
export const setDecompGame = (gameID: string) => {
  enabled = DECOMP_GAMES.includes(gameID);
};

export const hasDecompTables = () => enabled;

export const decomp = <T>(table: Record<number, T>): Record<number, T> => (enabled ? table : {});

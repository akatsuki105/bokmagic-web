// boktai2 decomp から作った表 (names.ts, charmap.ts, *_refs.ts など) は U32J rev1 のもの
// ほかの作品ではスクリプトIDや文字列IDなどの意味が違うので、開いている ROM が U32J rev1 でなければ空の表を返す

const DECOMP_GAME = "U32J_rev1";
let enabled = true;

// ROM を読み込んだときに呼ぶ
export const setDecompGame = (gameID: string) => {
  enabled = gameID === DECOMP_GAME;
};

export const hasDecompTables = () => enabled;

export const decomp = <T>(table: Record<number, T>): Record<number, T> => (enabled ? table : {});

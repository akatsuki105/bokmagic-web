// 開いた ROM を IndexedDB に保存しておき、次からは初期画面の一覧から開けるようにする (複数保持する)
// localStorage は容量が足りない (ROM は 16MB) ので使わない
//
// - 同じ ROM はファイル名が違っても 1 つにまとめる (中身の SHA-1 をキーにする)
// - 一覧を出すだけで ROM 本体を読まなくて済むよう、一覧用の情報 (meta) と本体 (data) を別のストアに置く
// - 1 つだけ保存していた版 (DB のバージョン 1, ストア "rom") からは引き継がず、古いストアは消す

import { getGameTitle } from "./gba.ts";

const DB_NAME = "bokmagic-web";
const META = "meta";
const DATA = "data";
const OLD_STORE = "rom";

export type SavedROM = {
  id: string; // 中身の SHA-1
  name: string; // 最後に開いたときのファイル名
  title: string; // カートリッジヘッダのタイトル
  gameID: string; // rom.ts の gameid
  size: number; // バイト数
};

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(OLD_STORE)) db.deleteObjectStore(OLD_STORE);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// stores をまとめて1つのトランザクションで扱う. f の結果は書き込みが確定してから返す
const transact = async <T>(stores: string[], mode: IDBTransactionMode, f: (tx: IDBTransaction) => Promise<T>): Promise<T> => {
  const db = await openDB();
  try {
    const tx = db.transaction(stores, mode);
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    });
    const result = await f(tx);
    await finished;
    return result;
  } finally {
    db.close();
  }
};

const sha1 = async (data: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-1", data))].map((b) => b.toString(16).padStart(2, "0")).join("");

// 並びは決めない (画面側で並べる)
// title を持たない古い保存 (title を足す前に保存したもの) は、本体のカートリッジヘッダから埋めて書き戻す
export const listROMs = async (): Promise<SavedROM[]> => {
  return await transact([META, DATA], "readwrite", async (tx) => {
    const metas = await done(tx.objectStore(META).getAll() as IDBRequest<SavedROM[]>);
    for (const m of metas) {
      if (typeof m.title === "string") continue;
      const data = await done(tx.objectStore(DATA).get(m.id) as IDBRequest<ArrayBuffer | undefined>);
      m.title = data && data.byteLength >= 0xC0 ? getGameTitle(new DataView(data)) : "";
      tx.objectStore(META).put(m);
    }
    return metas;
  });
};

// 保存する (同じ ROM がすでにあれば、ファイル名を新しくする)
export const saveROM = async (rom: { name: string; title: string; gameID: string }, data: ArrayBuffer): Promise<SavedROM> => {
  const meta: SavedROM = { ...rom, id: await sha1(data), size: data.byteLength };
  await transact([META, DATA], "readwrite", (tx) => {
    tx.objectStore(META).put(meta);
    tx.objectStore(DATA).put(data, meta.id);
    return Promise.resolve();
  });
  return meta;
};

// 本体を読む. 無ければ undefined
export const loadROM = (id: string): Promise<{ meta: SavedROM; data: ArrayBuffer } | undefined> =>
  transact([META, DATA], "readonly", async (tx) => {
    const meta = await done(tx.objectStore(META).get(id) as IDBRequest<SavedROM | undefined>);
    const data = await done(tx.objectStore(DATA).get(id) as IDBRequest<ArrayBuffer | undefined>);
    return meta && data ? { meta, data } : undefined;
  });

export const deleteROM = (id: string): Promise<void> =>
  transact([META, DATA], "readwrite", (tx) => {
    tx.objectStore(META).delete(id);
    tx.objectStore(DATA).delete(id);
    return Promise.resolve();
  });

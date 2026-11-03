// 最後に読み込んだ ROM を IndexedDB に保存しておき、リロード後にボタン1つで開き直せるようにする
// localStorage は容量が足りない (ROM は 16MB) ので使わない

const DB_NAME = "bokmagic-web";
const STORE = "rom";
const DATA_KEY = "last";
const NAME_KEY = "lastName"; // 名前を見るだけのために ROM 本体を読まなくて済むよう別に持つ

export type StoredROM = {
  name: string;
  data: ArrayBuffer;
};

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const transact = async <T>(mode: IDBTransactionMode, f: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = f(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
};

export const saveROM = async (rom: StoredROM): Promise<void> => {
  await transact("readwrite", (s) => s.put(rom, DATA_KEY));
  await transact("readwrite", (s) => s.put(rom.name, NAME_KEY));
};

// 保存されていなければ undefined
export const loadROM = (): Promise<StoredROM | undefined> => transact("readonly", (s) => s.get(DATA_KEY));

// 保存されている ROM のファイル名, なければ undefined
export const savedROMName = (): Promise<string | undefined> => transact("readonly", (s) => s.get(NAME_KEY));

export const clearROM = async (): Promise<void> => {
  await transact("readwrite", (s) => s.delete(NAME_KEY));
  await transact("readwrite", (s) => s.delete(DATA_KEY));
};

import { FunctionComponent, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { GAME_IDS, isSupported, LoadROM, type ROMFile } from "./rom.ts";
import { setDecompGame } from "./decomp.ts";
import { deleteROM, listROMs, loadROM, type SavedROM, saveROM } from "./rom_store.ts";
import { MainSpriteViewer } from "./view_main.tsx";
import { AuxSpriteViewer } from "./view_aux.tsx";
import { ParticleViewer } from "./view_particle.tsx";
import { ObjPaletteViewer } from "./view_objpltt.tsx";
import { BgPaletteViewer } from "./view_bgpltt.tsx";
import { TilesetViewer } from "./view_tileset.tsx";
import { ScriptViewer } from "./view_script.tsx";
import { FontViewer } from "./view_font.tsx";
import { TilemapViewer } from "./view_tilemap.tsx";
import { CollisionViewer } from "./view_collision.tsx";
import { MapViewer } from "./view_map.tsx";
import { SoundViewer, VolumeControl } from "./view_sound.tsx";

// 左のタブ, 選んでいるものは URL の # に入れておく
// スプライト, マップ, その他の順. それぞれ組み上がったもの → 部品 → パレットの順に並べる
const TABS = [
  ["main", "MainSprite"],
  ["aux", "AuxSprite"],
  ["particle", "Particle"],
  ["objpltt", "OBJ Palette"],
  ["map", "Map"],
  ["tilemap", "Tilemap"],
  ["tileset", "Tileset"],
  ["bgpltt", "BG Palette"],
  ["collision", "Collision"],
  ["font", "Font"],
  ["script", "Script"],
  ["sound", "Sound"],
] as const;
type Tab = typeof TABS[number][0];

// #tab または #tab/... (タブの中の選択はタブ側が読む)
const tabFromHash = (): Tab => TABS.find(([id]) => location.hash.slice(1).split("/")[0] === id)?.[0] ?? "main";

// 保存した ROM の並び: gameID を GAME_IDS の順 (U3IJ, U32J, U32J_rev1, U33J) に、同じ gameID はファイル名の順に. 開いても並びは変わらない
const sortSaved = (list: SavedROM[]): SavedROM[] => {
  const order = (id: string) => (GAME_IDS as readonly string[]).indexOf(id);
  return [...list].sort((a, b) => order(a.gameID) - order(b.gameID) || a.name.localeCompare(b.name));
};

const App = () => {
  const [rom, setRomState] = useState<ROMFile | null>(null);
  // ROM を読み込むたびに増やす, タブの中身をこれで作り直して前の ROM の選択状態を持ち越さないようにする
  const [romSerial, setRomSerial] = useState(0);
  const setRom = (r: ROMFile) => {
    // decomp 由来の名前を出すかどうかは画面側で決める (データ側は decomp に依存しない)
    setDecompGame(r.id);
    setRomState(r);
    setRomSerial((n) => n + 1);
  };
  const [error, setError] = useState<string | null>(null);
  // 初期画面 (ROM を読み込んでいない状態) に戻す, URL の # も消す
  const reset = (e: Event) => {
    e.preventDefault();
    setRomState(null);
    setError(null);
    history.pushState(null, "", location.pathname); // ?rom= も消して、読み直しても初期画面のままにする
    setTab(tabFromHash());
  };
  const [saved, setSaved] = useState<SavedROM[]>([]); // IndexedDB に保存してある ROM (sortSaved の順)
  const refreshSaved = () => listROMs().then((list) => setSaved(sortSaved(list))).catch((e) => console.warn("Failed to list saved ROMs:", e));
  const [tab, setTab] = useState<Tab>(tabFromHash());

  const open = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      const r = LoadROM(file.name, data);
      setRom(r);
      setError(null);
      // 保存できなくても (プライベートブラウズなど) 表示はできるので警告だけ出す
      saveROM({ name: file.name, title: r.title, gameID: r.id }, data).then(refreshSaved).catch((e) => console.warn("Failed to save ROM:", e));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openSaved = async (id: string) => {
    try {
      const stored = await loadROM(id);
      if (!stored) throw new Error("Saved ROM not found");
      setRom(LoadROM(stored.meta.name, stored.data));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const forget = (id: string) => {
    deleteROM(id).then(refreshSaved).catch((e) => console.warn("Failed to delete ROM:", e));
  };

  // URL の ?rom= で渡された ROM を取得して開く (エージェントなどが URL だけでアセットを開けるように)
  // 相対パスはページの場所から. 手で開いた「前回の ROM」を上書きしないよう IndexedDB には保存しない
  const openURL = async (url: string) => {
    try {
      const res = await fetch(new URL(url, location.href));
      if (!res.ok) throw new Error(`Failed to fetch ROM: ${res.status} ${res.statusText} (${url})`);
      setRom(LoadROM(url.split("/").pop() || url, await res.arrayBuffer()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 起動時: ?rom= があればそれを開く (URL の # のタブと選択はそのまま使う). 初期画面に出す保存してある ROM の一覧を読む
  useEffect(() => {
    const romURL = new URLSearchParams(location.search).get("rom");
    if (romURL) openURL(romURL);
    refreshSaved();
  }, []);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // 一覧は個別にスクロールするので、URL で選んだ項目が見えるように一覧をスクロールする
  useEffect(() => {
    const reveal = () => setTimeout(() => document.querySelector(".sprite-list li.selected")?.scrollIntoView({ block: "nearest" }));
    reveal();
    addEventListener("hashchange", reveal);
    return () => removeEventListener("hashchange", reveal);
  }, [rom, tab]);

  // 左の一覧で「…」で切れている名前は、マウスを乗せたときに全体を出す (title が無いものだけ)
  useEffect(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>(".sprite-list a, .sprite-list li");
      if (el && !el.title && el.scrollWidth > el.clientWidth) el.title = el.textContent ?? "";
    };
    addEventListener("mouseover", over);
    return () => removeEventListener("mouseover", over);
  }, []);

  // ウィンドウ全体でドラッグ&ドロップを受け付ける
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) open(file);
    };
    addEventListener("dragover", over);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragover", over);
      removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div class="app">
      <header class="app-header">
        <h1>
          <a href="./" onClick={reset}>bokmagic-web</a>
        </h1>
        {/* ヘッダには開いている ROM の情報だけを出す. 読み込み UI は ROM を開いていないときの本文に出す (タイトルを押すと戻る, ドロップはいつでも受け付ける) */}
        {rom && <span class="rom-name">{rom.title} ({rom.id})</span>}
        {rom && <VolumeControl />}
        {error && <span class="error">{error}</span>}
      </header>
      {!rom && (
        <div class="no-rom">
          <p>ROM ファイルを選ぶか、ウィンドウにドロップしてください</p>
          <ROMUpload open={open} />
          {saved.length > 0 && (
            <>
              <h2>保存してある ROM</h2>
              <SavedList saved={saved} open={openSaved} forget={forget} />
            </>
          )}
        </div>
      )}
      {rom && (
        <div class="app-body">
          <nav class="tabs">
            {TABS.map(([id, label]) => <a key={id} href={`#${id}`} class={`tab${id === tab ? " selected" : ""}${isSupported(rom, id) ? "" : " dim"}`}>{label}</a>)}
          </nav>
          <div key={romSerial} class="tab-body">
            {!isSupported(rom, tab) && <p class="unsupported">この ROM ({rom.id}) の {TABS.find(([id]) => id === tab)?.[1]} にはまだ対応していません</p>}
            {isSupported(rom, tab) && tab === "main" && <MainSpriteViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "aux" && <AuxSpriteViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "particle" && <ParticleViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "objpltt" && <ObjPaletteViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "bgpltt" && <BgPaletteViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "tileset" && <TilesetViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "map" && <MapViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "tilemap" && <TilemapViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "collision" && <CollisionViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "font" && <FontViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "script" && <ScriptViewer rom={rom} />}
            {isSupported(rom, tab) && tab === "sound" && <SoundViewer rom={rom} />}
          </div>
        </div>
      )}
    </div>
  );
};

// 初期画面の、保存してある ROM の一覧. 名前を押すと開く
const SavedList: FunctionComponent<{ saved: SavedROM[]; open: (id: string) => void; forget: (id: string) => void }> = ({ saved, open, forget }) => (
  <table class="saved-roms">
    <thead>
      <tr>
        <th>ファイル</th>
        <th>タイトル</th>
        <th>gameID</th>
        <th>SHA-1</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {saved.map((s) => (
        <tr key={s.id}>
          <td>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                open(s.id);
              }}
            >
              {s.name}
            </a>
          </td>
          <td>{s.title}</td>
          <td class="mono">{s.gameID}</td>
          <td class="mono">{s.id}</td>
          <td>
            <button type="button" onClick={() => forget(s.id)}>削除</button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const ROMUpload: FunctionComponent<{ open: (file: File) => Promise<void> }> = ({ open }) => {
  const [busy, setBusy] = useState(false);

  const handleFiles = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.files?.[0]) return;
    setBusy(true);
    await open(input.files[0]);
    setBusy(false);
  };

  return (
    <span>
      <label for="rom-file">ROM</label> <input type="file" id="rom-file" accept=".gba" onChange={handleFiles} disabled={busy} />
    </span>
  );
};

render(<App />, document.body);

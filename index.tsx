import { FunctionComponent, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { LoadROM, type ROMFile } from "./rom.ts";
import { setDecompGame } from "./decomp.ts";
import { clearROM, loadROM, savedROMName, saveROM } from "./rom_store.ts";
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
const TABS = [
  ["main", "MainSprite"],
  ["aux", "AuxSprite"],
  ["particle", "Particle"],
  ["objpltt", "OBJ Palette"],
  ["bgpltt", "BG Palette"],
  ["tileset", "Tileset"],
  ["map", "Map"],
  ["tilemap", "Tilemap"],
  ["collision", "Collision"],
  ["font", "Font"],
  ["script", "Script"],
  ["sound", "Sound"],
] as const;
type Tab = typeof TABS[number][0];

// #tab または #tab/... (タブの中の選択はタブ側が読む)
const tabFromHash = (): Tab => TABS.find(([id]) => location.hash.slice(1).split("/")[0] === id)?.[0] ?? "main";

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
    history.pushState(null, "", location.pathname + location.search);
    setTab(tabFromHash());
  };
  const [savedName, setSavedName] = useState<string | null>(null); // IndexedDB に保存してある ROM の名前
  const [tab, setTab] = useState<Tab>(tabFromHash());

  const open = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      setRom(LoadROM(file.name, data));
      setError(null);
      // 保存できなくても (プライベートブラウズなど) 表示はできるので警告だけ出す
      saveROM({ name: file.name, data }).then(() => setSavedName(file.name)).catch((e) => console.warn("Failed to save ROM:", e));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openSaved = async () => {
    try {
      const stored = await loadROM();
      if (!stored) throw new Error("Saved ROM not found");
      setRom(LoadROM(stored.name, stored.data));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const forget = () => {
    clearROM().then(() => setSavedName(null)).catch((e) => console.warn("Failed to clear ROM:", e));
  };

  useEffect(() => {
    savedROMName().then((name) => setSavedName(name ?? null)).catch((e) => console.warn("Failed to read saved ROM:", e));
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
        {/* 読み込み UI は ROM を開いていないときだけ出す (タイトルを押すと戻る, ドロップはいつでも受け付ける) */}
        {!rom && <ROMUpload open={open} />}
        {!rom && savedName && (
          <span>
            saved: {savedName} <button type="button" onClick={openSaved}>open</button> <button type="button" onClick={forget}>forget</button>
          </span>
        )}
        {rom && <span class="rom-name">{rom.name} ({rom.id})</span>}
        {rom && <VolumeControl />}
        {error && <span class="error">{error}</span>}
      </header>
      {!rom && <p class="no-rom">ROM ファイルを選ぶか、ウィンドウにドロップしてください</p>}
      {rom && (
        <div class="app-body">
          <nav class="tabs">
            {TABS.map(([id, label]) => <a key={id} href={`#${id}`} class={id === tab ? "tab selected" : "tab"}>{label}</a>)}
          </nav>
          <div key={romSerial} class="tab-body">
            {tab === "main" && <MainSpriteViewer rom={rom} />}
            {tab === "aux" && <AuxSpriteViewer rom={rom} />}
            {tab === "particle" && <ParticleViewer rom={rom} />}
            {tab === "objpltt" && <ObjPaletteViewer rom={rom} />}
            {tab === "bgpltt" && <BgPaletteViewer rom={rom} />}
            {tab === "tileset" && <TilesetViewer rom={rom} />}
            {tab === "map" && <MapViewer rom={rom} />}
            {tab === "tilemap" && <TilemapViewer rom={rom} />}
            {tab === "collision" && <CollisionViewer rom={rom} />}
            {tab === "font" && <FontViewer rom={rom} />}
            {tab === "script" && <ScriptViewer rom={rom} />}
            {tab === "sound" && <SoundViewer rom={rom} />}
          </div>
        </div>
      )}
    </div>
  );
};

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

import { FunctionComponent, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { LoadROM, type ROMFile } from "./rom.ts";
import { clearROM, loadROM, savedROMName, saveROM } from "./rom_store.ts";
import { MainSpriteViewer } from "./view_main.tsx";
import { AuxSpriteViewer } from "./view_aux.tsx";
import { ObjPaletteViewer } from "./view_objpltt.tsx";
import { BgPaletteViewer } from "./view_bgpltt.tsx";

// 左のタブ, 選んでいるものは URL の # に入れておく
const TABS = [
  ["main", "MainSprite"],
  ["aux", "AuxSprite"],
  ["objpltt", "OBJ Palette"],
  ["bgpltt", "BG Palette"],
] as const;
type Tab = typeof TABS[number][0];

const tabFromHash = (): Tab => TABS.find(([id]) => `#${id}` === location.hash)?.[0] ?? "main";

const App = () => {
  const [rom, setRom] = useState<ROMFile | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    <div>
      <h1>bokmagic-web</h1>
      <ROMUpload open={open} />
      {savedName && (
        <p>
          saved: {savedName} <button type="button" onClick={openSaved}>open</button> <button type="button" onClick={forget}>forget</button>
        </p>
      )}
      {error && <p class="error">{error}</p>}
      {rom && <p>{rom.name} ({rom.id})</p>}
      {rom && (
        <div class="app-body">
          <nav class="tabs">
            {TABS.map(([id, label]) => <a key={id} href={`#${id}`} class={id === tab ? "tab selected" : "tab"}>{label}</a>)}
          </nav>
          {tab === "main" && <MainSpriteViewer rom={rom} />}
          {tab === "aux" && <AuxSpriteViewer rom={rom} />}
          {tab === "objpltt" && <ObjPaletteViewer rom={rom} />}
          {tab === "bgpltt" && <BgPaletteViewer rom={rom} />}
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
    <div>
      <label for="rom-file">Choose ROM (or drop it here)</label> <input type="file" id="rom-file" accept=".gba" onChange={handleFiles} disabled={busy} />
    </div>
  );
};

render(<App />, document.body);

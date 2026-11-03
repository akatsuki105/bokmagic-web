import { FunctionComponent, render } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import * as gba from "./gba.ts";
import { DIR_MAIN_SPRITE, type FileEntry, FileSystem } from "./fs.ts";
import { loadObjPltt, type ObjPltt } from "./pltt.ts";
import { type MainSpriteGfx, parseMainSprite, poseToObjs } from "./sprite_main.ts";
import { type Rendered, renderObjs } from "./render.ts";
import { SPRITE_NAMES } from "./sprite_names.ts";
import { clearROM, loadROM, savedROMName, saveROM } from "./rom_store.ts";

const GAME_IDS = ["U32J_rev1"] as const;
type gameid = typeof GAME_IDS[number];

// check function to ensure gameID satisfies the type gameid
const isSupportedGameID = (id: string): id is gameid => {
  return GAME_IDS.includes(id as typeof GAME_IDS[number]);
};

type ROMFile = {
  name: string; // filename
  id: gameid;
  data: DataView; // file data
  fs: FileSystem;
  pltt: ObjPltt;
};

const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;

const App = () => {
  const [rom, setRom] = useState<ROMFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null); // IndexedDB に保存してある ROM の名前

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
      {rom && <MainSpriteViewer rom={rom} />}
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

const LoadROM = (filename: string, data: ArrayBuffer): ROMFile => {
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
    pltt: loadObjPltt(dv, fs),
  };
};

// --------------------------------------------

// withDesc が false なら定数名まで
const spriteLabel = (id: number, withDesc = true) => {
  const name = SPRITE_NAMES[id];
  if (!name) return hex4(id);
  return withDesc ? `${hex4(id)} ${name[0]} ${name[1]}` : `${hex4(id)} ${name[0]}`;
};

const MainSpriteViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const files = useMemo(() => rom.fs.list(DIR_MAIN_SPRITE), [rom]);
  const [selected, setSelected] = useState<FileEntry>(files[0]);
  const gfx = useMemo(() => parseMainSprite(rom.data, selected.offset), [rom, selected]);

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {files.map((f) => (
          <li key={f.id} class={f === selected ? "selected" : ""} onClick={() => setSelected(f)}>
            {spriteLabel(f.id, false)}
          </li>
        ))}
      </ul>
      <MainSpriteView key={selected.id} id={selected.id} gfx={gfx} pltt={rom.pltt} />
    </div>
  );
};

const MainSpriteView: FunctionComponent<{ id: number; gfx: MainSpriteGfx; pltt: ObjPltt }> = ({ id, gfx, pltt }) => {
  const [poseIdx, setPoseIdx] = useState(0);
  const [plttID, setPlttID] = useState(gfx.palStart);
  const [scale, setScale] = useState(3);
  const [xflip, setXflip] = useState(false);

  const pose = gfx.poses[poseIdx];
  const rendered = useMemo(() => renderObjs(poseToObjs(gfx, poseIdx, pltt.colors, plttID, xflip)), [gfx, poseIdx, plttID, xflip, pltt]);
  const usedPltts = pose ? [...new Set(pose.subsprites.map((s) => s.paletteNum))].sort((a, b) => a - b) : [];
  const setPose = (i: number) => setPoseIdx(Math.max(0, Math.min(gfx.poses.length - 1, i)));

  return (
    <div class="sprite-view">
      <h2>{spriteLabel(id)}</h2>
      <p>
        poses: {gfx.poses.length}, anims: {gfx.anims.length}, tiles: {gfx.tiles.length / 32}, palStart: {gfx.palStart}
      </p>
      <div class="controls">
        <label>
          pose <input type="number" min={0} max={gfx.poses.length - 1} value={poseIdx} onInput={(e) => setPose(Number(e.currentTarget.value))} />
        </label>
        <button type="button" onClick={() => setPose(poseIdx - 1)}>◀</button>
        <button type="button" onClick={() => setPose(poseIdx + 1)}>▶</button>
        <label>
          plttID <input type="number" min={0} max={pltt.length - 1} value={plttID} onInput={(e) => setPlttID(Number(e.currentTarget.value))} />
        </label>
        <button type="button" onClick={() => setPlttID(gfx.palStart)}>reset</button>
        <label>
          scale <input type="number" min={1} max={8} value={scale} onInput={(e) => setScale(Number(e.currentTarget.value))} />
        </label>
        <label>
          <input type="checkbox" checked={xflip} onChange={(e) => setXflip(e.currentTarget.checked)} /> xflip
        </label>
      </div>
      {pose && (
        <p>
          subsprites: {pose.subsprites.length}, unk_0: {hex4(pose.unk_0)}, offset: ({pose.offsetX}, {pose.offsetY}), box: L{pose.box.left} T{pose.box.top} R{pose.box.right} B{pose.box.bottom}
        </p>
      )}
      <SpriteCanvas rendered={rendered} scale={scale} origin />
      <div class="pltts">
        {usedPltts.map((n) => <PaletteRow key={n} pltt={pltt} plttID={plttID + n} />)}
      </div>
      <div class="thumbs">
        {gfx.poses.map((_, i) => (
          <div key={i} class={i === poseIdx ? "thumb selected" : "thumb"} onClick={() => setPoseIdx(i)} title={`pose ${i}`}>
            <PoseThumb gfx={gfx} poseIdx={i} pltt={pltt} plttID={plttID} />
            <span>{i}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const PoseThumb: FunctionComponent<{ gfx: MainSpriteGfx; poseIdx: number; pltt: ObjPltt; plttID: number }> = ({ gfx, poseIdx, pltt, plttID }) => {
  const rendered = useMemo(() => renderObjs(poseToObjs(gfx, poseIdx, pltt.colors, plttID)), [gfx, poseIdx, pltt, plttID]);
  const { width, height } = rendered.image;
  return <SpriteCanvas rendered={rendered} scale={Math.min(1, 64 / Math.max(width, height))} />;
};

// origin が true なら原点に十字を描く
const SpriteCanvas: FunctionComponent<{ rendered: Rendered; scale: number; origin?: boolean }> = ({ rendered, scale, origin }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const { image } = rendered;

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    ctx?.putImageData(image, 0, 0);
  }, [image]);

  return (
    <div class="canvas-wrap" style={{ width: image.width * scale, height: image.height * scale }}>
      <canvas ref={ref} width={image.width} height={image.height} style={{ width: image.width * scale, height: image.height * scale }} />
      {origin && <div class="origin-x" style={{ top: rendered.originY * scale }} />}
      {origin && <div class="origin-y" style={{ left: rendered.originX * scale }} />}
    </div>
  );
};

const PaletteRow: FunctionComponent<{ pltt: ObjPltt; plttID: number }> = ({ pltt, plttID }) => {
  const colors = [...pltt.colors.subarray(plttID * 16, plttID * 16 + 16)];
  return (
    <div class="pltt-row">
      <span>{plttID}</span>
      {colors.map((c, i) => <span key={i} class="swatch" style={{ background: `rgb(${c & 0xFF} ${(c >> 8) & 0xFF} ${(c >> 16) & 0xFF})` }} />)}
    </div>
  );
};

render(<App />, document.body);

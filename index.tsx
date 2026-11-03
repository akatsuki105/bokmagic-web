import { FunctionComponent, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as gba from "./gba.ts";

const GAME_IDS = ["U32J", "U32J_rev1", "U33J"] as const;
type gameid = typeof GAME_IDS[number];

// check function to ensure gameID satisfies the type gameid
const isSupportedGameID = (id: string): id is gameid => {
  return GAME_IDS.includes(id as typeof GAME_IDS[number]);
};

type ROMFile = {
  name: string; // filename
  id: gameid;
  data: DataView; // file data
};

const App = () => {
  const [rom, setRom] = useState<ROMFile | null>(null);
  return (
    <div>
      <h1>bokmagic-web</h1>
      <ROMUpload setRom={setRom} />
    </div>
  );
};

const ROMUpload: FunctionComponent<{ setRom: (rom: ROMFile) => void }> = ({ setRom }) => {
  const [busy, setBusy] = useState(false);

  const handleFiles = async (event: Event) => {
    setBusy(true);
    try {
      const input = event.target as HTMLInputElement;
      if (input.files) {
        const file = input.files[0];
        const rom = LoadROM(file.name, await file.arrayBuffer());
        setRom(rom);
      }
    } catch (e) {
      console.error("Error loading ROM:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label for="rom-file">Choose ROM</label>
      <input type="file" id="rom-file" accept=".gba" onChange={handleFiles} disabled={busy} />
    </div>
  );
};

const LoadROM = (filename: string, data: ArrayBufferLike): ROMFile => {
  const dv = new DataView(data);
  const gameID = gba.getGameID(dv);
  if (!isSupportedGameID(gameID)) {
    throw new Error(`Unsupported gameID: ${gameID}`);
  }
  return {
    name: filename,
    id: gameID,
    data: new DataView(data),
  };
};

const usePrevious = (value: any) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
};

render(<App />, document.body);

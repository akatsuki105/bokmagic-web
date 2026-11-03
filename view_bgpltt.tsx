// BG パレット (DIR_BGPLTT) のタブ, 1ファイルに16色 × 16本

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { type BgPlttFile, parseBgPlttFiles } from "./bgpltt.ts";
import { BGPLTT_REFS } from "./generated/bgpltt_refs.ts";
import { decomp } from "./decomp.ts";
import { bgpLabel, ColorTable, NumberStepper, Swatches } from "./components.tsx";

export const BgPaletteViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const files = useMemo(() => parseBgPlttFiles(rom.data, rom.fs), [rom]);
  const [selected, setSelected] = useState<BgPlttFile>(files[0]);

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {files.map((f) => (
          <li key={f.id} class={f === selected ? "selected" : ""} onClick={() => setSelected(f)} title={decomp(BGPLTT_REFS)[f.id]}>
            {bgpLabel(f.id, false)}
          </li>
        ))}
      </ul>
      <BgPaletteView key={selected.id} file={selected} />
    </div>
  );
};

const BgPaletteView: FunctionComponent<{ file: BgPlttFile }> = ({ file }) => {
  const [row, setRow] = useState(0);
  const refs = decomp(BGPLTT_REFS)[file.id];

  return (
    <div class="sprite-view">
      <h2>{bgpLabel(file.id)}</h2>
      <p class="mono">header: {[...file.header].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}</p>
      <p class="anim-refs">{refs ? `read at ${refs}` : "ソース中で定数として読まれている箇所は見つかっていません"}</p>
      <div class="bgpltt-grid">
        {Array.from({ length: 16 }, (_, r) => (
          <div key={r} class={r === row ? "pltt-row selected" : "pltt-row"} onClick={() => setRow(r)}>
            <span>{r}</span>
            <Swatches colors={file.colors} start={r * 16} />
          </div>
        ))}
      </div>
      <div class="controls">
        <NumberStepper label="palette" value={row} min={0} max={15} onChange={setRow} />
      </div>
      <ColorTable raw={file.raw} colors={file.colors} start={row * 16} note0={row === 0 ? "BG では透明, 0 本目の色0 は背景色" : "BG では透明"} />
    </div>
  );
};

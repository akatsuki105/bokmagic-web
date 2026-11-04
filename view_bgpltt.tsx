// BG パレット (DIR_BGPLTT) のタブ, 1ファイルに16色 × 16本

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { type BgPlttFile, parseBgPlttFiles } from "./bgpltt.ts";
import { BGPLTT_REFS } from "./generated/bgpltt_refs.ts";
import { decomp } from "./decomp.ts";
import { bgpDesc, bgpLabel, ColorTable, Desc, hashID, hex4, InfoTable, NumberStepper, Swatches, useHashID } from "./components.tsx";

export const bgplttHref = (id: number) => `#bgpltt/${hex4(id)}`;

export const BgPaletteViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const files = useMemo(() => parseBgPlttFiles(rom.data, rom.fs), [rom]);
  const byID = (id: number | undefined) => files.find((f) => f.id === id);
  const [selected, setSelected] = useState<BgPlttFile>(byID(hashID("bgpltt")) ?? files[0]);
  useHashID("bgpltt", (id) => {
    const f = byID(id);
    if (f) setSelected(f);
  });

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {files.map((f) => (
          <li key={f.id} class={f === selected ? "selected" : ""} title={decomp(BGPLTT_REFS)[f.id]}>
            <a href={bgplttHref(f.id)}>{bgpLabel(f.id, false)}</a>
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
      <h2>{bgpLabel(file.id, false)}</h2>
      <Desc text={bgpDesc(file.id)} />
      <div class="controls">
        <NumberStepper label="palette" value={row} min={0} max={15} onChange={setRow} />
      </div>
      <div class="bgpltt-grid">
        {Array.from({ length: 16 }, (_, r) => (
          <div key={r} class={r === row ? "pltt-row selected" : "pltt-row"} onClick={() => setRow(r)}>
            <span>{r}</span>
            <Swatches colors={file.colors} start={r * 16} />
          </div>
        ))}
      </div>
      <ColorTable raw={file.raw} colors={file.colors} start={row * 16} note0={row === 0 ? "BG では透明, 0 本目の色0 は背景色" : "BG では透明"} />
      <InfoTable
        rows={[
          ["header", <span key="v" class="mono">{[...file.header].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}</span>],
          ["read at", refs ?? <span key="v" class="dim">ソース中で定数として読まれている箇所は見つかっていません</span>],
        ]}
      />
    </div>
  );
};

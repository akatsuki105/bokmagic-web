// BG パレット (DIR_BGPLTT) のタブ, 1ファイルに16色 × 16本

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { isSupported, type ROMFile } from "./rom.ts";
import { mapEntries } from "./analysis.ts";
import { type BgPlttFile, parseBgPlttFiles } from "./bgpltt.ts";
import { BGPLTT_REFS } from "./generated/bgpltt_refs.ts";
import { decomp } from "./decomp.ts";
import { AssetView, bgpDesc, bgpLabel, Card, ColorTable, hashID, hex4, InfoTable, MapLink, StageTitle, Swatches, UsedByCard, useHashID, type UseRef } from "./components.tsx";

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
      <BgPaletteView key={selected.id} rom={rom} file={selected} />
    </div>
  );
};

// 16 本の使い分け (ゲーム側, docs/rom/palette.md). [短い名前, 説明]
const rowUse = (r: number): [string, string] => r <= 12 ? ["マップ", "0–12 本目: マップのパレット (MapPltt_BuildWeather, MapPltt_Fill)"] : r === 13 ? ["メニュー, UI", "13 本目: メニュー (BgPlttRow13). 13–15 本目は画面ごとの UI にも使う"] : r === 14 ? ["UI, フォント", "14 本目: 画面ごとの UI, フォント (Font_SetPltt)"] : ["UI, フォント, メッセージ", "15 本目: 画面ごとの UI, フォント (文字は 15 本目で描く), メッセージウィンドウ (MessageWindow_UploadBgPltt)"];

// このパレットを使うもの: スクリプトでパレットに指定している Map (Entity4AE5 の '.p') と Font
const FONT_PLTTS = [0x529C, 0x539C];

const BgPaletteView: FunctionComponent<{ rom: ROMFile; file: BgPlttFile }> = ({ rom, file }) => {
  const [row, setRow] = useState(0);
  const refs = decomp(BGPLTT_REFS)[file.id];
  const scripted = isSupported(rom, "script");
  const maps = useMemo(() => (scripted ? mapEntries(rom).filter((e) => e.pltts.some((c) => (c.args.p ?? []).includes(file.id))) : []), [rom, file]);

  return (
    <AssetView
      title={bgpLabel(file.id, false)}
      desc={bgpDesc(file.id)}
      stage={
        <>
          <div class="bgpltt-grid">
            {Array.from({ length: 16 }, (_, r) => (
              <div key={r} class={r === row ? "pltt-row selected" : "pltt-row"} onClick={() => setRow(r)} title={rowUse(r)[1]}>
                <span>{r}</span>
                <Swatches colors={file.colors} start={r * 16} />
                <span class="row-use">{rowUse(r)[0]}</span>
              </div>
            ))}
          </div>
          <StageTitle>{row} 本目の色</StageTitle>
          <ColorTable raw={file.raw} colors={file.colors} start={row * 16} note0={row === 0 ? "BG では透明, 0 本目の色0 は背景色" : "BG では透明"} />
        </>
      }
    >
      <Card title="Metadata">
        <InfoTable
          rows={[
            ["header", <span key="v" class="mono">{[...file.header].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}</span>, "20 バイト. 読む所は見つかっておらず、意味は分かっていない"],
          ]}
        />
      </Card>
      <UsedByCard
        refs={[
          ...(FONT_PLTTS.includes(file.id) ? [{ key: "font", kind: "Font", link: <a href="#font">Font_SetPltt({FONT_PLTTS.indexOf(file.id)})</a> }] : []),
          ...maps.map((e): UseRef => ({ key: `m${e.root}`, kind: "Map", link: <MapLink root={e.root} stage={e.stage} /> })),
          ...(refs ? refs.split(", ").map((r): UseRef => ({ key: `s${r}`, kind: "Source", link: r, title: "decomp のソースで、このファイルを定数で読んでいる所" })) : []),
        ]}
        tip="スクリプトでパレットに指定している Map (Entity4AE5 の '.p'), フォント (Font_SetPltt), decomp のソースで定数で読んでいる所. 定数で書かれていない指定は見つからない"
        empty={scripted ? "定数で指定している所は見つかっていない" : "この ROM のスクリプトは読めないので探していない"}
      />
    </AssetView>
  );
};

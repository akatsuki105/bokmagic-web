// OBJ パレット (DIR_OBJPLTT, gObjPlttData) のタブ

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { DIR_MAIN_SPRITE } from "./fs.ts";
import type { ObjPltt } from "./objpltt.ts";
import type { ROMFile } from "./rom.ts";
import { parseMainSprite } from "./sprite_main.ts";
import { parseAuxSprites } from "./sprite_aux.ts";
import { ColorTable, hex4, InfoTable, NumberStepper, Swatches } from "./components.tsx";
import { SPRITE_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import { mainSpriteHref } from "./view_main.tsx";
import { auxSpriteHref } from "./view_aux.tsx";

// パレットを使うスプライト
type User = { kind: "main" | "aux"; id: number };

const spriteName = (id: number) => decomp(SPRITE_NAMES)[id]?.[0] ?? hex4(id);
const userHref = (u: User) => (u.kind === "main" ? mainSpriteHref(u.id) : auxSpriteHref(u.id));

// plttID -> そのパレットを既定で使うスプライト
// MainSprite: MainSpriteGfx.palStart + MainSubsprite.paletteNum, AuxSprite: Video_GetAuxSprite が当てる plttID (最初のポーズのもの)
const usersByPltt = (rom: ROMFile): Map<number, User[]> => {
  const users = new Map<number, User[]>();
  const add = (id: number, u: User) => {
    const list = users.get(id) ?? [];
    users.set(id, list);
    if (!list.some((v) => v.kind === u.kind && v.id === u.id)) list.push(u);
  };
  for (const f of rom.fs.list(DIR_MAIN_SPRITE)) {
    const gfx = parseMainSprite(rom.data, f.offset);
    const nums = new Set(gfx.poses.flatMap((p) => p.subsprites.map((s) => s.paletteNum)));
    for (const n of nums) add(gfx.palStart + n, { kind: "main", id: f.id });
  }
  for (const gfx of parseAuxSprites(rom.data, rom.fs)) {
    add(gfx.plttID, { kind: "aux", id: gfx.id });
  }
  return users;
};

export const ObjPaletteViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const pltt = rom.objPltt;
  const users = useMemo(() => usersByPltt(rom), [rom]);
  const [selected, setSelected] = useState(0);

  return (
    <div class="viewer">
      <ul class="sprite-list pltt-list">
        {Array.from({ length: pltt.length }, (_, id) => (
          <li key={id} class={id === selected ? "selected" : ""} onClick={() => setSelected(id)} title={users.get(id)?.map((u) => spriteName(u.id)).join("\n")}>
            <span class={users.has(id) ? "pltt-id used" : "pltt-id"}>{id}</span>
            <Swatches colors={pltt.colors} start={id * 16} />
          </li>
        ))}
      </ul>
      <PaletteDetail pltt={pltt} plttID={selected} users={users.get(selected) ?? []} onChange={setSelected} />
    </div>
  );
};

const PaletteDetail: FunctionComponent<{ pltt: ObjPltt; plttID: number; users: User[]; onChange: (id: number) => void }> = ({ pltt, plttID, users, onChange }) => (
  <div class="sprite-view">
    <h2>OBJ plttID {plttID}</h2>
    <div class="controls">
      <NumberStepper label="plttID" value={plttID} min={0} max={pltt.length - 1} onChange={onChange} />
    </div>
    <ColorTable raw={pltt.raw} colors={pltt.colors} start={plttID * 16} note0="OBJ では透明" />
    <InfoTable
      rows={[
        ["ObjPlttFile", `${pltt.length} palettes`],
        ["unk_02", hex4(pltt.unk_02)],
        ["offset", `${hex4(plttID * 32)} (gObjPlttData)`],
      ]}
    />
    <h3>used by</h3>
    {users.length > 0
      ? (
        <ul class="pltt-users">
          {users.map((u) => (
            <li key={`${u.kind}${u.id}`}>
              <a href={userHref(u)}>{spriteName(u.id)}</a>
            </li>
          ))}
        </ul>
      )
      : <p>スプライトの既定のパレットとしては使われていません (ゲーム中で plttID を指定して使うものはここに出ません)</p>}
  </div>
);

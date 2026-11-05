// OBJ パレット (DIR_OBJPLTT, gObjPlttData) のタブ

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { DIR_MAIN_SPRITE } from "./fs.ts";
import type { ObjPltt } from "./objpltt.ts";
import type { ROMFile } from "./rom.ts";
import { parseMainSprite } from "./sprite_main.ts";
import { parseAuxSprites } from "./sprite_aux.ts";
import { parseParticleFiles } from "./particle.ts";
import { PARTICLE_GROUP_NAMES, PARTICLE_PLTT_REFS } from "./generated/particle_refs.ts";
import { AssetView, Card, ColorTable, Field, Fields, hex4, InfoTable, NumberStepper, Swatches, UsedByCard } from "./components.tsx";
import { SPRITE_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import { mainSpriteHref } from "./view_main.tsx";
import { auxSpriteHref } from "./view_aux.tsx";

// パレットを使うもの. how は使い方 (既定の値か, ソースで指定しているか)
type User = { kind: "main" | "aux" | "particle"; id: number; how?: string };

const KIND_LABELS = { main: "MainSprite", aux: "AuxSprite", particle: "Particle" } as const;
const spriteName = (id: number) => decomp(SPRITE_NAMES)[id]?.[0] ?? hex4(id);
const userName = (u: User) => (u.kind === "particle" ? decomp(PARTICLE_GROUP_NAMES)[u.id]?.[0] ?? hex4(u.id) : spriteName(u.id));
const userHref = (u: User) => (u.kind === "main" ? mainSpriteHref(u.id) : u.kind === "aux" ? auxSpriteHref(u.id) : "#particle");

// plttID -> そのパレットを使うもの
// MainSprite: MainSpriteGfx.palStart + MainSubsprite.paletteNum, AuxSprite: Video_GetAuxSprite が当てる plttID (最初のポーズのもの)
// Particle: グループの既定の plttID と、ソースの Particle_SetPltt で渡している値 (PARTICLE_PLTT_REFS)
// 実行時の差し替え (Video_SetAuxSpritePltt など) は含まない
const usersByPltt = (rom: ROMFile): Map<number, User[]> => {
  const users = new Map<number, User[]>();
  const add = (id: number, u: User) => {
    const list = users.get(id) ?? [];
    users.set(id, list);
    if (!list.some((v) => v.kind === u.kind && v.id === u.id && v.how === u.how)) list.push(u);
  };
  for (const f of rom.fs.list(DIR_MAIN_SPRITE)) {
    const gfx = parseMainSprite(rom.data, f.offset);
    const nums = new Set(gfx.poses.flatMap((p) => p.subsprites.map((s) => s.paletteNum)));
    for (const n of nums) add(gfx.palStart + n, { kind: "main", id: f.id });
  }
  for (const gfx of parseAuxSprites(rom.data, rom.fs)) {
    add(gfx.plttID, { kind: "aux", id: gfx.id });
  }
  for (const f of parseParticleFiles(rom.data, rom.fs)) {
    for (const g of f.groups) {
      add(g.plttID, { kind: "particle", id: g.id, how: "既定" });
      for (const [id, where] of decomp(PARTICLE_PLTT_REFS)[g.id] ?? []) add(id, { kind: "particle", id: g.id, how: `Particle_SetPltt (${where})` });
    }
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
          <li key={id} class={id === selected ? "selected" : ""} onClick={() => setSelected(id)} title={users.get(id)?.map(userName).join("\n")}>
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
  <AssetView title={`plttID ${plttID}`} stage={<ColorTable raw={pltt.raw} colors={pltt.colors} start={plttID * 16} note0="OBJ では透明" />}>
    <Card title="表示">
      <Fields>
        <Field label="パレット" title="plttID">
          <NumberStepper value={plttID} min={0} max={pltt.length - 1} onChange={onChange} />
          <span class="note">/ {pltt.length}</span>
        </Field>
      </Fields>
    </Card>
    <Card title="Metadata">
      <InfoTable
        rows={[
          ["offset", `${hex4(plttID * 32)} バイト`, "gObjPlttData の先頭から (ファイルの先頭からなら +4)"],
        ]}
      />
    </Card>
    <Card title="ファイル">
      <InfoTable
        rows={[
          ["length", `${pltt.length} 本`, "16 色のパレットの本数"],
          ["unk_02", hex4(pltt.unk_02), "読む所が見つかっておらず、意味は分かっていない"],
        ]}
      />
    </Card>
    <UsedByCard
      refs={users.map((u) => ({
        key: `${u.kind}${u.id}${u.how ?? ""}`,
        kind: KIND_LABELS[u.kind],
        link: <a href={userHref(u)}>{userName(u)}</a>,
        detail: u.how && u.how !== "既定" ? "ソースで指定" : undefined,
        title: u.how,
      }))}
      tip="MainSprite は palStart + サブスプライトの paletteNum, AuxSprite は最初のポーズの plttID, Particle は既定の plttID とソースで渡している値. 実行時の差し替えは含まない"
      empty="スプライトとパーティクルの既定のパレットとしては使われていない"
    />
  </AssetView>
);

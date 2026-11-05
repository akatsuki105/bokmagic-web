// パーティクル (DIR_PARTICLE) のタブ, グループのポーズの表示と AuxAnimFile によるアニメ再生

import { FunctionComponent } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";
import type { ObjPltt } from "./objpltt.ts";
import type { ROMFile } from "./rom.ts";
import { parseParticleFiles, type ParticleFile, type ParticleGroup, particlePoseObjs, PGFLAG_BPP8 } from "./particle.ts";
import { type AuxAnimFile, parseAuxAnimFiles } from "./anim_aux.ts";
import { OBJ_SIZE, renderObjs } from "./render.ts";
import { AuxAnimPanel } from "./view_aux.tsx";
import { PARTICLE_ANIM_REFS, PARTICLE_GROUP_NAMES, PARTICLE_PLTT_REFS, PARTICLE_POSE_NAMES } from "./generated/particle_refs.ts";
import { decomp } from "./decomp.ts";
import { AssetView, Card, Check, Field, Fields, hex4, type InfoRow, InfoTable, PaletteRow, PlttControl, PoseGrid, Slider, SpriteCanvas, StageTitle } from "./components.tsx";

const groupLabel = (id: number, withDesc = true) => {
  const name = decomp(PARTICLE_GROUP_NAMES)[id];
  if (!name) return hex4(id);
  return withDesc && name[1] ? `${hex4(id)} ${name[0]} ${name[1]}` : `${hex4(id)} ${name[0]}`;
};

const poseName = (g: ParticleGroup, i: number) => decomp(PARTICLE_POSE_NAMES)[g.id]?.[i];

export const ParticleViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const files = useMemo(() => parseParticleFiles(rom.data, rom.fs), [rom]);
  const animFiles = useMemo(() => parseAuxAnimFiles(rom.data, rom.fs), [rom]);
  const [sel, setSel] = useState<[number, number]>([0, 0]); // [ファイル, グループ]
  const file = files[sel[0]];
  const group = file.groups[sel[1]];

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {files.flatMap((f, fi) =>
          f.groups.map((g, gi) => (
            <li key={`${fi}.${gi}`} class={fi === sel[0] && gi === sel[1] ? "selected" : ""} onClick={() => setSel([fi, gi])}>
              {groupLabel(g.id, false)}
            </li>
          ))
        )}
      </ul>
      <ParticleView key={`${file.id}.${group.id}`} file={file} group={group} pltt={rom.objPltt} animFiles={animFiles} />
    </div>
  );
};

const ParticleView: FunctionComponent<{ file: ParticleFile; group: ParticleGroup; pltt: ObjPltt; animFiles: AuxAnimFile[] }> = ({ file, group, pltt, animFiles }) => {
  const plttRefs = decomp(PARTICLE_PLTT_REFS)[group.id] ?? [];
  const [poseIdx, setPoseIdx] = useState(0);
  const [plttID, setPlttID] = useState(group.plttID);
  const [scale, setScale] = useState(4);
  const [xflip, setXflip] = useState(false);
  const [yflip, setYflip] = useState(false);
  const [animActive, setAnimActive] = useState(false);

  const colors = useMemo(() => pltt.colors.subarray(plttID * 16, plttID * 16 + 16), [pltt, plttID]);
  const rendered = useMemo(() => renderObjs(particlePoseObjs(file, group, poseIdx, colors, xflip, yflip)), [file, group, poseIdx, colors, xflip, yflip]);
  const renderThumb = useCallback((i: number) => renderObjs(particlePoseObjs(file, group, i, colors)), [file, group, colors]);
  const [w, h] = OBJ_SIZE[group.shape] ?? [8, 8];
  const name = poseName(group, poseIdx);

  const setPose = (i: number) => {
    setAnimActive(false);
    setPoseIdx(i);
  };

  return (
    <AssetView
      title={groupLabel(group.id, false)}
      desc={decomp(PARTICLE_GROUP_NAMES)[group.id]?.[1]}
      stage={
        <>
          <SpriteCanvas rendered={rendered} scale={scale} />
          <div class="pltts">
            <PaletteRow pltt={pltt} plttID={plttID} />
          </div>
          <StageTitle tip={`次のグループの先頭までのコマ数 (推定). ファイルの終わりまでなら ${group.poseLimit}`}>ポーズ ({group.poseCount})</StageTitle>
          <PoseGrid count={group.poseCount} selected={poseIdx} onSelect={setPose} render={renderThumb} />
        </>
      }
    >
      <Card title="表示">
        <Fields>
          <Field label="ポーズ">
            <Slider value={poseIdx} min={0} max={group.poseLimit - 1} onChange={setPose} format={(v) => `${v} / ${group.poseCount - 1}`} stepButtons />
          </Field>
          <Field label="パレット" title="plttID (OBJ パレットの番号)">
            <PlttControl value={plttID} defaultValue={group.plttID} pltt={pltt} onChange={setPlttID} />
          </Field>
          {plttRefs.length > 0 && (
            <Field label="ソースの指定">
              {plttRefs.map(([id, where]) => (
                <button type="button" key={id} class={id === plttID ? "selected" : ""} title={`Particle_SetPltt: ${where}`} onClick={() => setPlttID(id)}>
                  plttID {id}
                </button>
              ))}
            </Field>
          )}
          <Field label="拡大">
            <Slider value={scale} min={1} max={8} onChange={setScale} format={(v) => `${v}x`} />
          </Field>
          <Field label="反転">
            <Check checked={xflip} disabled={animActive} onChange={setXflip}>左右</Check>
            <Check checked={yflip} disabled={animActive} onChange={setYflip}>上下</Check>
          </Field>
        </Fields>
      </Card>
      <AuxAnimPanel
        refs={decomp(PARTICLE_ANIM_REFS)[group.id] ?? []}
        poseCount={group.poseCount}
        poseLimit={group.poseLimit}
        particle
        animFiles={animFiles}
        active={animActive}
        setActive={setAnimActive}
        onPose={(i, x, y) => {
          setPoseIdx(i);
          setXflip(x);
          setYflip(y);
        }}
      />
      <Card title={`コマ ${poseIdx}${poseIdx >= group.poseCount ? " (後ろのグループのもの)" : ""}`}>
        <InfoTable
          rows={[
            ["tile", poseIdx * (w / 8) * (h / 8) + group.tile, "OBJ VRAM のタイル番号 (コマ番号 × 1 コマのタイル数 + グループの先頭)"],
            ...(name ? [["name", name[1] ? `${name[0]} (${name[1]})` : name[0]] as InfoRow] : []),
          ]}
        />
      </Card>
      <Card title="Metadata">
        <InfoTable
          rows={[
            ["size", `${w}x${h} px, ${group.flags & PGFLAG_BPP8 ? "8bpp" : "4bpp"}`, "1 コマ = OBJ 1 枚の大きさ (shape)"],
            ["tile", group.tile, "先頭のコマの OBJ VRAM のタイル番号"],
            ["plttID", group.plttID, "Particle_Add が当てる既定のパレット"],
            ["file", hex4(file.id)],
          ]}
        />
      </Card>
    </AssetView>
  );
};

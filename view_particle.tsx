// パーティクル (DIR_PARTICLE) のタブ, グループのポーズの表示と AuxAnimFile によるアニメ再生

import { FunctionComponent } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";
import type { ObjPltt } from "./objpltt.ts";
import type { ROMFile } from "./rom.ts";
import { parseParticleFiles, type ParticleFile, type ParticleGroup, particlePoseObjs, PGFLAG_BPP8 } from "./particle.ts";
import { type AuxAnimFile, parseAuxAnimFiles } from "./anim_aux.ts";
import { OBJ_SIZE, renderObjs } from "./render.ts";
import { AuxAnimPanel } from "./view_aux.tsx";
import { PARTICLE_ANIM_REFS, PARTICLE_GROUP_NAMES, PARTICLE_PLTT_REFS, PARTICLE_POSE_NAMES } from "./particle_refs.ts";
import { hex4, NumberStepper, PaletteRow, PlttControl, PoseGrid, SpriteCanvas } from "./components.tsx";

const groupLabel = (id: number, withDesc = true) => {
  const name = PARTICLE_GROUP_NAMES[id];
  if (!name) return hex4(id);
  return withDesc && name[1] ? `${hex4(id)} ${name[0]} ${name[1]}` : `${hex4(id)} ${name[0]}`;
};

const poseName = (g: ParticleGroup, i: number) => PARTICLE_POSE_NAMES[g.id]?.[i];

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
  const plttRefs = PARTICLE_PLTT_REFS[group.id] ?? [];
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
    <div class="sprite-view">
      <h2>{groupLabel(group.id)}</h2>
      <p>
        file {hex4(file.id)}, size: {w}x{h}, {group.flags & PGFLAG_BPP8 ? "8bpp" : "4bpp"}, tile: {group.tile}, poses: {group.poseCount} (+{group.poseLimit - group.poseCount} after this group), plttID: {group.plttID}
      </p>
      <div class="controls">
        <NumberStepper label="pose" value={poseIdx} min={0} max={group.poseLimit - 1} onChange={setPose} />
        <PlttControl value={plttID} defaultValue={group.plttID} pltt={pltt} onChange={setPlttID} />
        {plttRefs.map(([id, where]) => (
          <button type="button" key={id} title={`Particle_SetPltt: ${where}`} onClick={() => setPlttID(id)}>
            plttID {id} (ソース)
          </button>
        ))}
        <label>
          scale <input type="number" min={1} max={8} value={scale} onInput={(e) => setScale(Number(e.currentTarget.value))} />
        </label>
        <label>
          <input type="checkbox" checked={xflip} disabled={animActive} onChange={(e) => setXflip(e.currentTarget.checked)} /> xflip
        </label>
        <label>
          <input type="checkbox" checked={yflip} disabled={animActive} onChange={(e) => setYflip(e.currentTarget.checked)} /> yflip
        </label>
      </div>
      <p>
        pose {poseIdx}: tile {poseIdx * (w / 8) * (h / 8) + group.tile}
        {name && ` ${name[0]}`}
        {name?.[1] && ` (${name[1]})`}
        {poseIdx >= group.poseCount && " (後ろのグループのタイル)"}
      </p>
      <AuxAnimPanel
        refs={PARTICLE_ANIM_REFS[group.id] ?? []}
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
      <SpriteCanvas rendered={rendered} scale={scale} />
      <div class="pltts">
        <PaletteRow pltt={pltt} plttID={plttID} />
      </div>
      <PoseGrid count={group.poseCount} selected={poseIdx} onSelect={setPose} render={renderThumb} />
    </div>
  );
};

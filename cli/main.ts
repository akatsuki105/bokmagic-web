// bokmagic-web のコマンドライン版: ROM のアセットの情報を JSON で出し、画像を PNG に書き出す
// decomp 側のエージェントなどがブラウザを使わずにアセットを確かめるためのもの. 使い方は docs/cli.md
// deno task cli:bundle で dist/bokmagic.js の 1 ファイルにまとめ、GitHub Pages に画面と一緒に公開する (.github/workflows/pages.yml)
//   deno run --allow-read --allow-write https://akatsuki105.github.io/bokmagic-web/bokmagic.js <rom.gba> <command> ...
// のように URL から直接動かす

import { isSupported, LoadROM, type ROMFile } from "../rom.ts";
import { DIR_MAIN_SPRITE } from "../fs.ts";
import { decomp, setDecompGame } from "../decomp.ts";
import { MAIN_SPRITE_SHEET_TILES, parseMainSprite, poseToObjs } from "../sprite_main.ts";
import { auxPoseToObjs, parseAuxSprites } from "../sprite_aux.ts";
import { GRAYSCALE_PLTT, newPixels, type Pixels, type Rendered, renderObjs } from "../render.ts";
import { parseTilemap, putTiles, renderComposite, renderLayers, type Tilemap, tilemapFiles, VRAM_TILES } from "../tilemap.ts";
import { parseTileSets, partTiles } from "../tileset.ts";
import { parseBgPlttFiles } from "../bgpltt.ts";
import { callBGs, mapEntries, type MapEntry } from "../analysis.ts";
import { buildScene, slotSource } from "../map.ts";
import { SCRIPT_NAMES, SPRITE_NAMES, STAGE_NAMES, TILEMAP_NAMES } from "../generated/names.ts";
import { encodePNG, scalePixels } from "./png.ts";

const USAGE = `usage: bokmagic <rom.gba> <command> [target] [options]

commands:
  list <sprite|aux|tilemap|map>   一覧を JSON で出す
  sprite <ID|SPRITE_*>            MainSprite の情報を JSON で出す
  aux <ID|SPRITE_*>               AuxSprite の情報を JSON で出す
  tilemap <ID|TILEMAP_*>          タイルマップの情報を JSON で出す
  map <ScriptID|Scr_*>         マップ (マップを読み込むスクリプト) の情報を JSON で出す

options:
  -o, --out <file.png>   画像を PNG で書き出す
  --scale <n>            拡大率 (既定 1)
  --pose <n>             sprite, aux: ポーズ番号 (既定 0)
  --sheet                sprite, aux: 全ポーズを並べた 1 枚にする
  --pltt <n>             sprite, aux: plttID (既定はスプライトの既定値) / tilemap, map: BG パレットのファイルID
  --xflip, --yflip       sprite, aux: 反転
  --layers <a,b,...>     tilemap: 描くレイヤ番号 (既定は全部, 番号の小さい方が奥)
  --part <n>             tilemap: タイルの読み込み元にするタイルセット部品の番号 (#n)
  --set <n>              tilemap: --part の部品を探すタイルセットの番号 (既定 0. U3IJ はタイルセットが 11 個ある)
  --scene <n>            map: 場面の番号 (既定 0)
  --hide-bg <a,b,...>    map: 描かない BG 番号

ID は 0x5D36 のような16進数. U32J (rev1, rev0) では decomp の定数名 (SPRITE_SHADEMAN, TILEMAP_7DB3, Scr_0x02BF など) も使える`;

class UsageError extends Error {}

const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;

// ---- 引数 ----

type Options = Record<string, string | boolean>;
const FLAGS = new Set(["sheet", "xflip", "yflip"]);

const parseArgs = (args: string[]): { positional: string[]; opts: Options } => {
  const positional: string[] = [];
  const opts: Options = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o") opts.out = args[++i];
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      if (FLAGS.has(key)) opts[key] = true;
      else {
        if (i + 1 >= args.length) throw new UsageError(`${a} には値が要る`);
        opts[key] = args[++i];
      }
    } else positional.push(a);
  }
  return { positional, opts };
};

const num = (v: string | boolean | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined;
  const n = typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n)) throw new UsageError(`--${name} は整数`);
  return n;
};

const list = (v: string | boolean | undefined): number[] | undefined => typeof v === "string" ? v.split(",").map((s) => Number(s)) : undefined;

// 16進数 (0x...), 10進数, または decomp の定数名
const resolveID = (target: string | undefined, names: Record<number, [string, string]>, what: string): number => {
  if (!target) throw new UsageError(`${what} の ID を指定する`);
  if (/^(0x[0-9a-f]+|\d+)$/i.test(target)) return Number(target);
  const script = target.match(/^Scr_0x([0-9a-f]+)$/i);
  if (script) return parseInt(script[1], 16);
  const found = Object.entries(decomp(names)).find(([, [name]]) => name === target);
  if (!found) throw new UsageError(`${what} "${target}" が見つからない (定数名は U32J (rev1, rev0) でだけ使える)`);
  return Number(found[0]);
};

const nameOf = (names: Record<number, [string, string]>, id: number) => {
  const n = decomp(names)[id];
  return n ? { name: n[0], desc: n[1] || undefined } : {};
};

// ---- 画像 ----

const writePNG = async (img: Pixels, opts: Options): Promise<string | undefined> => {
  if (typeof opts.out !== "string") return undefined;
  await Deno.writeFile(opts.out, await encodePNG(scalePixels(img, num(opts.scale, "scale") ?? 1)));
  return opts.out;
};

// 画像を cols 列に並べる (セルは一番大きい画像に合わせる)
const grid = (images: Rendered[], cols: number): Pixels => {
  const cw = Math.max(1, ...images.map((r) => r.image.width)), ch = Math.max(1, ...images.map((r) => r.image.height));
  const rows = Math.max(1, Math.ceil(images.length / cols));
  const out = newPixels(cw * Math.min(cols, Math.max(1, images.length)), ch * rows);
  const dst = new Uint32Array(out.data.buffer);
  images.forEach(({ image }, i) => {
    const src = new Uint32Array(image.data.buffer);
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
    for (let y = 0; y < image.height; y++) dst.set(src.subarray(y * image.width, (y + 1) * image.width), (oy + y) * out.width + ox);
  });
  return out;
};

// ---- コマンド ----

const listCmd = (rom: ROMFile, kind: string | undefined) => {
  switch (kind) {
    case "sprite":
      return rom.fs.list(DIR_MAIN_SPRITE).map((f) => ({ id: hex4(f.id), ...nameOf(SPRITE_NAMES, f.id) }));
    case "aux":
      return parseAuxSprites(rom.data, rom.fs).map((g) => ({ id: hex4(g.id), ...nameOf(SPRITE_NAMES, g.id) }));
    case "tilemap":
      return tilemapFiles(rom.fs).map((f) => ({ id: hex4(f.id), ...nameOf(TILEMAP_NAMES, f.id) }));
    case "map":
      return mapEntries(rom).map((e) => mapSummary(e));
    default:
      throw new UsageError("list の後に sprite / aux / tilemap / map のどれかを指定する");
  }
};

const spriteCmd = async (rom: ROMFile, target: string | undefined, opts: Options) => {
  const id = resolveID(target, SPRITE_NAMES, "MainSprite");
  const f = rom.fs.list(DIR_MAIN_SPRITE).find((f) => f.id === id);
  if (!f) throw new UsageError(`MainSprite ${hex4(id)} が無い`);
  const gfx = parseMainSprite(rom.data, f.offset);
  const pltt = num(opts.pltt, "pltt") ?? gfx.palStart;
  const poseIdx = num(opts.pose, "pose") ?? 0;
  const pose = gfx.poses[poseIdx];
  if (!pose) throw new UsageError(`ポーズ ${poseIdx} が無い (0-${gfx.poses.length - 1})`);
  const render = (i: number) => renderObjs(poseToObjs(gfx, i, rom.objPltt.colors, pltt, opts.xflip === true, opts.yflip === true));
  const rendered = render(poseIdx);
  const png = await writePNG(opts.sheet ? grid(gfx.poses.map((_, i) => render(i)), 8) : rendered.image, opts);
  return {
    id: hex4(id),
    ...nameOf(SPRITE_NAMES, id),
    poses: gfx.poses.length,
    anims: gfx.anims.length,
    tiles: gfx.tiles.length / 32,
    sheetWidthTiles: MAIN_SPRITE_SHEET_TILES,
    palStart: gfx.palStart,
    plttID: pltt,
    pose: {
      index: poseIdx,
      unk_0: hex4(pose.unk_0),
      offset: [pose.offsetX, pose.offsetY],
      box: pose.box,
      subsprites: pose.subsprites,
      image: { width: rendered.image.width, height: rendered.image.height, originX: rendered.originX, originY: rendered.originY },
    },
    png,
  };
};

const auxCmd = async (rom: ROMFile, target: string | undefined, opts: Options) => {
  const id = resolveID(target, SPRITE_NAMES, "AuxSprite");
  const gfx = parseAuxSprites(rom.data, rom.fs).find((g) => g.id === id);
  if (!gfx) throw new UsageError(`AuxSprite ${hex4(id)} が無い`);
  const pltt = num(opts.pltt, "pltt") ?? gfx.plttID;
  const poseIdx = num(opts.pose, "pose") ?? 0;
  const pose = gfx.poses[poseIdx];
  if (!pose) throw new UsageError(`ポーズ ${poseIdx} が無い (0-${gfx.poses.length - 1})`);
  const render = (i: number) => renderObjs(auxPoseToObjs(gfx, i, rom.objPltt.colors, pltt, opts.xflip === true, opts.yflip === true));
  const rendered = render(poseIdx);
  const png = await writePNG(opts.sheet ? grid(Array.from({ length: gfx.poseCount }, (_, i) => render(i)), 8) : rendered.image, opts);
  return {
    id: hex4(id),
    ...nameOf(SPRITE_NAMES, id),
    poses: gfx.poseCount,
    posesAfterThisEntry: gfx.poses.length - gfx.poseCount,
    size: [gfx.pw, gfx.ph],
    offset: [gfx.px, gfx.py],
    defaultPlttID: gfx.plttID,
    plttID: pltt,
    pose: {
      index: poseIdx,
      ...pose,
      image: { width: rendered.image.width, height: rendered.image.height, originX: rendered.originX, originY: rendered.originY },
    },
    png,
  };
};

const bgColors = (rom: ROMFile, file: number | undefined): Uint32Array => {
  const f = file === undefined ? undefined : parseBgPlttFiles(rom.data, rom.fs).find((f) => f.id === file);
  if (file !== undefined && !f) throw new UsageError(`BG パレット ${hex4(file)} が無い`);
  return f?.colors ?? Uint32Array.from({ length: 256 }, (_, i) => GRAYSCALE_PLTT[i & 15]);
};

const firstPltt = (rom: ROMFile, e: MapEntry): number | undefined => {
  const files = new Set(parseBgPlttFiles(rom.data, rom.fs).map((f) => f.id));
  return e.pltts.flatMap((c) => c.args.p ?? []).find((p): p is number => p !== null && files.has(p));
};

const tilemapCmd = async (rom: ROMFile, target: string | undefined, opts: Options) => {
  const id = resolveID(target, TILEMAP_NAMES, "タイルマップ");
  const f = tilemapFiles(rom.fs).find((f) => f.id === id);
  if (!f) throw new UsageError(`タイルマップ ${hex4(id)} が無い`);
  const map = parseTilemap(rom.data, f);
  const sets = parseTileSets(rom.data, rom.fs, rom.id);
  const set = num(opts.set, "set") ?? 0;
  const ts = sets[set];
  if (!ts) throw new UsageError(`タイルセット #${set} が無い (0-${sets.length - 1})`);
  // スクリプトが読めない作品 (U3IJ) では、このタイルマップを使うマップを探さない
  const usedBy = isSupported(rom, "script") ? mapEntries(rom).filter((e) => e.scenes.some((s) => s.tilemaps.some((c) => c.args.d?.[0] === id))) : [];

  // タイルの読み込み元: --part, ファイル内のタイル, このタイルマップを使うマップの VRAM の順に探す
  let vram: Uint8Array = new Uint8Array(VRAM_TILES * 32);
  let source = "none";
  let pltt = num(opts.pltt, "pltt");
  const part = num(opts.part, "part");
  if (part !== undefined) {
    if (!ts.parts[part]) throw new UsageError(`タイルセット部品 #${part} が無い`);
    putTiles(vram, map.loadOffset, partTiles(ts, ts.parts[part]));
    source = `tileset ${hex4(ts.id)} part #${part} (${hex4(ts.parts[part].id)})`;
  } else if (map.tiles) {
    putTiles(vram, map.loadOffset, map.tiles);
    source = "own tiles";
  } else if (usedBy[0]) {
    const e = usedBy[0];
    const scene = e.scenes.find((s) => s.tilemaps.some((c) => c.args.d?.[0] === id))!;
    const state = buildScene(rom, scene, ts);
    const slot = state.slots.find((s) => s.map.id === id);
    if (slot) {
      vram = state.vram.subarray(slot.charBase);
      source = `map ${hex4(e.root)}`;
      pltt ??= firstPltt(rom, e);
    }
  }
  const layers = list(opts.layers) ?? map.layers.map((_, i) => i);
  for (const l of layers) if (!map.layers[l]) throw new UsageError(`レイヤ ${l} が無い (0-${map.layers.length - 1})`);
  const rendered = renderLayers(map, layers.map((l) => map.layers[l]), vram, bgColors(rom, pltt), true);
  const png = await writePNG(rendered.image, opts);
  return {
    id: hex4(id),
    ...nameOf(TILEMAP_NAMES, id),
    ...tilemapInfo(map),
    tilesSource: source,
    pltt: pltt === undefined ? "grayscale" : hex4(pltt),
    drawnLayers: layers,
    usedByMaps: usedBy.map((e) => hex4(e.root)),
    image: { width: rendered.image.width, height: rendered.image.height },
    png,
  };
};

const tilemapInfo = (map: Tilemap) => ({
  compressed: map.compressed,
  size: map.size,
  tileCount: map.tileCount,
  hasOwnTiles: map.tiles !== undefined,
  metatileCount: map.metatileCount,
  loadOffset: map.loadOffset,
  layers: map.layers.map((l, i) => ({ index: i, id: hex4(l.id), width: l.width, height: l.height })),
});

const stageInfo = (stage: number | null) => (stage === null ? null : { id: stage, ...nameOf(STAGE_NAMES, stage) });

const mapSummary = (e: MapEntry) => ({
  script: hex4(e.root),
  ...nameOf(SCRIPT_NAMES, e.root),
  stage: stageInfo(e.stage),
  scenes: e.scenes.map((s) => s.tilemaps.map((c) => ({ tilemap: c.args.d?.[0] === null || c.args.d?.[0] === undefined ? null : hex4(c.args.d[0]), bgs: callBGs(c) }))),
});

const mapCmd = async (rom: ROMFile, target: string | undefined, opts: Options) => {
  const root = resolveID(target, SCRIPT_NAMES, "マップのスクリプト");
  const e = mapEntries(rom).find((e) => e.root === root);
  if (!e) throw new UsageError(`${hex4(root)} はマップを読み込むスクリプトとして見つからない (list map で一覧を出せる)`);
  const sceneIdx = num(opts.scene, "scene") ?? 0;
  const scene = e.scenes[sceneIdx];
  if (!scene) throw new UsageError(`場面 ${sceneIdx} が無い (0-${e.scenes.length - 1})`);
  const state = buildScene(rom, scene, parseTileSets(rom.data, rom.fs, rom.id)[0]);
  const hidden = list(opts["hide-bg"]) ?? [];
  const pltt = num(opts.pltt, "pltt") ?? firstPltt(rom, e);
  const shown = state.slots.filter((s) => !hidden.includes(s.bg));
  const rendered = renderComposite(shown.map((s) => slotSource(s, state.vram)), bgColors(rom, pltt), true);
  const png = await writePNG(rendered.image, opts);
  const value = (v: number | null | undefined) => (v === null || v === undefined ? null : hex4(v));
  return {
    ...mapSummary(e),
    scene: sceneIdx,
    bgs: [...state.slots].reverse().map((s) => ({ bg: s.bg, priority: s.prio, tilemap: hex4(s.map.id), ...nameOf(TILEMAP_NAMES, s.map.id), layer: s.layer, width: s.map.layers[s.layer].width, height: s.map.layers[s.layer].height })),
    pltt: pltt === undefined ? "grayscale" : hex4(pltt),
    scriptPltts: [...new Set(e.pltts.flatMap((c) => (c.args.p ?? []).map(value)))],
    collisionMaps: [...new Set(scene.collisions.map((c) => value(c.args.p?.[0])))],
    hiddenBGs: hidden,
    image: { width: rendered.image.width, height: rendered.image.height },
    png,
  };
};

// ---- main ----

const main = async () => {
  const { positional, opts } = parseArgs(Deno.args);
  const [romPath, command, target] = positional;
  if (!romPath || !command || command === "help") throw new UsageError("");
  const rom = LoadROM(romPath.split("/").pop() ?? romPath, (await Deno.readFile(romPath)).buffer);
  setDecompGame(rom.id); // U32J (rev1, rev0) のときだけ decomp の名前を使う
  const kind = command === "list" ? target : command;
  if (kind && !isSupported(rom, kind)) throw new Error(`この ROM (${rom.id}) の ${kind} にはまだ対応していない`);
  let result: unknown;
  switch (command) {
    case "list":
      result = listCmd(rom, target);
      break;
    case "sprite":
      result = await spriteCmd(rom, target, opts);
      break;
    case "aux":
      result = await auxCmd(rom, target, opts);
      break;
    case "tilemap":
      result = await tilemapCmd(rom, target, opts);
      break;
    case "map":
      result = await mapCmd(rom, target, opts);
      break;
    default:
      throw new UsageError(`知らないコマンド: ${command}`);
  }
  console.log(JSON.stringify({ rom: rom.id, ...(Array.isArray(result) ? { items: result } : result as object) }, null, 2));
};

try {
  await main();
} catch (e) {
  if (e instanceof UsageError) {
    if (e.message) console.error(`error: ${e.message}\n`);
    console.error(USAGE);
    Deno.exit(2);
  }
  console.error(e instanceof Error ? e.message : String(e));
  Deno.exit(1);
}

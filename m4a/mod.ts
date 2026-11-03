// MP2K (m4a, いわゆる Sappy) の曲を PCM に書き出すモジュール
// このディレクトリの外のファイルは import しないので、他の GBA ゲームの解析にもそのまま持っていける
//
// 使い方:
//   const songs = readSongTable(rom, 0x0825E56C);           // 曲テーブル (gSongTable) の GBA アドレス
//   const { sampleRate, left, right } = renderSong(rom, songs[1].header);
//   Deno.writeFileSync("song.wav", encodeWav(sampleRate, left, right));
//
// それらしく鳴らす程度のもので、実機のミキサー (サンプリング周波数, リバーブ) や CGB の細かい挙動は再現していない

export * from "./data.ts";
export { type PlayerOptions, SongPlayer } from "./player.ts";
export { FRAME_RATE } from "./synth.ts";
export { type Rendered, type RenderOptions, renderSong } from "./render.ts";
export { encodeWav } from "./wav.ts";

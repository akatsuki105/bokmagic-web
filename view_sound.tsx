// 曲 (BGM, 効果音, ボイス) のタブ
// 曲テーブル (gSongTable) を読み、選んだ曲を m4a/ で PCM に書き出して WebAudio で鳴らす

import { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { encodeWav, readSongHeader, readSongTable, type Rendered, renderSong, type SongEntry } from "./m4a/mod.ts";
import { SONG_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import { Desc, hashID, hex4, InfoTable, NumberStepper, useHashID } from "./components.tsx";
import { audioOutput, useVolume } from "./audio.ts";

// gSongTable の GBA アドレス
const SONG_TABLE: Partial<Record<ROMFile["id"], number>> = {
  U32J_rev1: 0x0825E56C,
};

const songLabel = (index: number) => {
  const name = decomp(SONG_NAMES)[index];
  const num = String(index).padStart(3, "0");
  return name ? `${num} ${name[0]}` : num;
};

const hex8 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;

// 全体の音量 (アプリの上の方に出す)
export const VolumeControl: FunctionComponent = () => {
  const [volume, setVolume] = useVolume();
  return (
    <label>
      音量 <input type="range" min={0} max={1} step={0.05} value={volume} onInput={(e) => setVolume(Number(e.currentTarget.value))} />
    </label>
  );
};

export const SoundViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const table = SONG_TABLE[rom.id];
  const songs = useMemo(() => (table === undefined ? [] : readSongTable(rom.data, table)), [rom, table]);
  const empty = useMemo(() => new Set(songs.filter((s) => readSongHeader(rom.data, s.header).trackCount === 0).map((s) => s.index)), [rom, songs]);
  const [selected, setSelected] = useState<SongEntry | undefined>(songs[hashID("sound") ?? 1] ?? songs[0]);
  useHashID("sound", (id) => {
    if (songs[id]) setSelected(songs[id]);
  });
  const [repeat, setRepeat] = useState(false); // 繰り返し再生 (曲を切り替えても保つ)

  if (table === undefined) return <p>この ROM ({rom.id}) の曲テーブルの位置は分かっていません</p>;

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {songs.map((s) => (
          <li key={s.index} class={s === selected ? "selected" : ""}>
            <a href={`#sound/${hex4(s.index)}`} class={empty.has(s.index) ? "dim" : ""}>{songLabel(s.index)}</a>
          </li>
        ))}
      </ul>
      {selected && <SongView key={selected.index} rom={rom} song={selected} repeat={repeat} setRepeat={setRepeat} />}
    </div>
  );
};

const formatTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

// repeat: 書き出した PCM の最後まで来たら最初から鳴らし直す (曲データのループとは別)
const SongView: FunctionComponent<{ rom: ROMFile; song: SongEntry; repeat: boolean; setRepeat: (v: boolean) => void }> = ({ rom, song, repeat, setRepeat }) => {
  const header = useMemo(() => readSongHeader(rom.data, song.header), [rom, song]);
  const [loops, setLoops] = useState(1);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // 再生位置 (秒)
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const startRef = useRef({ at: 0, offset: 0 }); // 鳴らし始めた AudioContext の時刻と、そのときの再生位置
  const duration = rendered ? rendered.left.length / rendered.sampleRate : 0;

  const stopSource = () => {
    const src = srcRef.current;
    srcRef.current = null;
    src?.stop();
  };
  useEffect(() => stopSource, []);

  // 再生中は再生位置を画面の更新ごとに読む
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      if (srcRef.current) setPos(current()); // 止めた直後に1回呼ばれることがあるので、そのときは一時停止で取った位置のままにする
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const render = () => {
    const r = renderSong(rom.data, song.header, { loops });
    setRendered(r);
    return r;
  };

  // offset 秒の位置から鳴らす
  const start = (offset: number) => {
    stopSource();
    const r = rendered ?? render();
    const { ctx, dest } = audioOutput();
    const buf = ctx.createBuffer(2, Math.max(1, r.left.length), r.sampleRate);
    buf.copyToChannel(r.left, 0);
    buf.copyToChannel(r.right, 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = repeat;
    src.connect(dest);
    src.onended = () => {
      if (srcRef.current !== src) return; // 止めたり位置を変えたりしたもの
      srcRef.current = null;
      setPlaying(false);
      setPos(0);
    };
    offset = Math.max(0, Math.min(offset, buf.duration));
    src.start(0, offset);
    srcRef.current = src;
    startRef.current = { at: ctx.currentTime, offset };
    setPos(offset);
    setPlaying(true);
  };

  // 今の再生位置 (秒), 繰り返し再生中は PCM の長さで折り返す
  const current = () => {
    const p = startRef.current.offset + audioOutput().ctx.currentTime - startRef.current.at;
    const src = srcRef.current;
    return src?.loop && src.buffer ? p % src.buffer.duration : p;
  };

  // 再生中に切り替えたら、今の位置から数え直す
  useEffect(() => {
    const src = srcRef.current;
    if (!src) return;
    const p = current();
    src.loop = repeat;
    startRef.current = { at: audioOutput().ctx.currentTime, offset: p };
  }, [repeat]);

  const pause = () => {
    if (srcRef.current) setPos(Math.min(current(), duration));
    stopSource();
    setPlaying(false);
  };

  const stop = () => {
    pause();
    setPos(0);
  };

  const seek = (v: number) => {
    if (playing) start(v);
    else setPos(v);
  };

  const download = () => {
    const r = rendered ?? render();
    const url = URL.createObjectURL(new Blob([encodeWav(r.sampleRate, r.left, r.right)], { type: "audio/wav" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `song${String(song.index).padStart(3, "0")}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const desc = decomp(SONG_NAMES)[song.index]?.[1];
  const info: [string, string | number][] = [
    ["header", hex8(header.address)],
    ["tracks", header.trackCount],
    ["voicegroup", hex8(header.voicegroup)],
    ["priority", header.priority],
    ["reverb", header.reverb & 0x80 ? header.reverb & 0x7F : "-"],
    ["player", song.ms],
  ];

  return (
    <div class="sprite-view">
      <h2>{songLabel(song.index)}</h2>
      <Desc text={desc} />
      {header.trackCount === 0 ? <p class="dim">トラックが無い曲です</p> : (
        <>
          <div class="controls">
            <button type="button" onClick={() => (playing ? pause() : start(pos))}>{playing ? "一時停止" : "再生"}</button>
            <button type="button" onClick={stop} disabled={!playing && pos === 0}>停止</button>
            <NumberStepper
              label="ループ"
              value={loops}
              min={1}
              max={9}
              onChange={(v) => {
                stop();
                setLoops(v);
                setRendered(null);
              }}
            />
            <label>
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.currentTarget.checked)} /> 繰り返し再生
            </label>
            <button type="button" onClick={download}>WAV で保存</button>
          </div>
          <div class="controls seek">
            <input type="range" min={0} max={duration || 1} step={0.01} value={pos} disabled={!rendered} onInput={(e) => seek(Number(e.currentTarget.value))} />
            <span class="mono">{formatTime(pos)} / {rendered ? formatTime(duration) : "-:--"}</span>
          </div>
          {rendered?.looped && <p>{loops} 回ループしたところでフェードアウトします</p>}
          <p class="dim">ループは GOTO で戻った回数です。実機のミキサーやリバーブは再現しておらず、それらしく鳴らす程度です。</p>
        </>
      )}
      <InfoTable rows={info} />
    </div>
  );
};

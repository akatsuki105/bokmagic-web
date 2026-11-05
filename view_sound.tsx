// 曲 (BGM, 効果音, ボイス) のタブ
// 曲テーブル (gSongTable) を読み、選んだ曲を m4a/ (m4a-web のもの, deno.jsonc の imports) で PCM に書き出して WebAudio で鳴らす

import { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { detectEngine, encodeWav, type Engine, readSongHeader, readSongTable, type Rendered, type RenderOptions, renderSong, type SongEntry } from "m4a/mod.ts";
import { SONG_NAMES } from "./generated/names.ts";
import { decomp } from "./decomp.ts";
import { AssetView, ButtonRow, Card, Check, Field, Fields, hashID, hex4, type InfoRow, InfoTable, NumberStepper, useHashID } from "./components.tsx";
import { audioOutput, useVolume } from "./audio.ts";

// 曲テーブルの位置と m4aSoundMode の値 (ミキサーの周波数・同時発音数・リバーブ) は ROM から探す
// U32J rev1 では gSongTable = 0x0825E56C, m4aSoundMode(0x97FC00) (12 音, 21024 Hz) が見つかる
const playOptions = (e: Engine): RenderOptions => ({
  mixerRate: e.soundMode?.mixerRate,
  maxDirectVoices: e.soundMode?.maxChans,
  reverb: e.soundMode && e.soundMode.reverb & 0x80 ? e.soundMode.reverb & 0x7F : 0, // 曲ヘッダがリバーブを指定していないときの値
});

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
  const engine = useMemo(() => detectEngine(rom.data), [rom]);
  const table = engine?.songTable;
  const songs = useMemo(() => (table === undefined ? [] : readSongTable(rom.data, table)), [rom, table]);
  const empty = useMemo(() => new Set(songs.filter((s) => readSongHeader(rom.data, s.header).trackCount === 0).map((s) => s.index)), [rom, songs]);
  const [selected, setSelected] = useState<SongEntry | undefined>(songs[hashID("sound") ?? 1] ?? songs[0]);
  // 一覧でダブルクリックした曲を鳴らす要求. n はダブルクリックのたびに増やす (同じ曲をもう一度ダブルクリックしたら頭から鳴らし直す)
  // 別の曲に移ったら消す (戻ってきたときに勝手に鳴らさないように)
  const [playReq, setPlayReq] = useState<{ index: number; n: number } | null>(null);
  useHashID("sound", (id) => {
    if (songs[id]) setSelected(songs[id]);
    setPlayReq((r) => (r?.index === id ? r : null));
  });
  const [repeat, setRepeat] = useState(false); // 繰り返し再生 (曲を切り替えても保つ)

  if (!engine) return <p>この ROM ({rom.id}) では m4a のサウンドドライバが見つかりませんでした</p>;

  return (
    <div class="viewer">
      <ul class="sprite-list">
        {songs.map((s) => (
          <li key={s.index} class={s === selected ? "selected" : ""}>
            <a
              href={`#sound/${hex4(s.index)}`}
              class={empty.has(s.index) ? "dim" : ""}
              onMouseDown={(e) => e.detail > 1 && e.preventDefault()} // ダブルクリックで文字が選択されないように
              onDblClick={() => {
                setSelected(s);
                setPlayReq((r) => ({ index: s.index, n: (r?.n ?? 0) + 1 }));
              }}
            >
              {songLabel(s.index)}
            </a>
          </li>
        ))}
      </ul>
      {selected && <SongView key={selected.index} rom={rom} song={selected} opts={playOptions(engine)} repeat={repeat} setRepeat={setRepeat} playReq={playReq?.index === selected.index ? playReq.n : 0} />}
    </div>
  );
};

const formatTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

// repeat: 書き出した PCM の最後まで来たら最初から鳴らし直す (曲データのループとは別)
// playReq: 0 でなければ、変わるたびに頭から鳴らす (一覧でのダブルクリック)
const SongView: FunctionComponent<{ rom: ROMFile; song: SongEntry; opts: RenderOptions; repeat: boolean; setRepeat: (v: boolean) => void; playReq: number }> = ({ rom, song, opts, repeat, setRepeat, playReq }) => {
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
    const r = renderSong(rom.data, song.header, { ...opts, loops });
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

  useEffect(() => {
    if (playReq && header.trackCount > 0) start(0);
  }, [playReq]);

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
  const info: InfoRow[] = [
    ["tracks", header.trackCount],
    ["player", song.ms, "鳴らす MusicPlayer の番号 (gMPlayTable の何番目か)"],
    ["priority", header.priority, "同じ MusicPlayer で鳴っている曲との優先度. ここでの再生には使っていない"],
    ["reverb", header.reverb & 0x80 ? header.reverb & 0x7F : `${opts.reverb} (ROM の既定)`, "曲ヘッダの bit7 が立っていればその値, 立っていなければ m4aSoundMode の値"],
    ["header", hex8(header.address), "曲ヘッダの位置"],
    ["voicegroup", hex8(header.voicegroup), "音色の表の位置"],
  ];

  return (
    <AssetView
      title={songLabel(song.index)}
      desc={desc}
      stage={header.trackCount === 0 ? <p class="dim">トラックが無い曲です</p> : (
        <>
          <div class="player">
            <div class="controls">
              <button type="button" class="play" onClick={() => (playing ? pause() : start(pos))}>{playing ? "❚❚ 一時停止" : "▶ 再生"}</button>
              <button type="button" onClick={stop} disabled={!playing && pos === 0}>■ 停止</button>
              <span class="mono">{formatTime(pos)} / {rendered ? formatTime(duration) : "-:--"}</span>
            </div>
            <div class="controls seek">
              <input type="range" min={0} max={duration || 1} step={0.01} value={pos} disabled={!rendered} onInput={(e) => seek(Number(e.currentTarget.value))} />
            </div>
            {rendered?.looped && <p>{loops} 回ループしたところでフェードアウトします</p>}
          </div>
          <p class="desc">ループは GOTO で戻った回数です。リバーブは実機と同じ仕組みで掛けますが、実機のミキサー (低い周波数で混ぜて 8 ビットに落とすこと) は再現しておらず、実機より澄んだ音になります。</p>
        </>
      )}
    >
      {header.trackCount > 0 && (
        <Card title="書き出し">
          <Fields>
            <Field label="ループ" title="GOTO で戻った回数. この回数ループしたところでフェードアウトする">
              <NumberStepper
                value={loops}
                min={1}
                max={9}
                onChange={(v) => {
                  stop();
                  setLoops(v);
                  setRendered(null);
                }}
              />
              <span class="note">回</span>
            </Field>
            <Field label="繰り返し">
              <Check checked={repeat} onChange={setRepeat}>最後まで来たら最初から</Check>
            </Field>
          </Fields>
          <ButtonRow>
            <button type="button" onClick={download}>WAV で保存</button>
          </ButtonRow>
        </Card>
      )}
      <Card title="Metadata">
        <InfoTable rows={info} />
      </Card>
    </AssetView>
  );
};

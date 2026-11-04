# 曲 (m4a / MP2K)

曲 (BGM, 効果音, ボイス) は任天堂の標準サウンドドライバ MP2K (m4a, いわゆる Sappy) のデータで入っている。ツールは `m4a/` のモジュールでシーケンスを再生し、PCM に書き出して WebAudio で鳴らす。
`m4a/` はディレクトリの外のファイルを import しないので、ほかの GBA ゲームの解析にもそのまま持っていける。それらしく鳴らす程度のもので、実機の出力とは一致しない (「再現していないもの」を参照)。

## ROM 上の位置

- 曲テーブル gSongTable は U32J rev1 で `0x0825E56C` (decomp の `src/data/songs.s`)。8 バイト × 1000 曲で、直後の `0x082604AC` に dummy_song_header がある。
- 曲ヘッダ, 音色 (voicegroup), 波形, シーケンスは `0x0852EFB8` (gSongHeaders) から後ろにある。
- gFS は使わず、曲テーブルの位置はコードに直に書いてある (`view_sound.tsx` の `SONG_TABLE`)。U33J の位置は分かっていない。

## 構造

アドレスはすべて GBA のアドレス (`0x08000000` から)。`toOffset` で ROM オフセットにする。

### Song (曲テーブルの1項目, 8 バイト)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | SongHeader* | header | 曲ヘッダ |
| `0x04` | u16 | ms | 使う MusicPlayer の番号 (gMPlayTable の添字) |
| `0x06` | u16 | me | decomp のコメントでは「最大エフェクト数」。ツールは使わない |

### SongHeader

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u8 | trackCount | トラック数。0 の曲もある |
| `0x01` | u8 | blockCount | |
| `0x02` | u8 | priority | 曲の優先度 |
| `0x03` | u8 | reverb | bit7 が立っていれば下位7ビットをリバーブにする (`MPlayStart` が `m4aSoundMode` に渡す) |
| `0x04` | ToneData* | tone | voicegroup (ToneData の配列) |
| `0x08` | u8*[trackCount] | part | 各トラックのシーケンス |

### ToneData (音色, 12 バイト)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u8 | type | 下の表 |
| `0x01` | u8 | key | リズムの音色として鳴らすときのキー |
| `0x02` | u8 | length | CGB の音の長さ |
| `0x03` | u8 | pan_sweep | DirectSound / リズム: bit7 が立っていればパン (値 - `0xC0`)。矩形波1: スイープ |
| `0x04` | u32 | wav | type によって意味が違う (下の表) |
| `0x08` | u8 | attack | |
| `0x09` | u8 | decay | |
| `0x0A` | u8 | sustain | |
| `0x0B` | u8 | release | |

キースプリットのときは `0x08` からの u32 がキー → 添字の表 (keySplitTable) のアドレスになる (`readTone` は attack 以降と keySplitTable の両方を読んでおく)。

| type | 意味 | wav の意味 |
| --- | --- | --- |
| `& 0x07` = 0 | DirectSound | WaveData のアドレス |
| `& 0x07` = 1 | 矩形波1 (スイープ付き) | デューティ比 (0-3) |
| `& 0x07` = 2 | 矩形波2 | デューティ比 (0-3) |
| `& 0x07` = 3 | 波形メモリ | 16 バイトの波形のアドレス |
| `& 0x07` = 4 | ノイズ | bit0 が周期 (1 なら 7 ビット) |
| `0x08` (FIX) | 音程を変えない (DirectSound) | |
| `0x40` (SPL) | キースプリット | ToneData の配列。`keySplitTable[key]` がその添字 |
| `0x80` (RHY) | リズム (ドラム) | ToneData の配列。key がその添字 |

### WaveData (DirectSound の波形)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u16 | type | |
| `0x02` | u16 | status | bit14-15 が立っていればループする |
| `0x04` | u32 | freq | キー 60 で鳴らすときのサンプリング周波数 × 1024 |
| `0x08` | u32 | loopStart | ループの開始位置 (サンプル) |
| `0x0C` | u32 | size | サンプル数 |
| `0x10` | s8[size] | data | 8 ビット符号付き PCM |

### 波形メモリの波形 (16 バイト)

4 ビット × 32 サンプル。1 バイトに2サンプルで、上位4ビットが先 (`readProgWave`)。

### シーケンスのコマンド

トラックごとのバイト列。`0x80` 未満のバイトは引数で、コマンドの位置に来たら直前のコマンド (ランニングステータス) の引数として扱う。ランニングステータスとして覚えるのは `0xBD` (VOICE) 以上のコマンドだけ。

| バイト | 名前 | 引数 | 意味 |
| --- | --- | --- | --- |
| `0x80`-`0xB0` | W00-W96 | | gClockTable[cmd - `0x80`] ティック待つ |
| `0xB1` | FINE | | トラックを終える |
| `0xB2` | GOTO | u32 | ジャンプ |
| `0xB3` | PATT | u32 | サブルーチン呼び出し (3 段まで) |
| `0xB4` | PEND | | PATT から戻る |
| `0xB5` | REPT | u8 回数, u32 | 回数だけ繰り返す。0 なら無限 (GOTO と同じ) |
| `0xB9` | MEMACC | u8 op, u8 addr, u8 data (+ u32) | gMPlayMemAccArea (16 バイト) への演算。op 6-17 は条件付きジャンプで u32 が続く。op 18 以上は何もしない |
| `0xBA` | PRIO | u8 | トラックの優先度 |
| `0xBB` | TEMPO | u8 | テンポ (BPM / 2) |
| `0xBC` | KEYSH | s8 | キーのずれ |
| `0xBD` | VOICE | u8 | voicegroup の音色を選ぶ |
| `0xBE` | VOL | u8 | 音量 |
| `0xBF` | PAN | u8 | パン (64 が中央) |
| `0xC0` | BEND | u8 | ピッチベンド (64 が中央) |
| `0xC1` | BENDR | u8 | ベンドの幅 (半音) |
| `0xC2` | LFOS | u8 | LFO の速さ |
| `0xC3` | LFODL | u8 | LFO の遅れ |
| `0xC4` | MOD | u8 | LFO の深さ |
| `0xC5` | MODT | u8 | LFO の対象 (0: 音程, 1: 音量, 2: パン) |
| `0xC8` | TUNE | u8 | 微調整 (64 が中央) |
| `0xCC` | PORT | u8 レジスタ, u8 値 | `0x04000060` + レジスタ に直接書く |
| `0xCD` | XCMD | u8 sub, ... | 音色の書き換え (`0x01` wav, `0x02` type, `0x04`-`0x07` ADSR, `0x0A` length, `0x0B` pan_sweep) と疑似エコー (`0x08` 音量, `0x09` 長さ) |
| `0xCE` | EOT | [u8 key] | TIE で鳴らしている音を止める |
| `0xCF` | TIE | [key [velocity [gate]]] | ゲート無しで鳴らす (EOT まで) |
| `0xD0`-`0xFF` | N01-N96 | [key [velocity [gate]]] | gClockTable[cmd - `0xCF`] ティックのゲートで鳴らす。3つめの値はゲートに足す |

それ以外 (`0xB6`-`0xB8`, `0xC6`, `0xC7`, `0xC9`-`0xCB`) は FINE と同じ (gMPlayJumpTableTemplate)。音符の key / velocity / gate はそれぞれ省ける (次のバイトが `0x80` 以上なら前の値のまま)。

## パースの手順

### data.ts

1. `readSongTable(rom, table, count?)`: 8 バイトずつ読む。count を省くと、ROM を指さない header に当たるか、テーブルより後ろにある曲ヘッダのうち一番手前の位置に着いたところで止める (U32J rev1 では dummy_song_header の手前、1000 曲)。
2. `readSongHeader(rom, address)`: SongHeader を読み、trackCount 個のトラックのアドレスを集める。
3. `readTone` / `readVoice(rom, voicegroup, index)`: voicegroup + index × 12 の ToneData を読む。
4. `readWave`: WaveData を読み、data は ROM の上の `Int8Array` で持つ (コピーしない)。size は ROM の終わりで切る。
5. `readProgWave`: 波形メモリの 16 バイトを 32 サンプルにする。

### player.ts (SongPlayer)

`MPlayMain` と `ply_*` の動きを真似たシーケンサ。

1. コンストラクタで曲ヘッダを読み、トラックごとに `Track` (MusicPlayerTrack に当たる) を作る。tempoD = 150, tempoC = 0 で始める (`MPlayStart` と同じ)。
2. `frame()` を 1 フレームごとに呼ぶ。`tempoC += tempoD` し、`tempoC >= 150` の間 `tick()` して 150 を引く。TEMPO は tempoD = 値 × 2 にする (`ply_tempo`, tempoU は 0x100 固定)。その後、鳴っている音のエンベロープを1フレーム進める。
3. `tick()` はトラックごとに、ゲートの残りを1減らして切れた音を離し、待ちが 0 の間コマンドを読む (`command`)。待ちを1減らし、LFO (lfoSpeed と mod が 0 でないとき) を進める。lfoDelayC が残っていればそれを減らし、そうでなければ lfoSpeedC を進めて三角波で modM を作り、変わったら `TrkVolPitSet` をやり直す (MPlayMain の LFO の処理)。
4. `command()`: ランニングステータスを解決し、上のコマンド表のとおりに動く。GOTO と REPT 0 で戻った回数を `gotoCount` に数える (ループの回数)。PATT は戻り先のスタックを 3 段まで持ち、それを超えたら `ply_patt` と同じくトラックを終える (FINE)。MEMACC は `ply_memacc` と同じ (条件の比較は op 6-11 が data, 12-17 が mem[data], op 18 以上は何もせず u32 も読まない)。addr と data はマスクしないので、メモリ領域は 256 バイト持っておく。
5. VOL, PAN, BEND など音量と音程に関わるコマンドの後に `Track.update()` (TrkVolPitSet) を呼ぶ。volX = 64, panX = 0, pitX = 0, keyShiftX = 0 のときの式で volMR / volML / keyM / pitM を作る。
6. `note()` (`ply_note`): key / velocity / gate を読み、音色がキースプリットなら keySplitTable[key]、リズムなら key を添字にして wav の配列から ToneData を引き直す。リズムのときはその音色の key で鳴らし、pan_sweep の bit7 が立っていればパンにする。引き直した先がまたキースプリットかリズムなら鳴らさない。LFODL が 0 でなければ LFO の遅れを数え直し、modM を 0 に戻す。
7. 発音数: CGB は種類 (1-4) ごとに1チャンネルなので、同じ種類の音を止めてから鳴らす。DirectSound は同時発音数 (既定 12) を超えるとき、離した音のうち古いもの、無ければ一番古い音を止める。

### synth.ts (Voice)

鳴っている音1つ。DirectSound は `SoundMainRAM`、CGB は `CgbSound` の動きを真似る。

1. **音量** (`volumes`, `ChnVolSetAsm`): 右 = velocity × (128 + rhythmPan) × volMR >> 14、左 = velocity × (127 - rhythmPan) × volML >> 14 (最大 255)。
2. **DirectSound のエンベロープ** (`frameDirect`, 1フレームごと, `SoundMainRAM` の処理と同じ順): attack は env += attack で 255 になったら decay へ。decay は env = env × decay >> 8 で sustain 以下になったら sustain (sustain が 0 ならエコーへ)。release は env = env × release >> 8 でエコー音量以下になったらエコーへ。エコーは音量か長さが 0 なら止め、そうでなければエコー音量のまま長さのフレーム数だけ鳴らす。
3. **CGB のエンベロープ** (`frameCgb`): 目標の音量 = (右 + 左) >> 4 (最大 15, `CgbModVol`)、sustain の目標 = (目標 × sustain + 15) >> 4。attack / decay / release の下位3ビットを待ちフレーム数にして1ずつ増減する。実機のレジスタのエンベロープを真似ただけの近似。
4. **DirectSound の音程** (`rate`, `MidiKeyToFreq`): キー = 鳴らすキー + keyM、端数 = pitM / 256。キー 60 で wav.freq / 1024 Hz、半音ごとに 2^(1/12) 倍 (キーは 0-178 に切る)。FIX の音色は `SoundMainRAM` と同じく、出力1サンプルごとに波形を1サンプル進める (ミキサーのサンプリング周波数 `mixerRate` で鳴る)。`mixerRate` は `PlayerOptions` / `RenderOptions` で渡し、既定は m4a の SoundInit と同じ 13379 Hz。このゲームでは Sound タブが 21024 Hz (`m4aSoundMode(0x97FC00)`) を渡す。
5. **矩形波・波形メモリの音程** (`MidiKeyToCgbFreq`): gCgbFreqTable (C から1オクターブ分) を `>> オクターブ` して端数で補間し、GB の周波数レジスタ値 x (0-2047) を作る。矩形波は 131072 / (2048 - x) Hz、波形メモリは 32 サンプルで1周なので 65536 / (2048 - x) Hz (実機と同じく、同じキーの矩形波より1オクターブ低い)。キー 35 以下は 0 に、36 から数える。
6. **ノイズ** (`MidiKeyToCgbFreq` の chanNum 4): キー 21 からの gNoiseTable で NR43 の値を引き、524288 / r / 2^(s + 1) 回/秒 (r = 0 は 0.5 とみなす) で 15 ビットの LFSR を回す。wav の bit0 が立っていれば 7 ビットの周期にする。
7. **書き出し** (`mix`): DirectSound は、音程を変える音色は隣のサンプルとの間を線形補間し (`SoundMainRAM` と同じ)、FIX の音色は補間しない。ループ無しの波形は終わりで止める。矩形波はデューティ比 (12.5 / 25 / 50 / 75 %)、波形メモリは 4 ビット値を -1..1 にして鳴らす。CGB は左右どちらかが半分以下なら片側だけにする (`CgbPan`)。CGB の音の最大は DirectSound の最大の 0.25 倍 (`CGB_AMP`, 決め打ち)。

### render.ts (renderSong)

1. 1 フレームは 16777216 / 280896 Hz (約 59.73 Hz, `FRAME_RATE`)。フレームごとに `player.frame()` し、そのフレーム分のサンプル (sampleRate / FRAME_RATE, 端数は持ち越す) を `player.mix()` で書く。
2. GOTO で戻った回数 (どれかのトラックの gotoCount の最大) が `loops` (既定 1) になったら、`fadeSeconds` (既定 4 秒) で直線にフェードアウトして終える。全トラックが FINE で終わって音も消えたらそこで終える。最長 `maxSeconds` (既定 600 秒)。
3. 既定は 44100 Hz, gain 0.8, DirectSound の同時発音数 12。最後に -1..1 に切る。

### wav.ts

`encodeWav(sampleRate, left, right)`: 16 ビットステレオの RIFF WAV にする。

### 再現していないもの

- ミキサーのサンプリング周波数: 実機はこのゲームでは 21024 Hz (`m4aSoundInit` の `m4aSoundMode(0x97FC00)`) で、8 ビットに丸めて出す。ツールは 44100 Hz の浮動小数で書き出す (FIX の音色の速さには `mixerRate` を使う)。
- リバーブ (曲ヘッダの reverb もサウンドモードのものも)。
- 矩形波1のスイープ (pan_sweep) と CGB の音の長さ (length)。
- 優先度によるチャンネルの割り当て (PRIO と曲の priority は読み捨てる)、マスター音量、MusicPlayer どうしの関係 (効果音とBGMの同時再生)。
- PORT (サウンドレジスタへの直接書き込み) は引数を読み飛ばすだけ。
- gMPlayMemAccArea: 実機では全 MusicPlayer で共有で曲をまたいで残るが、ツールは曲ごとに 0 で始める。
- `m4aMPlayTempoControl` などゲームのコードからの音量・テンポ・音程の操作。

## 表示での扱い

- Sound タブ (`view_sound.tsx`): 曲テーブルの位置は `SONG_TABLE` に U32J rev1 (`0x0825E56C`) だけを持つ。ほかの ROM では「曲テーブルの位置は分かっていません」と出す。
- 左に曲の一覧を出す。名前は `generated/names.ts` の SONG_NAMES (decomp の `include/constants/songs.h` から作る, U32J rev1 のときだけ)。トラックが 0 の曲は薄く出す。選んでいる曲は URL の `#sound/0xXXXX` (曲番号) に入れる。
- 右に header, tracks, voicegroup, priority, reverb (bit7 が立っているときだけ), player (ms) を出す。
- 「再生」を押したときに初めて `renderSong` で曲全体を PCM にし (同期処理)、`AudioBufferSourceNode` で鳴らす。一時停止、停止、シークバー (位置を変えると、その位置から鳴らし直す)、WAV で保存がある。
- 「ループ」(1-9) は renderSong の loops で、変えると書き出し直す。「繰り返し再生」は書き出した PCM を最後まで鳴らしたら頭から鳴らし直すもの (`AudioBufferSourceNode.loop`) で、曲データのループとは別。曲を切り替えても保つ。
- `audio.ts`: アプリ全体で1つの AudioContext と、その出口の GainNode (全体の音量) を持つ。AudioContext は初めて鳴らすときに作る (ブラウザはユーザー操作の前に鳴らさない)。音量は localStorage (`bokmagic-web.volume`, 既定 0.8) に保存し、ヘッダの `VolumeControl` で変える。

## 根拠

- `src/data/songs.s`: gSongTable (`0x0825E56C`, 1000 曲), dummy_song_header (`0x082604AC`), gSongHeaders (`0x0852EFB8`)
- `include/gba/m4a_internal.h`: `Song`, `SongHeader`, `ToneData`, `WaveData`, `TONEDATA_TYPE_*`, `MAX_DIRECTSOUND_CHANNELS`
- `src/lib/m4a_tables.c`: gMPlayJumpTableTemplate, gClockTable, gScaleTable, gFreqTable, gCgbScaleTable, gCgbFreqTable, gNoiseTable, gXcmdTable
- `src/lib/m4a.c`: `MidiKeyToFreq`, `m4aSoundInit` (`m4aSoundMode(0x97FC00)`: 同時発音数 12, 21024 Hz), `MPlayExtender` (MEMACC, LFOS, MOD, XCMD, EOT をジャンプテーブルに入れる), `SampleFreqSet`, `MPlayStart` (tempoD = 150), `TrkVolPitSet`, `MidiKeyToCgbFreq`, `CgbPan`, `CgbModVol`, `CgbSound`, `ply_memacc`, `ply_xcmd` と `ply_x*`
- `src/lib/m4a_1.s`: `SoundMainRAM` (エンベロープ, FIX と音程付きの書き出し), `MPlayMain` (ランニングステータス, ゲート, LFO, テンポ), `ply_goto`, `ply_patt`, `ply_pend`, `ply_rept`, `ply_tempo`, `ply_port`, `ply_note`, `ply_endtie`, `ChnVolSetAsm`

## 未解明

- U33J の曲テーブルの位置。

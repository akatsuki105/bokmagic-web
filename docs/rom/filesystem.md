# ファイルシステム (gFS) と LZ77

ROM のアセットは、gFS というディレクトリの表から (ディレクトリID, ファイルID) の組で引く。`fs.ts` はゲームの `GetFile` と同じ引き方で、ファイルの ROM オフセットを返す。 ここでは ROM ヘッダでのゲームの判定、gFS と Directory の構造、LZ77 の展開と、タイルマップ・Collision Map で使う「展開後の先頭4バイト」の約束をまとめる。

## ROM 上の位置

- ゲームの判定には、ROM 先頭の GBA カートリッジヘッダの 0xAC (ゲームコード) と 0xBC (ソフトのバージョン) を読む
- gFS は作品ごとに決まったオフセットにある (`fs.ts` の `FS_OFFSET`)。ROM のどこかから辿るのではなく、この値を直接持つ

| gameID      | `FS_OFFSET` | 出典                                                                                                                                      |
| ----------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `U3IJ`      | `0x5A1584`  | bokmagic の `mftAddress` (`fs.ts` のコメント)。ボクタイ1 の decomp は無い                                                                 |
| `U32J`      | `0x5B0CE4`  | rev0。bokmagic の `mftAddress` と decomp の `tools/encoding/mft/helper.ts` (`0x085B0CE4`)                                                 |
| `U32J_rev1` | `0x5B0D90`  | decomp `src/file.c` の `gFS` (`0x085B0D90`)                                                                                               |
| `U33J`      | `0x614D6C`  | bokmagic の `mftAddress` (`fs.ts` のコメント)。decomp の `tools/encoding/mft/helper.ts` の表も `0x08614D6C`。C のコードでは確かめていない |

- ROM 内のポインタは GBA のアドレス (ROM は `0x08000000` から) なので、`ROM_BASE` (`0x08000000`) を引いて ROM 先頭からのオフセットにする
- Directory の中のオフセットは、すべて Directory の先頭からの相対値
- ボクタイ1 のゲームコードは `U3IJ` (I は英字)。gFS の並びとディレクトリIDは U32J と同じ。フォントとタイルセットは形が違い、gameID で読み分ける ([font.md](font.md), [bg.md](bg.md))。Collision Map はナビメッシュの形だけ違う ([collision.md](collision.md))。スクリプトは形式が違って今のパーサでは読めないので、その画面とコマンドは `rom.ts` の `isSupported` で止め、「まだ対応していない」と出す (マップの画面はスクリプトを読むので一緒に止める)
- U32J rev0 (gameID は `U32J`) は gFS の位置が違うだけで、全ディレクトリのファイルID とファイルの先頭 64 バイト、スクリプト 11539 本の先頭 16 バイトが rev1 と同じだった。そのため `generated/` の名前の表 (rev1 の decomp から作る) を rev0 でも使う (`decomp.ts`)。曲テーブルも 1000 曲の並びが同じ

## 構造

### ROM ヘッダ

`gba.ts` が読む所だけ。

| オフセット | 型       | 名前             | 意味                                                                                      |
| ---------- | -------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `0xA0`     | char[12] | title            | `"ZOKTAI"` など。0 で終わる。画面のヘッダと保存した ROM の一覧に出すだけ (`getGameTitle`) |
| `0xAC`     | char[4]  | game code        | `"U32J"` など                                                                             |
| `0xBC`     | u8       | software version | 0 でなければ gameID の後ろに `_rev<値>` をつける                                          |

U32J rev1 の ROM は `0xAC` が `"U32J"`、`0xBC` が `0x01` なので gameID は `U32J_rev1` になる。タイトルは U3IJ が `"BOKUTAI"`、U32J (rev0, rev1) が `"ZOKTAI"`、U33J が `"BOKTAI3"`。

### gFS

`FSEntry gFS[12]`。8 バイトの `FSEntry` が並び、`id` が 0 のエントリで終わる。`id` の昇順に並んでいる (`GetDirectory` が二分探索するため)。

| オフセット | 型         | 名前      | 意味                                    |
| ---------- | ---------- | --------- | --------------------------------------- |
| `0x00`     | u32        | id        | `(上位16ビット << 16) \| 下位16ビット`  |
| `0x04`     | Directory* | directory | GBA のアドレス。終端のエントリでは NULL |

U32J rev1 の中身。`GetFile` に渡すディレクトリIDは、`GetFile` の中で gFS の `id` に置き換えられる (`fs.ts` の `DIR_REMAP`)。

| `GetFile` に渡すディレクトリID | gFS の `id`   | 指す先 (decomp のシンボル)                  | 読むモジュール                                |
| ------------------------------ | ------------- | ------------------------------------------- | --------------------------------------------- |
| `DIR_ANIMATION` `0x922E`       | `0x9225_5130` | `gAnimDirectory`                            | `anim_aux.ts` ([sprite.md](sprite.md))        |
| `DIR_BGPLTT` `0x92B3`          | `0x9305_D710` | `gPlttDirectory`                            | `bgpltt.ts` ([palette.md](palette.md))        |
| `DIR_OBJPLTT` `0x9B1B`         | `0x9A65_4679` | `gSpritePlttsDirectory`                     | `objpltt.ts` ([palette.md](palette.md))       |
| `DIR_AUX_SPRITE` `0x98F5`      | `0x9B05_2117` | `gAuxSpritesDirectory`                      | `sprite_aux.ts` ([sprite.md](sprite.md))      |
| `DIR_FONT` `0xA635`            | `0xA705_6D24` | `gFontDirectory`                            | `font.ts` ([font.md](font.md))                |
| `DIR_SCRIPT` `0xA8D9`          | `0xA8D9_A41E` | `gScriptDirectory` (Directory の形ではない) | `script.ts` ([script.md](script.md))          |
| `DIR_COLLISION_MAP` `0xAE6C`   | `0xAF05_AC2C` | `gCollisionMapsDirectory`                   | `collision.ts` ([collision.md](collision.md)) |
| `DIR_TILE_MAP` `0xC091`        | `0xC305_E53E` | `gTilemapDirectory`                         | `tilemap.ts` ([bg.md](bg.md))                 |
| `DIR_MAIN_SPRITE` `0xCB05`     | `0xC8E5_5F29` | `gMainSpritesDirectory`                     | `sprite_main.ts` ([sprite.md](sprite.md))     |
| `DIR_TILESET` `0xCEEF`         | `0xCEE5_4F2D` | `gTilesetsDirectory`                        | `tileset.ts` ([bg.md](bg.md))                 |
| `DIR_PARTICLE` `0xCEAA`        | `0xCF05_0A4D` | `gParticlesDirectory`                       | `particle.ts` ([sprite.md](sprite.md))        |

- 表の `0x9225_5130` は `(0x9225 << 16) | 0x5130` のこと
- `DIR_SCRIPT` だけは `DIR_REMAP` に無い。`GetFile` は置き換えずに `(0xA8D9 << 16) | fileID` で gFS を探し、Directory として解釈せずにそのまま返す。`fs.ts` では `DIR_SCRIPT` の定数を持たず、`script.ts` の `SCRIPT_DIRECTORY` が `0xA8D9` を持つ
- ディレクトリIDは文字列のハッシュ (`BOKHASH`、例: `DIR_BGPLTT = BOKHASH("arr")`) だと decomp の `include/file.h` は見ている。パースには関係しない

### Directory

| オフセット      | 型              | 名前            | 意味                                                               |
| --------------- | --------------- | --------------- | ------------------------------------------------------------------ |
| `0x00`          | u32             | entryCount      | ファイル数                                                         |
| `0x04`          | u32             | offsetToIds     | Directory 先頭から `ids` までのオフセット                          |
| `0x08`          | u32             | offsetToOffsets | Directory 先頭から `offsets` までのオフセット                      |
| `0x0C`          | u32             | offsetTo1stFile | Directory 先頭から最初のファイルまでのオフセット。ゲームは読まない |
| offsetToIds     | u16[entryCount] | ids             | ファイルIDの配列, 昇順                                             |
| offsetToOffsets | u32[entryCount] | offsets         | Directory 先頭から各ファイルまでのオフセット                       |

- 実データでは `ids` が `0x10` から始まり、4 バイト境界まで詰め物をしてから `offsets` が続く。例: `gFontDirectory` は `entryCount = 1`, `offsetToIds = 0x10`, `offsetToOffsets = 0x14`, `offsetTo1stFile = 0x1C` (decomp `src/data/fonts.s`)
- ファイルの中身は用途ごとにまったく違う。各フォーマットはそれぞれのドキュメントを見る

### LZ77

GBA BIOS の `LZ77UnCompWram` と同じ形式。

| オフセット | 型   | 名前   | 意味                                           |
| ---------- | ---- | ------ | ---------------------------------------------- |
| `0x00`     | u8   | type   | `0x10` (LZ77)                                  |
| `0x01`     | u24  | size   | 展開後のバイト数                               |
| `0x04`     | u8[] | stream | フラグ1バイトと、それに続く8ブロックの繰り返し |

- フラグは上位ビットから順に、続く各ブロックの種類を表す
- ビットが 0 のブロックは 1 バイトで、そのまま出力する
- ビットが 1 のブロックは 2 バイト (`b0`, `b1`) で、長さ `(b0 >> 4) + 3`、距離 `(((b0 & 0xF) << 8) | b1) + 1` の参照。出力済みの末尾から距離だけ戻った所から長さだけ写す (写す範囲が重なってもよい)

### 展開後の先頭4バイト

圧縮されたタイルマップファイルと Collision Map ファイルは、展開した結果の先頭 4 バイトがファイル本体ではない。ゲームは展開先を「4 バイトの配列 + 本体のバッファ」の 2 つの変数に分けていて、本体のほうを返す。

| オフセット | 型    | 名前   | 意味                                                                 |
| ---------- | ----- | ------ | -------------------------------------------------------------------- |
| `0x00`     | u8[4] | (head) | ゲームは読まない。値は下を見る                                       |
| `0x04`     | —     | 本体   | `"MP"` で始まる TilemapFile、または `"HP"` で始まる CollisionMapFile |

- U32J rev1 の圧縮されたタイルマップ (249 個) と Collision Map (246 個) をすべて展開して確かめると、head は `0x00` の 1 バイトと、24 ビットの「展開後の全体のバイト数 (head を含む)」だった。LZ77 ヘッダの `size` と同じ値
- 本体のフォーマットは [bg.md](bg.md) (タイルマップ) と [collision.md](collision.md) を見る

## パースの手順

1. `LoadROM` (`rom.ts`) が ROM 全体を `DataView` にし、`getGameID` (`gba.ts`) で gameID を作る。`GAME_IDS` (`U3IJ`, `U32J`, `U32J_rev1`, `U33J`) に無ければ例外を投げる
2. `new FileSystem(dv, gameID)` (`fs.ts`) が `FS_OFFSET[gameID]` から 8 バイトずつ読み、`id` が 0 のエントリで止める。`id` → `directory - 0x08000000` を `dirs` (Map) に入れる。ゲームは `GetDirectory` で二分探索するが、ここでは Map で引く
3. `list(dirID)` は `directory(dirID)` で Directory の位置を求める。`DIR_REMAP[dirID]` で gFS の `id` (`(上位 << 16) | 下位`) を作り、`dirs` から引く。`DIR_REMAP` に無い ID や gFS に無い ID は例外
4. `list` は Directory の `entryCount`, `offsetToIds`, `offsetToOffsets` を読み、`i` 番目のファイルを `{ id: ids[i], offset: d + offsets[i] }` (`d` は Directory の ROM オフセット) にして、ID 昇順のまま返す。`GetFileFromDirectory` の `h.offsets[idx] + d` と同じ計算
5. `get(dirID, fileID)` は `list` の中から `fileID` を線形に探し、無ければ `undefined` を返す。ゲームの `FindFile` は二分探索だが、`ids` が昇順なので見つかるものは同じ
6. `rawEntry(dirID)` は gFS を ID の上位 16 ビットだけで探し、指す先の ROM オフセットをそのまま返す (Directory として読まない)。`gScriptDirectory` 用 (`parseScriptDirectory` in `script.ts`)。下位 16 ビットは作品ごとに違うので照合しない (`fs.ts` のコメントでは U3IJ: `0x41F5`, U32J: `0xA41E`, U33J: `0x49BC`)
7. `LoadROM` は続けて `loadObjPltt` (`objpltt.ts`) を呼び、OBJ パレットを先に読んでおく ([palette.md](palette.md))

### LZ77 の展開

`decompressLZ77` (`lz77.ts`)。decomp の `tools/common/gba/lz77.ts` をそのまま写したもの。

1. 先頭 1 バイトが `0x10` でなければ例外
2. 続く 3 バイト (リトルエンディアン) を展開後のサイズとして、その大きさの `Uint8Array` を用意する
3. 出力がサイズに達するまで、フラグを 1 バイト読んでは上位ビットから 1 ビットずつ見る。0 なら 1 バイト写す。1 なら 2 バイト読んで長さと距離を求め、`0x1000` バイトのリングバッファから写す
4. 距離が出力済みのバイト数より大きければ例外

### タイルマップ・Collision Map の読み出し

`parseTilemap` (`tilemap.ts`) と `parseCollisionMap` (`collision.ts`) は、ゲームの `GetTilemapFile` / `OpenCollisionMapFile` と同じ判定をする。

1. ファイル先頭 2 バイトが `"MP"` (タイルマップ) / `"HP"` (Collision Map) なら非圧縮として、ROM のその位置をそのまま本体にする
2. そうでなければ `decompressLZ77` で展開し、`.subarray(4)` で[先頭 4 バイト](#展開後の先頭4バイト)を落としたものを本体にする

## 表示での扱い

- 一覧に出るファイルの順は `list` の順 (ファイルID の昇順)
- `FileEntry.offset` などのオフセットは ROM 先頭から数えた値。decomp のアドレス (`0x08xxxxxx`) と比べるときは `0x08000000` を足す
- `list` / `get` に `DIR_REMAP` に無いディレクトリIDを渡すと例外になる。スクリプトのように Directory の形をしていないものは `rawEntry` を使う
- gFS は U33J でも読めるが、`generated/` の名前の表は U32J rev1 から作ったものなので、U33J では名前を出さない (`decomp.ts`)
- `GetTilemapFile` は先頭 4 バイトが `0x005E8CC5` のファイルも非圧縮として扱うが、`parseTilemap` はこれを見ない。decomp の `src/bg.c` のコメントでは、この形式のファイルは ROM に無い
- ゲームは LZ77 を BIOS の `LZ77UnCompWram` で WRAM のバッファ (`gTilemapFileBuffer` は 65532 バイト、`gDecompressedCollisionMapFile` は 16380 バイト) に展開する。ビューワは展開先の大きさを制限していない

## 根拠

- `src/file.c`: `Directory`, `FSEntry`, `gFS` (`0x085B0D90`), `GetFile`, `GetDirectory`, `GetFileFromDirectory`, `FindFile`
- `include/file.h`: `DIR_*` の値と、各ディレクトリが返す構造体
- `src/data/fonts.s`, `src/data/obp.s`, `src/data/bgp.s`: Directory の実データの並び
- `src/data/scripts.c`: `gScriptDirectory`
- `src/bg.c`: `GetTilemapFile`, `gTilemapFileBufferHead`, `gTilemapFileBuffer`
- `src/camera.c`: `OpenCollisionMapFile`, `gDecompressedCollisionMapHeader`, `gDecompressedCollisionMapFile`
- `include/gba/syscall.h`, `src/lib/libagbsyscall.s`: `LZ77UnCompWram`
- `tools/common/gba/lz77.ts` (`lz77.ts` の元), `tools/common/gba/gba.ts` (`gba.ts` の元), `tools/encoding/mft/helper.ts` (作品ごとの gFS の位置)

## 未解明

- 展開後の先頭 4 バイト: ゲームは読まない。値は「`0x00` + 展開後のサイズ」で、圧縮前のデータに付いていた非圧縮 (type 0) のヘッダの名残に見えるが、推測
- gFS の `id` の上位・下位 16 ビットが何の文字列のハッシュかは、decomp でも「?」付きの推測にとどまる (`GetFile` のコメント)。パースには関係しない
- U3IJ の `FS_OFFSET` (`0x5A1584`) は bokmagic の値で、ROM の中に gFS の形の表があることは確かめた (各ディレクトリの中身は U32J と同じ形で読める)
- U33J の `FS_OFFSET` (`0x614D6C`) と、U33J の `gScriptDirectory` の下位 16 ビット (`0x49BC`) は、U33J の decomp が無いので C のコードでは確かめていない

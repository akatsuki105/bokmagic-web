# パレット (OBJ / BG)

OBJ パレットは 1 つのファイルに 16 色パレットを並べたもの (`gObjPlttData`) で、スプライトは plttID でその中の 1 本を使う。
BG パレットはファイルごとに 16 色 × 16 本 (256 色) を持ち、タイルマップやフォントがその中の 1 本を使う。色はどちらも GBA の rgb555。

## ROM 上の位置

- OBJ パレット: `GetFile(DIR_OBJPLTT, 0xC5E9)` (`InitPltt`)。U32J rev1 では `DIR_OBJPLTT` のファイルはこの 1 つだけ (`gObjPlttFile0`, `0x08CB9244`)
- BG パレット: `GetFile(DIR_BGPLTT, id)`。decomp ではマクロ `GetBgPlttFile(id)`。U32J rev1 では 232 ファイルある。ファイルID は `include/bg_pltt.h` の `BGP_XXXX` で、いくつかは `BOKHASH("..._col_arr")` (例: `BGP_LINK = BOKHASH("bg_link_col_arr") = 0x26BB`)
- ディレクトリの引き方は [filesystem.md](filesystem.md#gfs) を見る

## 構造

### ObjPlttFile

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u16 | length | 16 色パレットの個数。U32J rev1 では 768 |
| `0x02` | u16 | unk_02 | 不明。U32J rev1 では 171 (`0xAB`) |
| `0x04` | rgb555[length × 16] | body | `gObjPlttData`。plttID 番目のパレットは `body[plttID * 16]` から 16 色 (ファイル先頭からは `0x04 + plttID * 32`) |

### BgPlttFile

532 バイト固定。

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u8[20] | header | 不明 ([未解明](#未解明)) |
| `0x14` | rgb555[256] | body | 16 色 × 16 本。`r` 本目は `body[r * 16]` から 16 色 |

### rgb555

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| bit 0–4 | u5 | r | 赤 |
| bit 5–9 | u5 | g | 緑 |
| bit 10–14 | u5 | b | 青 |
| bit 15 | — | — | GBA は使わない。立っていれば色の表に `(bit15)` と出す (`ColorTable` in `components.tsx`) |

## パースの手順

### OBJ パレット

`loadObjPltt` (`objpltt.ts`)。`LoadROM` (`rom.ts`) が ROM を開いたときに 1 回だけ呼び、結果を `ROMFile.objPltt` に持つ。

1. `fs.get(DIR_OBJPLTT, 0xC5E9)` でファイルを探す。無ければ例外
2. `0x00` を `length`、`0x02` を `unk_02` として読む
3. `0x04` から `length * 16` 個の u16 を `raw` に読む
4. `raw` の各色を `rgb555ToRGBA` で RGBA にして `colors` にする。色 0 も不透明のまま持つ

### BG パレット

`parseBgPlttFiles` (`bgpltt.ts`)。使うタブ (BG Palette, Font, Tileset など) が呼ぶ。

1. `fs.list(DIR_BGPLTT)` で全ファイルを ID 順に取る
2. 各ファイルの先頭 20 バイトを `header` にする (ROM の `Uint8Array` のビュー、コピーしない)
3. `0x14` から 256 個の u16 を `raw` に読む
4. `raw` を `rgb555ToRGBA` で `colors` にする

### rgb555 → RGBA

`rgb555ToRGBA` (`objpltt.ts`、`bgpltt.ts` からも使う)。

1. 5 ビットの各成分を `color8(c5) = (c5 << 3) | (c5 >> 2)` で 8 ビットにする (上位 3 ビットを下に複製するので、`0x1F` は `0xFF` になる)
2. `(0xFF << 24) | (b << 16) | (g << 8) | r` の u32 にする。リトルエンディアンでメモリに置くと R, G, B, A の順になるので、`ImageData` のバッファを `Uint32Array` で見てそのまま書ける (リトルエンディアンの環境が前提)
3. bit 15 は捨てる

## 表示での扱い

### 色 0 の透明

GBA では 4bpp の色 0 は透明。ただし BG パレット 0 本目の色 0 だけは背景色 (どの BG も描かれない所の色) になる。パース結果の `colors` は色 0 も不透明のまま持ち、透明にするかは描く側が決める。

| 描くもの | 色 0 の扱い | 場所 |
| --- | --- | --- |
| OBJ (MainSprite, AuxSprite, Particle) | 常に描かない | `renderObjs` (`render.ts`) |
| BG のタイル (Tileset, Tilemap, Map タブ) | 「色0 を透明にする」で切り替え (`transparent0`) | `renderTileGrid` (`render.ts`), `tilemap.ts` |
| フォント | 常に描かない (ただし style で色番号が変わる。[font.md](font.md#表示での扱い)) | `renderGlyphs` (`font.ts`) |

色の表 (`ColorTable`) の色 0 には、OBJ なら「OBJ では透明」、BG なら「BG では透明」(0 本目は「0 本目の色0 は背景色」も) と添える。

### OBJ Palette タブ

- `view_objpltt.tsx`。plttID 0 から `length - 1` までを並べ、選んだものの 16 色を表にする。`offset` は `gObjPlttData` 先頭からのバイト数 (`plttID * 32`)
- 「used by」は、そのパレットを既定で使うスプライト。MainSprite は `MainSpriteGfx.palStart + MainSubsprite.paletteNum`、AuxSprite は `Video_GetAuxSprite` が最初のポーズから取る plttID ([sprite.md](sprite.md))
- ゲームは実行時に plttID を指定してパレットを差し替えることがある (`Video_SetAuxSpritePltt`, `Particle_SetPltt`, `Forge_GetObjPltt` の `plttID + 735` など)。こうした使われ方は「used by」に出ない
- ゲームの `gObjPlttData` は ROM の `body` を直接指し、スプライトは `&gObjPlttData[plttID * 16]` を持つ。OBJ パレット RAM の 16 本のどこに載るかは実行時のスロット (`gObjPlttSlotIDs` in `src/pltt.c`) で決まる。ビューワはスロットを再現せず、plttID の 16 色をそのまま当てる
- `Video_SetAuxSpritePltt` は `plttID < gObjPlttLen` (`= length`) のときだけ差し替える。ビューワの plttID の入力も `length - 1` までに制限している

### BG Palette タブ

- `view_bgpltt.tsx`。ファイルの一覧 (decomp の `BGP_*` の名前つき) から選び、16 本を並べ、選んだ 1 本の 16 色を表にする
- 詳細の表の `header` は 20 バイトをそのまま 16 進で出す
- `read at` は decomp のソースでそのファイルが読まれている場所 (`generated/bgpltt_refs.ts`)。`tools/gen_tables.ts` が `GetBgPlttFile(X)` / `GetFile(DIR_BGPLTT, X)` を探し、`X` が定数か 16 進数のリテラルのものだけを拾う。変数で ID を渡す所 (`map_pltt_4ae5.c` の `bgpIDs[]` など) は出ない

### 16 本の使い分け (ゲーム側)

1 つのファイルの 16 本を 1 か所がまとめて使うとは限らない。decomp で見える使い方:

| 本 | 使い方 | 根拠 |
| --- | --- | --- |
| 0–12 | マップのパレット (208 色) | `MapPltt_BuildWeather`, `MapPltt_Fill` (`src/map_pltt_4ae5.c`) |
| 13 | メニュー | `BgPlttRow13` (`src/menu.c`) |
| 13–15 | 画面ごとの UI (`body[208]` から 48 色を `gBgPlttBuffer[208]` へ) | `src/dark_loans.c`, `src/enemy_dex.c` |
| 14–15 | フォント (`BGP_529C` / `BGP_539C`) | `Font_SetPltt` (`src/font.c`)。[font.md](font.md) |
| 15 | メッセージウィンドウ | `MessageWindow_UploadBgPltt` (`src/message_window.c`) |

ほかのタブで BG パレットを選ぶときは `BgPlttSelect` (`components.tsx`) を使う。ファイルを選ばなければグレースケール (`GRAYSCALE_PLTT` in `render.ts`、色 0 が黒、色 15 が白) で描く。どのタイルマップにどのパレットを当てるかは [bg.md](bg.md) と [map.md](map.md) を見る。

## 根拠

- `include/sprite_pltt.h`: `ObjPlttFile`, `gObjPlttData`
- `src/video.c`: `InitPltt`, `Video_SetAuxSpritePltt`, `Video_GetAuxSprite` (`gfx->pltt = &gObjPlttData[gfx->plttID * 16]`)
- `src/iwram2.c`: `gObjPlttLen` (`= ObjPlttFile.length`)
- `src/pltt.c`: `ResetPltt`, `AllocParticlePlttSlot`, `gObjPlttSlotIDs`
- `src/data/obp.s`: `gSpritePlttsDirectory`, `gObjPlttFile0` (`length = 768`, `unk_02 = 171`)
- `include/bg_pltt.h`: `BgPlttFile` (`static_assert(sizeof(BgPlttFile) == 532)`), `BGP_*`, `GetBgPlttFile`
- `src/data/bgp.s`: `gPlttDirectory` (232 ファイル) と各ファイルの `header`
- `src/font.c` `Font_SetPltt`, `src/message_window.c` `MessageWindow_UploadBgPltt`, `src/menu.c` `BgPlttRow13`, `src/map_pltt_4ae5.c` `MapPltt_*`

## 未解明

- `ObjPlttFile.unk_02`: `InitPltt` は読まず、ほかに読む所も見つかっていない
- `BgPlttFile.header` (20 バイト): ゲームが読む所は見つかっていない (`include/bg_pltt.h` のコメントも「使われてるか不明」)。U32J rev1 の値は次の形だけで、残りのバイトは `0xFF` で埋まっている

| 先頭からのバイト (以降は `0xFF`) | ファイル数 |
| --- | --- |
| `05 00 03 10 00 0D` | 113 |
| `07 00 05 10 00 0C FF 0D` | 96 |
| `04 10 02 10 0D` | 10 |
| `04 10 02 0E 0D` | 1 |
| `01 00 01 xx 00` (`xx` は `03`, `05`, `0A`, `0C`, `0D`, `0E`, `0F` のどれか) | 12 |

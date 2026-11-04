# BG (タイルセット / タイルマップ / BG の割り当て)

BG の絵は、GBA タイル (4bpp, 8x8) を BG VRAM に置き、メタタイル (16x16) の並びで BG マップを作って出す。
タイルの出どころはタイルセットの部品 (`tileset.ts`) か、タイルマップファイル内のタイル (`tilemap.ts`) のどちらか。
どの BG に載せ、VRAM のどこにタイルを置くかはファイルではなくスクリプトの引数が決める。

## ROM 上の位置

どちらも gFS のディレクトリから引く ([filesystem.md](filesystem.md))。番地は U32J rev1 のもの (decomp の `src/data/*.s`)。

| もの | ディレクトリID (`fs.ts`) | decomp のシンボル | ファイル数 |
| --- | --- | --- | --- |
| タイルセット | `DIR_TILESET` = `0xCEEF` | `gTilesetsDirectory` (`0x0881882C`) | 1 (ID `0x8E32`, `TilesetFile0` = `0x08818848`) |
| タイルマップ | `DIR_TILE_MAP` = `0xC091` | `gTilemapDirectory` (`0x085B26E4`) | 279 |

- タイルセットはゲーム全体で 1 ファイル (`0x8E32`) だけで、`TileSetPart` (部品) ごとにスクリプトから読み込む。U32J の値は partCount 257, tileRefCount 111526, tileCount 53062
- タイルマップは LZ77 で圧縮されていることがある。先頭が `"MP"` なら非圧縮 (`GetTilemapFile`)

## 構造

ポインタに見えるメンバは、ROM ではファイル先頭からのバイトオフセット。ゲームは読み込み時に自分でファイルの番地を足す。

### TileSetFile (`include/tilesets.h` の `TileSet`)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u16 | partCount | 部品の数 |
| `0x02` | u16 | unk_2 | 不明 (decomp: padding?)。U32J では 1 |
| `0x04` | u32 | tileRefCount | refs の要素数 (コードでは `refCount`) |
| `0x08` | u32 | tileCount | tiles の枚数 |
| `0x0C` | u32 | parts | `TileSetPart[partCount]` へのオフセット |
| `0x10` | u32 | refs | `u16[tileRefCount]` へのオフセット。各値は tiles の何枚目か |
| `0x14` | u32 | tiles | 4bpp タイル (`32 * tileCount` バイト) へのオフセット |

### TileSetPart (8 バイト)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u16 | id | 部品ID。`Cmd_LoadTileSet` の `'.c'` で指す |
| `0x02` | u16 | tileCount | この部品が VRAM に並べるタイルの数 |
| `0x04` | u32 | startIndex | refs の先頭からの**バイト**オフセット (要素番号ではない)。`Video_LoadTileSetParts` が `(u8*)refs + startIndex` として使う |

部品が VRAM に並べる k 枚目のタイルは `tiles[refs[startIndex / 2 + k]]`。同じタイルを複数の部品が参照できる。

### TilemapFile (`include/tilemap.h` の `Tilemaps`)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | char[4] | magic | `"MP\0\0"` |
| `0x04` | u16 | layerCount | レイヤ数 |
| `0x06` | u16 | tileCount | ファイル内の GBA タイルの数 |
| `0x08` | u16 | metatileCount | メタタイルの数 |
| `0x0A` | u16 | loadOffset | ファイル内のタイルを置く VRAM 上の位置 (タイル単位)。`Cmd_LoadTileSet` の `'.m'` もこの値を使う |
| `0x0C` | u32 | layers | `TilemapLayer[layerCount]` へのオフセット |
| `0x10` | u32 | tiles | タイル (`32 * tileCount` バイト) へのオフセット。**0 ならファイル内にタイルは無い** (タイルはスクリプトがタイルセットから読む) |
| `0x14` | u32 | metatiles | `BgMapEntry[metatileCount * 4]` へのオフセット |

ヘッダの後には layers, tiles, metatiles, 各レイヤの mtmap が並ぶ (decomp のコメント)。

### TilemapLayer (12 バイト)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u16 | width | 幅 (メタタイル単位) |
| `0x02` | u16 | height | 高さ (メタタイル単位) |
| `0x04` | u16 | id | レイヤID。`Cmd_LoadTileMap` の `'.c'` がこの値でレイヤを探す (`FUN_08000c84`) |
| `0x06` | u16 | unk_6 | 不明 (decomp: padding?) |
| `0x08` | u32 | mtmap | `u16[width * height]` (メタタイル番号) へのオフセット (ファイル先頭から) |

### メタタイルと mtmap

- メタタイル 1 つは `BgMapEntry` 4 つ (`metatiles[mt * 4 + k]`, k = 0: 左上, 1: 右上, 2: 左下, 3: 右下)
- mtmap は行優先ではなく、16x16 メタタイルのブロック単位で並ぶ。ブロックは横に `width >> 4` 個ずつ並ぶ (`Video_GenerateBGMapCore`)

```
index = ((my >> 4) * (width >> 4) + (mx >> 4)) * 256 + (my & 15) * 16 + (mx & 15)
```

### BgMapEntry (u16, `include/gba/types.h`)

| ビット | 意味 |
| --- | --- |
| 0-9 | タイル番号 (BG のキャラクタブロックの先頭から) |
| 10 | 左右反転 |
| 11 | 上下反転 |
| 12-15 | パレット番号 (16 色 x 16 行の何行目か) |

### BG の構成 (`Cmd_LoadTileMap` の `'.t'`)

`Cmd_LoadTileMap` (`0x7A27`) は `'.d'` のタイルマップを `Video_SetupBGLayout(layout = '.t', ..., count = '.n', indices)` に渡す。`'.t'` の既定値は 1, `'.n'` の既定値は 1。

| `'.t'` | 使う BG (k = 0, 1, 2 の順) | キャラクタブロック | ファイル内タイルの転送先 (BG VRAM 先頭から) |
| --- | --- | --- | --- |
| 0 | BG0 | 2 (`0x8000`) | `0x8000` (loadOffset を見ない) |
| 1 | BG2, BG3 | 0 | `loadOffset * 32` |
| 2 | BG3 | 0 | `loadOffset * 32` |
| 3 | BG1 | 0 | `loadOffset * 32` |
| 4 | BG1, BG3 | 0 | `loadOffset * 32` |
| 5 | BG2, BG1 | 0 | `loadOffset * 32` |
| 6 | BG1 | 2 (`0x8000`) | `0x8000` (loadOffset を見ない) |
| 7 | BG2, BG3, BG1 | 0 | `loadOffset * 32` |
| 8 以上 | なし (BG2 のキャラクタブロックを 0 にするだけ) | 0 | `0` |

- 1, 4, 5 は `'.n'` が 2 のときだけ 2 つ目の BG を使う。7 は `'.n'` によらず 3 つ使う
- k 番目の BG に載せるレイヤは、`k < '.n'` なら `indices[k]`、そうでなければ k。`indices` は `'.i'` の値 (足りない分は 0)、`'.i'` が無く `'.c'` があればレイヤID から引いた番号 (見つからなければ 0, 足りない分は k)、どちらも無ければ `[0, 1, 2, 3]`
- ファイル内のタイルは、`tileCount != 0` かつ tiles のオフセットが 0 でないときだけ、`Video_RequestBGTileData` で 1 つ目の BG の転送として予約され、VBlank の `CopyBGTileDataAndTilemapToVram` で VRAM に送られる
- BgMapEntry のタイル番号はキャラクタブロックの先頭から数える。キャラクタブロック 0 の構成では、タイルは `loadOffset` に置かれるので、エントリのタイル番号は loadOffset を足した値になっているはず (推測, ハードウェアの仕組みからの帰結)

### タイルセットの読み込み (`Cmd_LoadTileSet`)

`Cmd_LoadTileSet` (`0x11D4`) の引数: `'.t'` BG 番号 (既定 0), `'.d'` タイルセットのファイルID, `'.s'` 読み込み先のタイル番号 (既定 0), `'.c'` 部品ID の列 (最大 64), `'.m'` タイルマップID。

- `'.m'` があれば、読み込み先をそのタイルマップの `loadOffset` にする (`'.s'` より優先)
- `Video_LoadTileSetParts` は、`'.t'` が 0 (BG0) なら読み込み先によらず VRAM の `0x8000` から、そうでなければ `読み込み先 * 32` から、部品の参照するタイルを部品の順に 1 枚ずつ DMA で詰めて書く。VBlank を待たずにその場で書く

### BG の優先度と重なり順

- 優先度の既定値は BG0: 0, BG1: 1, BG2: 3, BG3: 1。起動時の `Video_InitBGMode(0)` (`src/interrupts.c`) が BGnCNT にこの値を入れ、`Cmd_CreateBG` (`0xB4B4`) の `'.p'` の既定値も BG ごとに同じ値
- `Cmd_CreateBG` は `'.i'` の BG の優先度を `'.p'` にする (`BgMapScroller_Init` → `SetBGPrioDirect`)
- 重なり順は GBA のハードウェアの規則: 優先度の数が大きいほど奥。同じなら BG 番号の大きい方が奥。コードでは `bgDepth(bg, prio) = prio * 4 + bg` が大きいほど奥

## パースの手順

1. `parseTileSets` (`tileset.ts`): `fs.list(DIR_TILESET)` の各ファイルのヘッダを読み、部品ごとに `refsOfs + startIndex + j * 2` から `tileCount` 個の u16 を読んで `refs` にする。`tiles` は `tilesOfs` から `tileCount * 32` バイト
2. `partTiles` (`tileset.ts`): 部品の `refs` の順に `tiles[r]` を詰めた配列を作る。`Video_LoadTileSetParts` が DMA で流す内容と同じ
3. `parseTilemap` (`tilemap.ts`): 先頭 2 バイトが `"MP"` なら ROM をそのまま読む。そうでなければ `decompressLZ77` で展開し、先頭 4 バイトを捨てる (ゲームは展開先を `gTilemapFileBufferHead` にし、本体は 4 バイト後ろの `gTilemapFileBuffer` から始まる)。展開と LZ77 は [filesystem.md](filesystem.md)
4. 同じく `parseTilemap`: ヘッダ、各レイヤ (`width * height` 個の mtmap)、metatiles を読む。tiles のオフセットが 0 でなければ `tileCount * 32` バイトを `tiles` に取り、0 なら `tiles` は `undefined`。`size` は metatiles と mtmap の終わりの最大値 (表示用)
5. `mtmapIndex` (`tilemap.ts`): 上のブロック単位の式で mtmap の添字を出す
6. BG の割り当て (`tilemap.ts`, 上の表と同じ規則): `loadIndices` が `'.i'` / `'.c'` から indices を作り (`'.c'` はタイルマップのレイヤID から引く)、`layerBGs('.t', '.n', indices)` が `[BG, レイヤ番号]` の並びを返す。`layoutBGs` はレイヤを問わない BG の並び、`layoutCharBase` はキャラクタブロックの位置、`layoutTileOffset` はファイル内のタイルを置く位置 (8 以上は 0)。`'.t'` と `'.n'` が無いときは `DEFAULT_LAYOUT` (1) と `DEFAULT_LAYER_COUNT` (1)。`DEFAULT_BG_PRIO` と `bgDepth` は優先度と重なり順。スクリプトから値が決まらなかったレイヤ番号 (`null`) は、Map タブでは k 番目のレイヤにする (推測)
7. 描画: `drawEntry` が BgMapEntry 1 つ (反転とパレット行を含む) を、`drawMetatile` がメタタイル 1 つを描く。`renderComposite` はレイヤを渡された順 (奥 → 手前) に重ね、大きさは一番大きいレイヤに合わせる。色 0 を透明にするかの設定は一番奥のレイヤにだけ効き、手前のレイヤの色 0 は常に透明。`renderMetatiles` はメタタイルを番号順に 16 個ずつ並べる

## 表示での扱い

- Tileset タブ (`view_tileset.tsx`): 部品の一覧から 1 つ選び、`renderTileGrid(ts.tiles, part.refs, ...)` で VRAM に並ぶ順にタイルを出す。パレットは BG パレットから手で選ぶ ([palette.md](palette.md))。マウスの下のタイルは「読み込み先の先頭 + k → `tiles[refs[k]]`」と出す。詳細の表の startIndex は 16 進のバイトオフセットと、それを 2 で割った refs の要素番号の両方を出す
- Tilemap タブ (`view_tilemap.tsx`): ファイル単体で分かることだけを出す。タイルの読み込み元はファイルから決まらないので手で選ぶ (ファイル内のタイル / タイルセットの部品 / なし)。既定はファイル内のタイル、無ければ tileCount が同じ部品のうち最初のもの (これは見当を付けるための既定値で、ゲームの対応関係ではない)
  - VRAM はキャラクタブロック 1 つ分 (1024 タイル) で、選んだタイルを常に `loadOffset` に置く。`'.t'` による `0x8000` への置き換えはスクリプトが決めるので、ここでは扱わない (Map タブで扱う)
  - 表示は「レイヤ」(チェックしたレイヤを番号順に重ねる, #0 が一番奥)、「メタタイル一覧」、「GBA タイル一覧」(loadOffset から tileCount 枚, パレット行を選ぶ) の 3 つ
  - 「used by Map」は、このタイルマップを読み込む場面を持つ Map の一覧 ([map.md](map.md))
- BG に載せた組み合わせで見るのは Map タブ ([map.md](map.md))

## 根拠

- `include/tilesets.h` (`TileSet`, `TileSetPart`), `include/tilemap.h` (`Tilemaps`, `TilemapLayer`), `include/gba/types.h` (`BgMapEntry` のビット)
- `src/data/tilesets.s` (`gTilesetsDirectory`, ファイルID `0x8E32`, `TilesetFile0` のヘッダ値), `src/data/tilemap.s` (`gTilemapDirectory`)
- `src/bg.c`
  - `Video_LoadTileSetParts`: `(u16*)((u32)hdr.refs + part->startIndex)`, BG0 なら `0x8000`, 1 枚ずつ DMA
  - `GetTilemapFile`: `"MP"` の判定、`LZ77UnCompWram(file, gTilemapFileBufferHead)`、`gTilemapFileBuffer` を返す
  - `Video_InitBGMode`: mode 0 の BGnCNT の優先度 0/1/3/1 とキャラクタブロック (BG0 だけ 2)
  - `Video_RequestBGTileData`, `CopyBGTileDataAndTilemapToVram`: ファイル内タイルの転送は VBlank
- `asm/func/Video_SetupBGLayout.inc`: `'.t'` ごとの分岐表 (BG 番号, `SetBGCharBaseDirect`, `'.n' == 2` の判定, 転送先 `0x8000` / `loadOffset << 5` / 0)、`tileCount != 0 && tiles != f` のときだけ `Video_RequestBGTileData`、`k < count` のときだけ `indices[k]` を使うレイヤの選び方
- `asm/func/Video_GenerateBGMapCore.inc`: mtmap の添字 (`(x >> 5)` のブロックを `<< 8`, ブロックの横の数は `width >> 4`)、メタタイルの 4 エントリの位置 (+0, +2, +4, +6)
- `src/entity_08000a94.c`
  - `Cmd_LoadTileSet` (asm は `asm/func/Cmd_LoadTileSet.inc`): 引数と既定値 (`'t'` は 0)、`'.m'` で `tileidx = loadOffset`
  - `Cmd_LoadTileMap`: `'.t'` 既定 1, `'.n'` 既定 1, `'.i'` / `'.c'` (`FUN_08000c84`) によるレイヤの並び
  - `Cmd_CreateBG`: `'.p'` の BG ごとの既定値 0/1/3/1、`BgMapScroller_Init` の `SetBGPrioDirect`
- `src/interrupts.c`: 起動時の `Video_InitBGMode(0)`

## 未解明

- `TileSet.unk_2` と `TilemapLayer.unk_6` の意味
- `'.t'` が 0 / 6 のファイル (タイルを `0x8000` に置き loadOffset を見ない) で、BgMapEntry のタイル番号が何を基準にしているか (キャラクタブロック 2 の先頭からのはずだが、ROM のデータで確かめていない)
- `Video_SetupBGLayout` の第 2 引数 (`gBgStates[].unk_00` に入る) の意味。`Video_GenerateBGMapCore` はこれが 1 か 2 かで分岐し、2 のときはマップの外を 0 以外のエントリで埋めるように見える (推測, 詳しくは読んでいない)。`Cmd_LoadTileMap` は 0 を渡すが、`BgMapScroller_Init` が `Cmd_CreateBG` の `'.f'` の bit4 (`BGSCROLL_UNK_4`) で上書きする。ツールはこれを見ていない

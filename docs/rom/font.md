# フォント

テキストの字形は `DIR_FONT` のファイル `0x3F51` 1 つにまとまっている。半角 (8x16, 2 タイル) と全角 (16x16, 4 タイル) の 4bpp タイルが字形番号の順に並ぶ。 ゲームは文字コードを字形番号に直して描き、色は BG パレットの 15 本目で付ける。style で各ドットの色番号を変える。ボクタイ1 (U3IJ) だけは全角が 12x12 で、形が違う ([全角の字形 (U3IJ)](#全角の字形-u3ij))。

## ROM 上の位置

- `GetFile(DIR_FONT, 0x3F51)` (`Font_LoadInfo`)。ゲームが読むのはこのファイルだけ。U32J rev1 では `DIR_FONT` のファイルもこれ 1 つ (`gFontFile0`, `0x089EE090`)
- 字形のタイルは、ファイル先頭からのオフセット (`hankaku`, `zenkaku`) で指す。U32J rev1 では半角が `0x089EE09C`、全角が `0x089F009C` から
- 色は BG パレットのファイル (`BGP_529C` / `BGP_539C`、`Font_SetPltt`) の 14・15 本目。BG パレットの形は [palette.md](palette.md#bgplttfile) を見る
- ディレクトリの引き方は [filesystem.md](filesystem.md#gfs) を見る

## 構造

### FontFile (FontInfo)

ヘッダ 12 バイト。decomp では ROM 上のものを `FontFile`、RAM にコピーしてオフセットをアドレスに直したものを `FontInfo` と呼ぶ (同じ型)。

| オフセット | 型  | 名前             | 意味                                              |
| ---------- | --- | ---------------- | ------------------------------------------------- |
| `0x00`     | u16 | hankakuCharCount | 半角の字形数。U32J rev1 では 128、U3IJ では 191   |
| `0x02`     | u16 | zenkakuCharCount | 全角の字形数。U32J rev1 では 1537、U3IJ では 1281 |
| `0x04`     | u32 | hankaku          | ファイル先頭から半角のタイルまでのオフセット      |
| `0x08`     | u32 | zenkaku          | ファイル先頭から全角のタイルまでのオフセット      |

### 半角の字形

字形番号 `g` ごとに 64 バイト (4bpp のタイル 2 枚)。

| オフセット                | 型               | 名前 | 意味         |
| ------------------------- | ---------------- | ---- | ------------ |
| `hankaku + g * 64 + 0x00` | tile (32 バイト) | 上   | 上半分の 8x8 |
| `hankaku + g * 64 + 0x20` | tile             | 下   | 下半分の 8x8 |

### 全角の字形

字形番号 `g` ごとに 128 バイト (4bpp のタイル 4 枚)。

| オフセット                 | 型   | 名前 | 意味 |
| -------------------------- | ---- | ---- | ---- |
| `zenkaku + g * 128 + 0x00` | tile | 左上 |      |
| `zenkaku + g * 128 + 0x20` | tile | 右上 |      |
| `zenkaku + g * 128 + 0x40` | tile | 左下 |      |
| `zenkaku + g * 128 + 0x60` | tile | 右下 |      |

タイルは GBA の 4bpp。1 行 4 バイトで 8 行、各バイトの下位 4 ビットが左のドット、上位 4 ビットが右のドット。

### 全角の字形 (U3IJ)

U3IJ の全角は 12x12 で、タイルに分けず 1 字を 1 枚の絵として持つ。字形番号 `g` ごとに 72 バイトで、`zenkaku + g * 72 + y * 6` から 1 行 6 バイト (12 ドット) が上から 12 行並ぶ。ドットの詰め方はタイルと同じ (下位 4 ビットが左)。半角は U32J と同じ 8x16。

- 出典は bokmagic (`lib/src/FontModel.cpp` の `engine == 1` の分岐、`lib/src/PPU.cpp` の `ppuDrawTile12x12Opaque`)。ボクタイ1 の decomp は無いので、ゲームがこれをどう VRAM に置くかは確かめていない
- 描いてみると、どちらの作品も 16 番 (U3IJ では「果」、U32J では「上」) など、かなの途中に漢字が混ざる。字形の並びがそうなっている (描き方のずれではない)

### 字形番号と文字コード (U32J のみ)

U32J のテキストの文字コードから字形番号へは次のように直す (`TextRenderer_DrawNextChar`, `Video_DrawText`)。

| 文字コード                            | 種類 | 字形番号                   |
| ------------------------------------- | ---- | -------------------------- |
| 1 バイト `c` (bit 7 が 0)             | 半角 | `c - 0x20`                 |
| 2 バイト `b0 b1` (`b0` の bit 7 が 1) | 全角 | `((b0 & 0x7F) << 8) \| b1` |

- `'<'` で始まるタグ、`'\n'`、`0x1F` のエスケープは字形にせず別に処理する
- 全角の字形番号が `zenkakuCharCount` 以上なら描かずにカーソルだけ進める
- この変換と `charmap.txt` は U32J のもの。U33J では文字コードが違うので使わない

### style

`Font_AcquireGlyph` は字形のタイルを VRAM へ送る前に、各ドットの色番号に `style << 2` を OR する。

| style | OR する値 | ゲームで使う所                                                                   |
| ----- | --------- | -------------------------------------------------------------------------------- |
| 0     | `0`       | 通常                                                                             |
| 1     | `4`       | `<WEIGHT>`, `<ALTER>` タグ (`TextRenderer_HandleTag`)、`Video_DrawText` の `'<'` |
| 2     | `8`       | `<NONSEL>`, `<UVMOJI>` タグ (`TextRenderer_HandleTag`)                           |

タイルを 4 バイトずつ `w` として、`hi = (style * 0x01010101) << 6`, `lo = (style * 0x01010101) << 2` を作り、`((w & 0xF0F0F0F0) | hi) & 0xF0F0F0F0` と `((w & 0x0F0F0F0F) | lo) & 0x0F0F0F0F` を合わせる。各 4 ビットに収まらない分は落ちるので、実質 `(style & 3) << 2` を OR することになる。

## パースの手順

1. `parseFonts` (`font.ts`) が `fs.list(DIR_FONT)` の全ファイルを読む
2. 全角の大きさ `zenkakuSize` を gameID で決める (U3IJ は 12、ほかは 16)
3. 各ファイルの `0x00` を `hankakuCount`、`0x02` を `zenkakuCount` にする
4. `0x04` のオフセットから `hankakuCount * 64` バイトを `hankaku`、`0x08` のオフセットから `zenkakuCount * 128` バイト (U3IJ は `* 72`) を `zenkaku` にする (ROM の `Uint8Array` のビュー)。`Font_LoadInfo` がオフセットにファイルの先頭アドレスを足すのと同じ
5. `renderGlyphs` (`font.ts`) が字形を番号順に `cols` 個ずつ並べて `Pixels` (`render.ts`, RGBA の画像) に描く
   1. 半角はタイル `t` (0, 1) を縦に、全角は `t` (0–3) を左上 → 右上 → 左下 → 右下に置く。`Font_DrawHankakuChar` / `Font_DrawZenkakuChar` の並べ方と同じ。12x12 の全角は 1 行 6 バイトずつ上から置く
   2. 各ドットの色番号に `(style & 3) << 2` を OR する
   3. 色番号が 0 でなければ、渡された 16 色 (BG パレットの 1 本) の色で塗る。0 なら透明のまま

## 表示での扱い

- Font タブ (`view_font.tsx`) は `font.ts` の `FONT_FILE` (`0x3F51`) を ID で引いて使う (無ければ `DIR_FONT` の最初のファイル)。U32J rev1 ではファイルは 1 つだけ
- パレットは `BGP_529C` (`Font_SetPltt(0)`) と `BGP_539C` (`Font_SetPltt(1)`) から選び、既定は 15 本目。`Font_DrawHankakuChar` / `Font_DrawZenkakuChar` はタイルマップに常にパレット 15 を書く (マップのエントリは `0xF000 | (0x100 + キャッシュの番号)`)
- U3IJ には `BGP_529C` / `BGP_539C` が無い。パレットが無いときは、色 1 を黒、色 4 を白にした灰色 (`view_font.tsx` の `FALLBACK_PLTT`、色 5–8 などは `(色 - 1) & 3` で同じ明るさ) で描き、そう表示する
- 色 0 は透明。ただし style が 0 でないと色 0 のドットも `style << 2` になり、透明でなくなる。ゲームと同じ計算をしているため
- U32J rev1 の字形データで使われている色番号は 0–4 だけで、いちばん多いのは 4。色 4 が字の背景に当たると思われる (推測。`Font_ClearGlyphVram` も字形の VRAM を `0x44444444` で埋める)。ビューワは色 4 を透明にしないので、背景も 15 本目の色 4 で塗られる
- マウスを乗せると字形番号を出す。U32J (rev1, rev0) のときだけ、文字コード (`codeOf`: 半角は `g + 0x20`、全角は `(g >> 8) | 0x80` と `g & 0xFF`) と文字も出す。文字は `generated/charmap.ts` の表で、`tools/gen_tables.ts` が decomp の `charmap.txt` から作る。1 つの字形に複数の名前があるときは `/` でつなぎ、記号の名前は `{QT}` のように `{}` で囲む
- ゲームは字形をタイル 1 枚ずつ `gGlyphCache` (256 枚分) に登録して VRAM の空きに送り、同じ (字形番号, タイル, style, 半角/全角) の組なら使い回す (`Font_FindGlyph`)。ビューワはこのキャッシュを再現しない

## 根拠

- `src/font.c`: `FontInfo` / `FontFile`, `Font_LoadInfo`, `Font_FindGlyph`, `Font_AcquireGlyph`, `Font_ClearGlyphVram`, `Font_SetPltt`
- `asm/func/Font_DrawHankakuChar.inc`, `asm/func/Font_DrawZenkakuChar.inc`: タイルの並べ方、パレット 15、`Font_AcquireGlyph` への引数 (字形番号, タイルの番号, style, 半角 0 / 全角 1)
- `src/text_renderer.c`: `TextRenderer_DrawNextChar` (文字コード → 字形番号), `TextRenderer_HandleTag` (style), `Text_GetEscapeCharcode`, `gEscapeCharcodes`
- `src/code_0821b21c.c`: `Video_DrawText` (文字コード → 字形番号)
- `src/message_window.c`: `MessageWindow_UploadBgPltt`
- `src/data/fonts.s`: `gFontDirectory`, `gFontFile0` (128, 1537)
- bokmagic `lib/src/FontModel.cpp`, `lib/src/PPU.cpp`: U3IJ の 12x12 の全角
- `include/bg_pltt.h`: `BGP_529C`, `BGP_539C`
- `charmap.txt`: 文字コードと文字の対応

## 未解明

- U3IJ の字の色を決めるパレットと、文字コードから字形番号への直し方は分かっていない (ボクタイ1 の decomp が無い)

- `Font_SetPltt` を呼んでいる所は decomp の中に見つからない。メッセージウィンドウは `MessageWindow_UploadBgPltt` で、ウィンドウごとのパレットファイルの 15 本目を `gBgPlttBuffer` の 15 本目へ送る。実際の字の色はこちらで決まる場面があり、`BGP_529C` / `BGP_539C` の 15 本目がゲームの文字色そのものかは確かめていない
- `0x1F` のエスケープ (`Text_GetEscapeCharcode`) で描く半角の字形は `generated/charmap.ts` に入っていない (`gen_tables.ts` は 1 バイトの `0x20`–`0x7F` と、先頭が `0x80` 以上の 2 バイトだけを拾う)。`gEscapeCharcodes` には `hankakuCharCount` (128) 以上の値もあり、それがどの字形になるかは確かめていない
- `gEscapeCharcodes` の decomp のコメントは「bit15 が立っていれば全角」とするが、`TextRenderer_DrawNextChar` (C とアセンブリ) は bit15 が立っていても `charcode & 0x7FFF` を半角として描く

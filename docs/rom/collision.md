# Collision Map と投影

Collision Map は、マップの床の高さ・階段・属性と、ゾーン・経路・ナビメッシュをまとめたファイル (`collision.ts`)。グラフィックは含まない。
ワールドは床を上から見た格子 (x, z) と高さ y で表し、画面にはアイソメトリックに投影する。その投影にファイル内のオフセットを足すと、対になるタイルマップのピクセル座標になる。

## ROM 上の位置

- gFS のディレクトリ `DIR_COLLISION_MAP` = `0xAE6C` ([filesystem.md](filesystem.md))。U32J rev1 では `gCollisionMapsDirectory` (`0x087B260C`), 246 ファイル
- 先頭が `"HP"` なら非圧縮、そうでなければ LZ77 で圧縮されている (`OpenCollisionMapFile`)
- スクリプトからは `Map_LoadMapScripted` (`0x30AD`) の `'.p'` で読み込む

## 構造

オフセットはすべて、(展開後の) ファイル本体の先頭から。ゲームは読み込み時にファイルの番地を足す (`Map_LoadCollisionMapFile`)。

### CollisionMapFile (`include/collision_map.h`)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | char[4] | magic | `"HP\0\0"` |
| `0x04` | u32 | tileData | `CollisionMapTileData` へのオフセット |
| `0x08` | u32 | zones | `ZoneData` へのオフセット |
| `0x0C` | u32 | paths | `PathData` へのオフセット |
| `0x10` | u32 | navMesh | `NavMesh` へのオフセット。0 なら無し |

### CollisionMapTileData

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u32 | unk_0 | 不明 (読むコードが見つかっていない) |
| `0x04` | s16 | width | x 方向のタイル数 |
| `0x06` | s16 | height | z 方向 (奥行き) のタイル数 |
| `0x08` | s16 | tilemapOffsetX | タイルマップの位置。`>> 4` してピクセルにする |
| `0x0A` | s16 | tilemapOffsetY | 同じく y |
| `0x0C` | CollisionMapTile[] | tiles | `width * height` 個。添字は `z * width + x` (`Map_BuildRowOffsets` の `rowOffsets[z] = z * width`) |

### CollisionMapTile (4 バイト)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u8 | heightStairs | 下位 4 ビット: 高さ (0-15)、上位 4 ビット: 階段 (0: なし, 1: 縦, 2: 横) |
| `0x01` | u8 | occluder | 手前にあるとき何かを隠すのに使う番号。`0xFF` で無し |
| `0x02` | u16 | attr | `TileAttr` のビット (下の表) |

`TileAttr` のうち意味の分かっているもの (decomp の `TATTR_*`): bit1 `WALL` (常に侵入不可), bit6 `FALLDEATH` (落下死・水に落ちる), bit7 `SPECIAL` (氷の床・溶岩など, ステージで変わる), bit10 `WALLISH` (`WALL` との違いは不明)。他の bit0, 2-5, 8, 11, 12 は `UNK_*`。

### ZoneData

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u8 | count | ゾーンの数 |
| `0x01` | u8 | unk_1 | 不明 (padding?) |
| `0x02` | u16 | unk_2 | 不明 (padding?) |
| `0x04` | Zone[count] | zones | 1 つ 12 バイト |

Zone:

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | s16 | x1 | 範囲の始端 (x, 1 タイル = 256) |
| `0x02` | s16 | y1 | 範囲の始端 (ワールドの z と比べる) |
| `0x04` | s16 | x2 | 範囲の終端 (含まない) |
| `0x06` | s16 | y2 | 範囲の終端 (z, 含まない) |
| `0x08` | u8 | z1 | 高さの始端 (1 タイル = 16) |
| `0x09` | u8 | z2 | 高さの終端。範囲の判定には使われない |
| `0x0A` | u16 | id | スクリプトがゾーンを指すときの ID |

### PathData

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u16 | pathCount | 経路の数 |
| `0x02` | u16 | unk_02 | 不明 |
| `0x04` | Path[pathCount] | paths | 1 つ 4 バイト |

Path:

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u8 | nodeCount | ノードの数 |
| `0x01` | u8 | unk_1 | 不明 (padding?) |
| `0x02` | u16 | nodeOffset | PathData の先頭から最初のノードへのバイトオフセット (`Map_GetPathNodes`) |

PathNode (8 バイト):

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u16 | x | x (1 タイル = 256) |
| `0x02` | u16 | y | ワールドの z |
| `0x04` | u16 | delay | 下位 12 ビット: コマンド後の待ちフレーム数。上位 4 ビットは不明 |
| `0x06` | u8 | command | 上位 4 ビットがコマンド (0x00: 移動, 0x10: 方向転換 など, decomp のコメント) |
| `0x07` | u8 | unk_7 | 不明 (padding?) |

### NavMesh

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u16 | countIslands | 島の数 |
| `0x02` | u16 | unk_02 | 不明 (padding?) |
| `0x04` | u32[countIslands] | islandOffsets | NavMesh の先頭から各 NavIsland へのオフセット |

NavIsland (配列のオフセットは島の先頭から):

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u16 | countRects | rects の数 |
| `0x02` | u16 | countPortals | portals の数 |
| `0x04` | u16 | countDistanceMap | distanceMap の要素数 |
| `0x08` | u32 | offsetToRects | NavRect[] (16 バイト) へのオフセット |
| `0x0C` | u32 | offsetToPortals | NavPortal[] (12 バイト) へのオフセット |
| `0x10` | u32 | offsetToDistanceMap | u16[] へのオフセット |

- NavRect: `0x00` u8 minX, `0x01` u8 minY (z), `0x02` u8 maxX, `0x03` u8 maxY (含まない, いずれもタイル単位), `0x04` u8[12] portals (ポータル番号, 未使用は末尾に `0xFF`)
- NavPortal: `0x00` u16 x, `0x02` u16 y (z, 1 タイル = 256), `0x04` u16 unk_4, `0x06` u8[6] rects (矩形番号, 未使用は末尾に `0xFF`)

### 座標系とタイルマップへの投影

ワールド座標は x, z が床の格子 (1 タイル = 256)、y が高さ (高さ 1 段 = 256, タイルの高さ h の床は `y = h << 8`)。

`MainSprite_DrawListInternal` はワールド座標を次の式で画面に投影する (C の整数除算, 0 方向への切り捨て)。

```
a = ((x >> 1) + (z >> 1)) * 48 / 256
b = y * 24 / 256
screen.x = ((x >> 1) - (z >> 1)) * 48 / 256 - camera.x + 120
screen.y = a - b - camera.y + 90
```

カメラに付いて動く BG (`Cmd_CreateBG` の `'.f'` に `BGSCROLL_FOLLOW_CAMERA`) のスクロールは `hofs = camera.x + tilemapX - 120`, `vofs = camera.y + tilemapY - 90` で (`Video_GenerateBackgroundMaps`)、`tilemapX = tilemapOffsetX >> 4`, `tilemapY = tilemapOffsetY >> 4` (`Camera_SetTilemapOffset`)。画面の点の下にあるタイルマップのピクセルは `screen + ofs` なので、カメラが消えて次の式になる (`projectToTilemap`)。

```
x' = trunc(((x >> 1) - (z >> 1)) * 48 / 256) + (tilemapOffsetX >> 4)
y' = trunc(((x >> 1) + (z >> 1)) * 48 / 256) - trunc(y * 24 / 256) + (tilemapOffsetY >> 4)
```

- x が 1 タイル (256) 進むと (+24, +24)、z が 1 タイル進むと (-24, +24) 動く。1 タイルの上面は横 48・縦 48 の菱形で、辺の傾きは ±1
- 高さが 1 段 (256) 上がると 24 px 上にずれる
- 階段のタイルは上面が傾く。縦 (1) は `z & 0xFF`、横 (2) は `x & 0xFF` だけ高さが下がる (`TileHeightAt`, `Map_HasLineOfSight`)。つまり縦の階段は z の小さい辺が高さ h、大きい辺が h - 255
- この式が合うのは、カメラに付いて動き、視差の倍率 (`'.r'`) が 128 (等倍) で、`BGSCROLL_UNK_7` の補正が無い BG だけ

## パースの手順

1. `collisionFiles` (`collision.ts`): `fs.list(DIR_COLLISION_MAP)`
2. `parseCollisionMap`: 先頭 2 バイトが `"HP"` なら ROM をそのまま読む。そうでなければ `decompressLZ77` で展開し、先頭 4 バイトを捨てる (ゲームの展開先は `gDecompressedCollisionMapHeader` で、本体は 4 バイト後ろの `gDecompressedCollisionMapFile`)
3. tileData: width, height, tilemapOffsetX/Y と、`width * height` 個のタイルを `{ height: hs & 0xF, stairs: hs >> 4, occluder, attr }` にする
4. zones: `count` 個の Zone を読む
5. paths: `pathCount` 個の Path を読み、各ノードを `PathData の先頭 + nodeOffset + n * 8` から読む
6. navMesh: オフセットが 0 でなければ、島ごとに `NavMesh の先頭 + islandOffsets[k]` を島の先頭とし、rects / portals / distanceMap を島の先頭からのオフセットで読む。portals と rects の番号の列は `0xFF` で打ち切る
7. `projectToTilemap`: 上の投影の式
8. `tileCornerHeights`: タイルの上面の 4 隅 (x0z0, x1z0, x1z1, x0z1) の高さ。h = `height << 8`、縦の階段は z1 側、横の階段は x1 側が h - 255
9. `tileQuad`: 4 隅を `projectToTilemap` でタイルマップ上の 4 点にする。平らなタイルは菱形、階段は傾いた四角形
10. `tileAtTilemap`: タイルマップのピクセル (px, py) を上面に含むタイルのうち、`x + z` が一番大きい (一番手前の) ものを返す。判定は凸四角形の内外 (`inQuad`: 辺の外積の符号がそろうか)。上面だけで判定し、段差の側面は考えない

ゲームが実行中に差し替えるタイル (`MapTileOverride`) は扱わない。

## 表示での扱い

- Collision タブ (`view_collision.tsx`): 上から見た格子 (x が右, z が下, 1 タイル = 12 px * scale) に、タイルの高さ / 階段 / 属性 / occluder を色と文字で描く。属性と occluder は値ごとの凡例を出し、選んだ値以外を薄くする
  - ゾーン (矩形と ID)、経路 (折れ線とノード番号 `経路.ノード`)、ナビメッシュ (点線の矩形とポータル) を上から見た図で重ねる
  - マウスの下のタイルの値と、タイルの中心を含むゾーンを出す (`collisionTileText`)。ゾーンと経路は表にも出す (座標はタイル単位 = 値 / 256)
  - 「loaded by」は、このファイルを `'.p'` で読み込むスクリプトと、その呼び出しの `'.n'` のタイルマップ (`analysis.ts` の `collisionLoads`, [map.md](map.md))
- Map タブの重ね描き (`collision_overlay.tsx`)。どれもタイルマップと同じ大きさの canvas を重ねる
  - `CollisionOverlay`: 各タイルの `tileQuad` を `x + z` の小さい (奥の) 順に描く。塗りは属性 (`WALL` は赤, 0 は塗らない) / 高さ / 枠だけ から選び、不透明度を変えられる
  - `IsoGrid`: タイルの境目の線をタイルマップ全体に引く。z が一定の線は傾き +1、x が一定の線は傾き -1 で、どちらも 48 px おき。基準点は `projectToTilemap(map, 0, 0, level << 8)`。高さが 1 段違うと 24 px (格子の半分) ずれるので、線は高さごとに違う。高さの既定値は、そのマップで一番多いタイルの高さ
  - `WorldOverlay`: ゾーンは底の高さ `z1 * 16` の面に、経路のノードとナビメッシュのポータルはその位置の床の高さ (階段は無視) に、ナビメッシュの矩形は minX, minY のタイルの高さに置いて投影する
  - マウスの下の Collision Map のタイルは `tileAtTilemap` で決める

## 根拠

- `include/collision_map.h`: `CollisionMapFile`, `CollisionMapTileData`, `CollisionMapTile`, `TileAttr`, `Zone`, `ZoneData`, `Path`, `PathNode`, `PathData`, `NavMesh`, `NavIsland`
- `src/data/collision_map.s`: `gCollisionMapsDirectory`
- `src/camera.c`
  - `OpenCollisionMapFile`: `"HP"` の判定と `LZ77UnCompWram(file, gDecompressedCollisionMapHeader)`
  - `Map_LoadCollisionMapFile`: オフセットにファイルの番地を足す (navMesh は 0 なら足さない)
  - `Map_LoadMapScripted`: `'.p'` でファイルを読む。`'.n'` は読むが使わない
  - `Camera_SetTilemapOffset`: `tilemapX = tilemapOffsetX >> 4`
- `src/collision_map.c`: `Map_BuildRowOffsets` (`z * width`), `Map_GetPathNodes` (PathData の先頭 + nodeOffset), `Map_HasLineOfSight` (階段の高さ)
- `include/map_inline.h`: `GetCollisionTileIdx` (`rowOffsets[z] + x`), `TileHeightAt` (縦は `z & 0xFF`, 横は `x & 0xFF` を引く)
- `src/sprite_main_arm.c`: `MainSprite_DrawListInternal` の投影の式
- `src/entity_08000a94.c`: `Video_GenerateBackgroundMaps` と `BgMapScroller_Init` の `hofs = x - 120`, `x = gCameraVpCoords.x + gCameraCoords.tilemapX`

## 未解明

- `CollisionMapTileData.unk_0`, `occluder` が指すものの詳細, `TileAttr` の `UNK_*` ビット
- `PathNode.delay` の上位 4 ビット, `command` の多く, `NavPortal.unk_4`
- `distanceMap` の並び (ツールは読むだけで使っていない)
- `Map_LoadMapScripted` の `'.n'` はゲームが使わない。ツールはこれを対になるタイルマップの ID とみなしている (推測)

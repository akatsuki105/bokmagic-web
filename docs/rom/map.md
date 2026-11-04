# Map タブのマップの組み立て

ROM にはマップをまとめたファイルは無く、スクリプトがタイルセット・タイルマップ・BG パレット・Collision Map を順に読み込んでマップを作る。 Map タブは、スクリプトを静的に解析して読み込み呼び出しを拾い (`analysis.ts`)、ゲームと同じように VRAM と BG を組み立てて重ねる (`map.ts`)。 個々のフォーマットは [bg.md](bg.md), [collision.md](collision.md), [palette.md](palette.md) を参照。

## 組み立ての手順

ゲームがマップを作るときに使うスクリプトのサブルーチン (`src/vm_commands.s` の番号)。ツールはこれらの呼び出しを拾う (`script_scan.ts` の `SUB_*`)。

| 番号     | 関数                                      | 引数                                                                                   | 効果                                                                                    |
| -------- | ----------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `0x11D4` | `Cmd_LoadTileSet`                         | `'.t'` BG, `'.d'` ファイル, `'.c'` 部品ID の列, `'.s'` 読み込み先, `'.m'` タイルマップ | 部品のタイルをその場で VRAM に DMA で書く ([bg.md](bg.md))                              |
| `0x7A27` | `Cmd_LoadTileMap`                         | `'.d'` タイルマップ, `'.t'` BG の構成, `'.n'` レイヤ数, `'.i'` / `'.c'` レイヤの並び   | レイヤを BG に割り当て、ファイル内のタイルを VBlank での転送に予約する ([bg.md](bg.md)) |
| `0xB4B4` | `Cmd_CreateBG` (EntityCreate で呼ぶ)      | `'.i'` BG, `'.p'` 優先度, `'.d'` タイルマップ ほか                                     | BG の優先度を決め、毎フレーム BG マップを作り直す `BgMapScroller` を作る                |
| `0x4AE5` | `Entity4AE5_Create` (EntityCreate で呼ぶ) | `'.p'` BG パレットの列 (最大 4)                                                        | BG パレット ([palette.md](palette.md))                                                  |
| `0x30AD` | `Map_LoadMapScripted`                     | `'.p'` Collision Map, `'.n'`                                                           | Collision Map を読む ([collision.md](collision.md))。`'.n'` は使わない                  |
| `0x82B3` | `Cmd_82B3`                                | `'.s'` StageID                                                                         | `gStat->stageID` を設定する                                                             |

VRAM と BG に関わる順序:

1. `Cmd_LoadTileSet` は呼ばれた時点で VRAM に書く
2. `Cmd_LoadTileMap` のファイル内のタイルは、次の VBlank の `CopyBGTileDataAndTilemapToVram` で書かれる。予約は BG ごとに 1 つ (`gBGTileDataSrcAddrs[bg]`)
3. BG の優先度は、起動時の既定値 (BG0: 0, BG1: 1, BG2: 3, BG3: 1) を `Cmd_CreateBG` の `'.p'` が上書きする
4. 重なり順は優先度の数が大きいほど奥、同じなら BG 番号の大きい方が奥

ツールはこれを次のように写す。

- VRAM は BG VRAM 全体 (キャラクタブロック 0-3, 64KB) を 0 で始める。前のマップから残っている VRAM と優先度は持ち越さない
- 場面のタイルセットの読み込みを全部先に当て、そのあとでタイルマップのファイル内タイルを置く (タイルマップのタイルは VBlank で後から書かれるので、同じ場所ならタイルマップの方が残る)
- BG ごとに、最後に割り当てたタイルマップのレイヤを載せる

## パースの手順

### 読み込み呼び出しを拾う (`mapLoads`)

1. `ScriptScanner.roots()` で展開の起点にするスクリプトを集め、`scan(root)` で root から届く読み込み呼び出し (`LoadCall`) を実行順に得る。起点の選び方、定数の追い方、`conditional` (if/switch の節の中か) の付け方は [script.md](script.md)
2. 呼び出しをサブルーチンの番号で tilemaps / tilesets / pltts / bgs / collisions / stages に分ける。タイルマップの読み込みが 1 つも無い root は捨てる (`MapLoads`)

### タイルマップの持ち主を決める (`tilemapOwners`)

1 つの読み込み呼び出しは、それを (定数のスクリプト呼び出しで) 呼ぶ全ての root から届く。そこで「呼び出し命令の ROM オフセットとタイルマップ ID の組」(`callKey`) ごとに、それを自分のマップとして出す root を 1 つ決める。

1. その組を if/switch の外で読む root があれば、その中から選ぶ。読み込み呼び出しの総数が多いものを先にし、同じなら呼び出し元 (`reaches(a, b)`: a が b を間接的にでも呼ぶ) を先、それも同じなら ID の小さいもの。部屋のスクリプトが読み込み用のスクリプトを呼び、パレットだけ呼び出し元で決める形があるので、内側ではなく外側を取る
2. if/switch の中でしか読まれないなら、読むタイルマップの種類が一番少ない root を取る (同じなら呼び出しの総数が少ないもの, ID の小さいもの)。いくつものマップに振り分けるだけのスクリプトを避けるため

この規則はツールが決めたもので、ゲームには「マップ」の単位は無い。

### マップの一覧 (`mapEntries`)

1. `mapLoads` の各 root について、持ち主が自分になっているタイルマップの読み込みが 1 つも無ければ一覧に出さない
2. BG パレット (`pltts`) は場面によらず root から届くもの全部。if/switch の外のものを先にし、`'.p'` の並びが同じものは 1 つにまとめる
3. 場面に分ける (`buildScenes`) とステージを決める (`mapStage`)

### 場面に分ける (`buildScenes`)

場面は同時に画面に出る BG の組。root の呼び出しを実行順にたどって分ける。

1. タイルマップ以外の呼び出し (パレットを除く) は `pending` にためる
2. 持ち主が自分でないタイルマップの読み込み (呼び出し先の別のマップのもの) は飛ばす
3. タイルマップの読み込みが、今の場面ですでに使っている BG を使うなら (`callBGs`, [bg.md](bg.md) の `'.t'` の表)、そこで場面を切る。`pending` の末尾に続くタイルセットの読み込みは次の場面のものとし、それより前の分を今の場面に入れる
4. `pending` を今の場面に入れ、タイルマップの読み込みを足し、使う BG を記録する
5. 最後に残った `pending` を今の場面に入れる

続けて、場面ごとに読み込みを絞り、足りないものを借りる。

- タイルセット: `'.m'` が無いか不明か、場面のタイルマップを指すものだけ残す。1 つも無ければ、同じタイルマップを読む別の場面のタイルセットの読み込みを借りる
- `Cmd_CreateBG`: `'.d'` が無いか不明か、場面のタイルマップを指すものだけ残す。1 つも無ければ、root の呼び出し全体から場面のタイルマップを `'.d'` で指す最初の 1 つを借りる
- Collision Map: 同じく `'.n'` で絞り、無ければ借りる。if/else の両方で同じタイルマップを読み、当たり判定などはその後で 1 回だけ読む形があるため
- 引数が全部同じ場面は 1 つにまとめる

### ステージ (`mapStage`)

1. root から届く `Cmd_82B3` の `'.s'` のうち、if/switch の外のものを先にして最初の値
2. 無ければ、root を定数で呼んでいるスクリプト (`scriptCallers`, 1 段だけ) を順に `scan` し、最初に見つかった値。部屋のスクリプトがステージを設定してから読み込み用のスクリプトを呼ぶ形があるため
3. それでも無ければ `null` (前のマップの値を引き継ぐ)

### VRAM と BG を作る (`buildScene`, `map.ts`)

1. 64KB の VRAM を用意する
2. 場面のタイルセットの読み込みを順に当てる。読み込み先は `'.s'` (無ければ 0)、`'.m'` のタイルマップが分かればその `loadOffset`。`'.t'` が 0 (書かれていないときも 0) なら `0x8000`、それ以外は `読み込み先 * 32`。`'.c'` の部品ID ごとに `partTiles` を書き、書いた分だけ進む。タイルセットはファイルが 1 つなので `'.d'` は見ない
3. 場面のタイルマップの読み込みを順に当てる。`'.t'` が書かれていなければ 1、`'.n'` が書かれていなければ 1 とし、値がスクリプトから決まらなければ飛ばす。ファイル内のタイルがあれば `layoutTileOffset('.t', loadOffset)` (0 / 6 なら `0x8000`、1-7 なら `loadOffset * 32`、それ以外は 0) に書く。`layerBGs('.t', '.n', loadIndices(...))` の BG ごとに `BgSlot` (BG, 優先度の既定値, タイルマップ, レイヤ番号, キャラクタブロックの位置) を作る。レイヤ番号が決まらなかったときは k 番目のレイヤにする (推測)。同じ BG は後のもので上書きする
4. `Cmd_CreateBG` の `'.i'` の BG があれば、その優先度を `'.p'` にする
5. `bgDepth` の大きい (奥の) 順に並べる

ゲームとの違い: 部品ID がスクリプトから決まらない (`null`) ときは、その部品の大きさが分からないので、書かずに読み込み先も進めない。

描くときは `slotSource` で各 BG のレイヤと `vram.subarray(charBase)` を組にし、`renderComposite` で奥から重ねる ([bg.md](bg.md))。どの BG も左上を (0, 0) にそろえて描く。

## 表示での扱い

- 一覧 (`view_map.tsx`): root のスクリプト ID と、ステージ名の短い形 (名前の表は `generated/`, 無ければ `ST 番号`)
- 場面が 2 つ以上なら、`タイルマップID (BG番号)` を `+` でつないだ見出しで選ぶ。同じ見出しの場面は Collision Map と場面の番号を付けて見分ける
- パレットは BG パレットのファイルを選ぶ。スクリプトが指定するものはボタンで出し、最初のものを既定にする。無ければグレースケール
- BG ごとに表示を切り替えられる。grid は なし / 正方形 (16 px) / アイソメトリック (高さを選ぶ, [collision.md](collision.md) の `IsoGrid`)
- Collision Map は場面の読み込みの `'.p'` から選ぶ。タイルの重ね描き (属性 / 高さ / 枠だけ, 不透明度)、ゾーン・経路・ナビメッシュの重ね描きは [collision.md](collision.md)
- マウスの下: 各 BG のメタタイル番号と、上面が見えている Collision Map のタイル (`tileAtTilemap`)
- 詳細の表: スクリプト、ステージ (`null` なら「前のマップのものを引き継ぐ」)、各 BG の優先度・タイルマップ・レイヤ・大きさ、パレット、Collision Map、画像の大きさ
- 「読み込み」の表: 場面の読み込み呼び出しを、呼び出しが書かれているスクリプト、引数 (`?` は値が決まらなかったもの)、if/switch の中かどうかと一緒に出す
- 他のタブからの参照: Tilemap タブの「used by Map」は `mapEntries` の場面のタイルマップから、Collision タブの「loaded by」は `collisionLoads` (`'.p'` ごとに、呼び出し命令の位置と `'.n'` が同じものは 1 つにまとめる) から作る

## 根拠

- `src/vm_commands.s`: `0x11D4` `Cmd_LoadTileSet`, `0x7A27` `Cmd_LoadTileMap`, `0x30AD` `Map_LoadMapScripted`, `0x82B3` `Cmd_82B3`, `0xB4B4` `Cmd_CreateBG`
- `src/entity_08000a94.c`: `Cmd_LoadTileSet`, `Cmd_LoadTileMap`, `Cmd_CreateBG` (`'.p'` の既定値), `BgMapScroller_Init` (`SetBGPrioDirect`)
- `src/bg.c`: `Video_LoadTileSetParts` (その場で DMA), `Video_RequestBGTileData` と `CopyBGTileDataAndTilemapToVram` (VBlank で転送, BG ごとに 1 つ), `Video_InitBGMode` (優先度の既定値)
- `asm/func/Video_SetupBGLayout.inc`: `'.t'` ごとの BG とキャラクタブロック
- `src/camera.c`: `Map_LoadMapScripted` (`'.n'` は使わない)
- `src/menu.c`: `Cmd_82B3` (`gStat->stageID = '.s'`)
- `src/map_pltt_4ae5.c`: `Entity4AE5` (BG パレット)

## 未解明

- 場面の分け方、タイルマップの持ち主、読み込みの借り方は、ROM のスクリプトの形に合わせたツール側の規則 (推測) で、ゲームの単位ではない
- `Map_LoadMapScripted` の `'.n'` はゲームが使わないが、ツールは対になるタイルマップの ID とみなして場面に振り分けている (推測)
- BG のスクロール (`Cmd_CreateBG` の `'.f'`, `'.s'`, `'.m'`, 視差の `'.r'`、`Cmd_LoadTileMap` の `'.o'`) は反映しない。カメラに付いて等倍で動く BG 以外は、ゲームとずれて見えるはず
- 圧縮されたタイルマップの展開先 `gTilemapFileBuffer` は 1 つしかない (`GetTilemapFile`)。圧縮されたタイルマップを 2 つ続けて読むと、先の方の mtmap が上書きされるはず (推測)。ツールはそれぞれ別に展開して両方描く
- 前のマップから残る VRAM の中身・BG の優先度・ステージは持ち越さない

# bokmagic-web 開発ドキュメント

続・ボクらの太陽 (U32J rev1) の ROM からアセットを読み出して表示するブラウザ用ビューワの、作りと ROM データの読み方をまとめる。 ツールに手を入れるときは、まずこのページで全体をつかみ、ROM の各フォーマットは `rom/` 以下を読む。

## 方針

- ROM の読み方は、マッチングデコンパイル `boktai2` (C の実装とアセンブリ) を正とする。bokmagic など他のツールの解釈は参考程度にとどめる
- 分からないことは推測で埋めない。推測で動かしている所はコードのコメントとドキュメントにその旨を書く
- ROM はリポジトリに含めない (`rom/` と `*.gba` は .gitignore 済み)
- 依存ライブラリは preact だけにする

## 全体の流れ

```
ROM ファイル (ドロップ / ファイル選択 / IndexedDB に保存した ROM の一覧)
  └ index.tsx: LoadROM (rom.ts) で ROMFile を作る
       ├ gba.ts: ゲームID の確認 (U3IJ / U32J / U32J_rev1 / U33J)
       ├ fs.ts: gFS (ゲーム内のファイルシステム) を読む → ファイルID からオフセットを引ける
       └ objpltt.ts: OBJ パレット (gObjPlttData) を先に読んでおく
  └ 各タブ (view_*.tsx) が、必要なフォーマットのパーサ (*.ts) を呼んで表示する
       └ ROM 全体を見ないと分からないもの (スクリプトの解析結果) は analysis.ts が ROM ごとに 1 回だけ計算して持つ
```

- データを読む `.ts` は preact も decomp 由来の名前 (`generated/`) も import しない。名前を出すかどうかは画面側で決める (`index.tsx` の `setRom` で `setDecompGame` を呼ぶ)
- `bokcc/` (スクリプトの逆コンパイラ) は、ディレクトリの外を import しない独立したモジュール
- サウンドの `m4a/` は [m4a-web](https://github.com/akatsuki105/m4a-web) のものを `deno.jsonc` の `imports` で URL から読む (コミットで固定)

## タブとファイルの対応

| タブ        | 表示 (`view_*.tsx`)  | データの読み込み                                       | ドキュメント                     |
| ----------- | -------------------- | ------------------------------------------------------ | -------------------------------- |
| MainSprite  | `view_main.tsx`      | `sprite_main.ts`, `anim_main.ts`                       | [sprite.md](rom/sprite.md)       |
| AuxSprite   | `view_aux.tsx`       | `sprite_aux.ts`, `anim_aux.ts`                         | [sprite.md](rom/sprite.md)       |
| Particle    | `view_particle.tsx`  | `particle.ts`, `anim_aux.ts`                           | [sprite.md](rom/sprite.md)       |
| OBJ Palette | `view_objpltt.tsx`   | `objpltt.ts`                                           | [palette.md](rom/palette.md)     |
| BG Palette  | `view_bgpltt.tsx`    | `bgpltt.ts`                                            | [palette.md](rom/palette.md)     |
| Tileset     | `view_tileset.tsx`   | `tileset.ts`                                           | [bg.md](rom/bg.md)               |
| Map         | `view_map.tsx`       | `map.ts`, `analysis.ts`                                | [map.md](rom/map.md)             |
| Tilemap     | `view_tilemap.tsx`   | `tilemap.ts`                                           | [bg.md](rom/bg.md)               |
| Collision   | `view_collision.tsx` | `collision.ts`, `collision_overlay.tsx`                | [collision.md](rom/collision.md) |
| Font        | `view_font.tsx`      | `font.ts`                                              | [font.md](rom/font.md)           |
| Script      | `view_script.tsx`    | `script.ts`, `script_scan.ts`, `analysis.ts`, `bokcc/` | [script.md](rom/script.md)       |
| Sound       | `view_sound.tsx`     | `m4a/` (m4a-web), `audio.ts`                           | [sound.md](rom/sound.md)         |

共通のもの:

| ファイル                               | 役目                                                                                                                | ドキュメント                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `rom.ts`, `gba.ts`, `fs.ts`, `lz77.ts` | ROM の読み込み, gFS, LZ77 の展開                                                                                    | [filesystem.md](rom/filesystem.md) |
| `render.ts`                            | OBJ やタイルを画像 (`Pixels`: 幅・高さ・RGBA の配列, ブラウザに依存しない) にする                                   | [sprite.md](rom/sprite.md)         |
| `components.tsx`                       | 画面の共通部品 (本文の作り `AssetView`, カード `Card`, キャンバス, パレット, 数値の増減, 詳細の表 `InfoTable` など) | このページの「画面の約束事」       |
| `audio.ts`                             | アプリ全体で 1 つの AudioContext と全体の音量                                                                       | [sound.md](rom/sound.md)           |
| `rom_store.ts`                         | 開いた ROM を IndexedDB に複数保存する (localStorage は容量が足りない)                                              | —                                  |
| `decomp.ts`                            | decomp 由来の名前の表を、U32J のときだけ返す                                                                        | 下の「名前の表」                   |

## 名前の表 (`generated/`)

スプライト名・タイルマップ名・曲名・ステージ名などの定数名と説明は、decomp のヘッダとソースから `tools/gen_tables.ts` で `generated/` に生成している。手で編集しない。

```sh
./tools/gen_tables.ts <path/to/boktai2> && deno fmt generated/
```

- decomp のコメントを変えたら、これを実行してからバンドルし直すと画面に出る
- 名前は U32J から作ったものなので、`decomp.ts` の `decomp()` は U32J (rev1, rev0) 以外では空の表を返す (U3IJ, U33J では名前を出さない)。rev0 はファイルID などが rev1 と同じなので同じ表を使う
- 見出しの下の説明 (`Desc`) は、定数のコメントの全文。Map タブの一覧に出すステージの短い名前は、コメントの「 (」か「, 」より前

## 画面の約束事

- 左のタブ、一覧、本文はそれぞれ独立してスクロールし、ページ全体はスクロールしない (`index.html` の `.app`)
- 選んでいるものは URL の `#タブ/0xXXXX` に入れる (`components.tsx` の `hashID` / `useHashID`)。他のタブへのリンクはこの形で書く (`tilemapHref` など)
- 左のタブは見出しを付けずに 1 列に並べる。スプライト, マップ, その他の順で、それぞれ組み上がったもの → 部品 → パレットの順 (`index.tsx` の `TABS`)
- 本文は全タブ同じ作り (`components.tsx` の `AssetView`): 上に見出し (ID と名前)、左に本体 (絵・コード・再生欄。ポーズ一覧や色の表など本体に付くものもここ)、右に見出し付きのカード (`Card`) を縦に並べる
  - カードの並びは「説明 (`Desc`) → 操作 (表示, パレット, アニメ など) → アニメの状態・凡例 → カーソル → 選んでいる一部 (ポーズ N, コマ N) → Metadata → それを含む全体 (タイルセット, ファイル) → 一覧の表 (Zones, Paths, NavMesh, Map の読み込み) → Used by」。Used by はどのタブでも一番下。Map だけは「… → Zones, Paths, NavIslands → Metadata → 読み込み」で (Map の NavMesh は島ごとの一覧で、絵の上でも島を Zone のように描く. 島の行を押すとその島の Rect / Portal の行を開く)、読み込みが一番下
  - カードは見出しを押すと折り畳める (既定は開く, 見出しの頭の ▾ / ▸)。閉じた状態はタブと見出しごとに localStorage に保存し (`bokmagic-web.card.<タブ>.<見出し>`, 見出しの後ろの件数や番号は除く)、別のものを開いても読み直しても保つ
  - 選んでいるもの自体の情報のカードの見出しは、どのタブでも Metadata (タブ名を繰り返さない)。中の一部を選んでいるものは「ポーズ N」「コマ N」
  - 左右はそれぞれスクロールする。右の欄の幅は画面幅の 32% (300〜560px)。Script はコードが横に長いので細くする (`narrow`, 280〜360px)。画面幅が 900px より狭いときは、本体 → カードの順に縦に並べる (`index.html` の `.split-*`)
  - 本体の中の小見出しは `StageTitle`。本体の絵は細い枠で範囲を見せる。BG Palette の 16 本、色の表、ポーズ一覧は縞やカードにして、選んでいるものを青で強調する
- 表記の決まり
  - 番号 (ポーズ, レイヤ, コマ, 部品の並び順など) は素の数字。`#` は付けない。何の番号かは項目名か前に置く言葉 (「レイヤ 0」) で示す
  - ID (ファイル, パレット, スクリプトなど) は `0x` の 16 進 4 桁。番号や数 (BG 番号, 優先度, レイヤ数など) は 10 進
  - 名前と ID: 一覧と見出しでは「ID 名前」。ただし名前に ID の 16 進 4 桁が入っているもの (TILEMAP_7DB3, BGP_07E7 など) は名前だけ (`components.tsx` の `idLabel`)。カードの中では常に名前だけを出し、ID はツールチップにする (`NameRef`)。名前が無ければ ID。見出しに種類の言葉 (Map, part など) は付けない
  - 値には単位を書く (px, タイル, メタタイル, 枚, 個, f)。データが別の単位で持っているものは直して出す (Collision の 1 タイル = 256 はタイル単位に, 高さ 1 段 = 16 は段に, tilemapOffset は >> 4 して px に)
  - 操作の項目名は日本語。ただし訳すと分かりにくくなる用語 (Zone, Path, NavMesh, NavIsland, Overlay, Grid, Used by) は英単語のまま。ゲームでの名前 (plttID, playMode など) はマウスを乗せたときの説明に入れる。値 (LOOP, KEEP_FRAME など) はゲームの名前のまま
  - 表 (InfoTable, カーソル, アニメの状態) の項目名はデータの欄名 (英語のまま)。欄名が無いもの (位置など) だけ日本語。Collision の y は奥行きなので z と書く
  - 補足 (値の意味, 根拠の関数名, 分かっていないこと) は本文に出さず、ツールチップにする: 表の項目名 (点線の下線), 操作の項目名, カードの見出しの横の ?。本文に残すのは、表示が変わる理由になる注意 (パレットが無いので灰色, 位置が合わない など) だけ
  - 生の値は意味に分けて出す (メタタイルのエントリはタイル番号・反転・パレット行, 経路の delay は待ちフレームと不明なビット, command は名前, Map の読み込みの引数は「部品」「BG」などの意味)。分かっていない値 (unk_*) は 16 進で出し、分かっていないことを説明に書く
- カードの中身は中身に合わせた部品で組む (`components.tsx`)
  - 設定は「左にラベル、右に部品」の行を縦に並べる (`Fields` の中に `Field`)。ラベルは日本語 (ポーズ, 拡大, 反転 など)、ゲームの用語そのもの (plttID, playMode, flags) はそのまま
  - どれか 1 つを選ぶもの (表示の切り替え, 塗り分け, 格子, variant など) はつながったボタン (`Segmented`)、オンオフは `Check`
  - 範囲の決まった量 (拡大, ポーズ, アニメの速度, 横の枚数, 格子の高さ, 不透明度) はスライダー (`Slider`)。横に今の値を出し、ポーズのように 1 つずつ動かしたいものは ◀ ▶ も付ける。番号で選ぶもの (plttID, パレットの行, ループ回数) は ◀ ▶ 付きの数値の欄 (`NumberStepper`)
  - 再生・SetAnim などの操作ボタンは、設定の行の下に 1 行で並べる (`ButtonRow`)
  - アニメの状態は詳細の表と同じ形 (`InfoTable`) で出し、コマンド列は長さ (フレーム数) に比例した幅のタイムライン (`AnimTimeline`) にする。今のコマンドを強調する
  - 補足 (ソースでの使われ方, 注意書き) は控えめな色の小さめの文字 (`.note`)
  - カーソルの欄 (`CursorCard`) は、マウスの下にあるものを項目ごとの表で出す (Map は BG ごとのメタタイルと当たり判定のタイル, Collision はタイルの値とゾーン など)。何も無いときは案内を出し、出しうる行数分の高さを取って下のカードが動かないようにする
  - 同じ値を 2 か所に出さない。一覧の見出しの数 (ゾーン (8), ポーズ (75) など) や、操作の欄にある値は、表に重ねない
  - 詳細の表 (`InfoTable`) は縞の 2 列 (項目名は控えめな色)。リンクが複数あるもの (loaded by, called by) は 1 行に 1 つ (`LinkList`)
  - 表示するものを選ぶ一覧 (Map の BG, Tilemap のレイヤ) は縦に 1 行 1 つ (`ToggleList`)。描く順に並べる (上が手前)。Map の行は BG で、載っているタイルマップのレイヤ (ファイル内の番号)・優先度・大きさを補足に出す。重なり順は優先度と BG 番号で決まり、レイヤの番号とは関係ないので、番号を順番に見える所 (行の名前) に置かない。短いオンオフの組 (反転, flags, 重ねるもの) は横に並べる (`Check`)
  - Zones, Paths, NavMesh の一覧 (Collision タブと Map タブ, `view_collision.tsx` の `ZoneTable`, `PathTable`, `NavTable`) は、行にマウスを乗せるとその要素を絵の上で強調する (白い太線と濃い塗り, 同じ種類のほかの要素は薄く)。重ねる設定がオフでも強調する要素は描く。Paths は点 (Node) の行なら、その点に輪を付ける。NavMesh は Rect の行ならその矩形とつながる Portal, Portal の行ならその出入口とつながる Rect を強調する
  - 絵の上の重ね描き (`collision_overlay.tsx`) は彩度を落とした色で細く描く。当たり判定のタイルは全タイルに枠を引かず、塗り分けの値や高さが隣と違う辺にだけ暗い細線を引く。ゾーンの ID や経路の名前 (Path 0 など) は暗い背景の札に入れる
  - そのアセットを使っているもの (逆向きの参照) は、どのタブでも Used by のカード (`UsedByCard`) に「種類 | リンク | 補足」の縞の行で出し、ほかの表に混ぜない。種類は Map, Script, Collision, Font, MainSprite, AuxSprite, Particle, Source (decomp のソースの行)。Map の行は「ID ステージ名」(`MapLink`) で、Map タブと同じ一覧 (`mapEntries`) から探す (読み込みの呼び出しの root をそのまま Map にしない)
    - OBJ Palette: MainSprite, AuxSprite, Particle / BG Palette: Font, Map, Source / Tileset の部品: Map / Tilemap: Map, 対の Collision ('.n') / Collision: Map (補足に対のタイルマップ) / Script: 起点にする Map, 呼んでいる Script
  - MainSprite と AuxSprite のポーズのカードには、サブスプライト (OBJ 1 枚ずつ) の表を出す
  - Map の読み込みは、呼び出し 1 つを 1 項目にした縞の並び (1 行目に種類と読み込むもの, 2 行目にスクリプトと引数)
  - カードの中の要素の間隔は `.card > * + *` の 1 か所で決める
- ボタン・入力欄・チェックボックスは、ブラウザ標準の見た目をやめて `:root` の色 (`--bg-input`, `--bg-button`, `--accent` など) で塗る。押せないボタンは薄くする
- 詳細の表の項目名は控えめな色 (`--text-dim`) にする。一覧の表 (Collision のゾーンと経路, Map の読み込み) は ID の一覧と同じ縞にする (`.striped`)
- 色・フォント・行間は `index.html` の `:root` の変数 (`--text`, `--text-dim`, `--link`, `--bg-*`, `--font-sans`, `--font-mono` など) で決める。ダークモードは `light-dark()` で切り替える
- 全体の音量は `audio.ts` が localStorage に保存する
- Map の Collision のカードの Overlay の設定 (タイルの Overlay, 塗り分け, 不透明度, Zones / Paths / NavMesh) は、別の Map を見ても読み直しても保つよう localStorage に保存する (`components.tsx` の `usePersistentState`, キーは `bokmagic-web.map.collision.*`)。どの Collision Map のファイルを使うかは Map ごとに違うので保存しない
- 開いた ROM は `rom_store.ts` が IndexedDB に保存する。中身の SHA-1 で見分けるので、同じ ROM はファイル名が違っても 1 つにまとまる。初期画面に保存してある ROM の一覧 (gameID を `rom.ts` の `GAME_IDS` の順 (U3IJ, U32J, U32J_rev1, U33J) に、同じ gameID はファイル名の順に並べ、開いても並びは変わらない。ファイル名・タイトル・gameID・SHA-1。タイトルを持たない古い保存は、一覧を読むときに本体のヘッダから埋める) を出し、名前を押すと開き、「削除」で消す。1 つだけ保存していた前の版の ROM は引き継がない
- ROM を開いた後のヘッダには、開いている ROM のカートリッジヘッダのタイトル (`0xA0`, `"ZOKTAI"` など) と gameID、音量だけを出す (ファイル名は出さない)

## 開発

```sh
deno task dev      # バンドルを監視しながら http://localhost:8080/ で配信
deno task bundle   # bundle.js を作るだけ
deno task cli:bundle  # コマンドライン版を dist/bokmagic.js にまとめる (docs/cli.md)
deno fmt && deno lint && deno check index.tsx
```

- `bundle.js` はコミットしない (.gitignore 済み)
- `bundle.js` には preact (MIT) が入る。公開のワークフローが `THIRD_PARTY_LICENSES.txt` の全文を `bundle.js` の先頭にコメントで付け、ファイルとしても一緒に置く。依存を増やしたら `THIRD_PARTY_LICENSES.txt` と README の表に足す
- `bokcc/` は decomp の `tools/bokcc` から無改変でコピーしたもので、fmt と lint の対象外 (`deno.jsonc`)
- ブラウザの確認は、ROM をウィンドウにドロップするか、ファイル選択で開いて行う

## コマンドライン版と URL での ROM の受け渡し

ブラウザを操作しなくてもアセットを確かめられるように、JSON と PNG を出すコマンドライン版 (`cli/`) と、URL の `?rom=` で ROM を渡す仕組みがある。使い方は [cli.md](cli.md)。

## ROM のフォーマット

- [ファイルシステム (gFS) と LZ77](rom/filesystem.md)
- [パレット (OBJ / BG)](rom/palette.md)
- [スプライト (MainSprite / AuxSprite / アニメ / Particle)](rom/sprite.md)
- [BG (タイルセット / タイルマップ / BG の割り当て)](rom/bg.md)
- [Collision Map と投影](rom/collision.md)
- [Map タブのマップの組み立て](rom/map.md)
- [フォント](rom/font.md)
- [スクリプトと静的解析](rom/script.md)
- [サウンド (m4a)](rom/sound.md)

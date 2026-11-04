# bokmagic-web 開発ドキュメント

続・ボクらの太陽 (U32J rev1) の ROM からアセットを読み出して表示するブラウザ用ビューワの、作りと ROM データの読み方をまとめる。 ツールに手を入れるときは、まずこのページで全体をつかみ、ROM の各フォーマットは `rom/` 以下を読む。

## 方針

- ROM の読み方は、マッチングデコンパイル `boktai2` (C の実装とアセンブリ) を正とする。bokmagic など他のツールの解釈は参考程度にとどめる
- 分からないことは推測で埋めない。推測で動かしている所はコードのコメントとドキュメントにその旨を書く
- ROM はリポジトリに含めない (`rom/` と `*.gba` は .gitignore 済み)
- 依存ライブラリは preact だけにする

## 全体の流れ

```
ROM ファイル (ドロップ / ファイル選択 / IndexedDB に保存した前回の ROM)
  └ index.tsx: LoadROM (rom.ts) で ROMFile を作る
       ├ gba.ts: ゲームID の確認 (U32J_rev1 / U33J)
       ├ fs.ts: gFS (ゲーム内のファイルシステム) を読む → ファイルID からオフセットを引ける
       └ objpltt.ts: OBJ パレット (gObjPlttData) を先に読んでおく
  └ 各タブ (view_*.tsx) が、必要なフォーマットのパーサ (*.ts) を呼んで表示する
       └ ROM 全体を見ないと分からないもの (スクリプトの解析結果) は analysis.ts が ROM ごとに 1 回だけ計算して持つ
```

- データを読む `.ts` は preact も decomp 由来の名前 (`generated/`) も import しない。名前を出すかどうかは画面側で決める (`index.tsx` の `setRom` で `setDecompGame` を呼ぶ)
- `m4a/` (サウンド) と `bokcc/` (スクリプトの逆コンパイラ) は、ディレクトリの外を import しない独立したモジュール

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
| Sound       | `view_sound.tsx`     | `m4a/`, `audio.ts`                                     | [sound.md](rom/sound.md)         |

共通のもの:

| ファイル                               | 役目                                                                                      | ドキュメント                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| `rom.ts`, `gba.ts`, `fs.ts`, `lz77.ts` | ROM の読み込み, gFS, LZ77 の展開                                                          | [filesystem.md](rom/filesystem.md) |
| `render.ts`                            | OBJ やタイルを画像 (`Pixels`: 幅・高さ・RGBA の配列, ブラウザに依存しない) にする         | [sprite.md](rom/sprite.md)         |
| `components.tsx`                       | 画面の共通部品 (キャンバス, パレット, 数値の増減, 説明 `Desc`, 詳細の表 `InfoTable` など) | このページの「画面の約束事」       |
| `audio.ts`                             | アプリ全体で 1 つの AudioContext と全体の音量                                             | [sound.md](rom/sound.md)           |
| `rom_store.ts`                         | 最後に開いた ROM を IndexedDB に保存する (localStorage は容量が足りない)                  | —                                  |
| `decomp.ts`                            | decomp 由来の名前の表を、U32J のときだけ返す                                              | 下の「名前の表」                   |

## 名前の表 (`generated/`)

スプライト名・タイルマップ名・曲名・ステージ名などの定数名と説明は、decomp のヘッダとソースから `tools/gen_tables.ts` で `generated/` に生成している。手で編集しない。

```sh
./tools/gen_tables.ts <path/to/boktai2> && deno fmt generated/
```

- decomp のコメントを変えたら、これを実行してからバンドルし直すと画面に出る
- 名前は U32J から作ったものなので、`decomp.ts` の `decomp()` は U32J 以外では空の表を返す (U33J では名前を出さない)
- 見出しの下の説明 (`Desc`) は、定数のコメントの全文。Map タブの一覧に出すステージの短い名前は、コメントの「 (」か「, 」より前

## 画面の約束事

- 左のタブ、一覧、本文はそれぞれ独立してスクロールし、ページ全体はスクロールしない (`index.html` の `.app`)
- 選んでいるものは URL の `#タブ/0xXXXX` に入れる (`components.tsx` の `hashID` / `useHashID`)。他のタブへのリンクはこの形で書く (`tilemapHref` など)
- 本文の並びは全タブで「見出し (ID と名前) → 説明 (`Desc`) → 操作 → 画像 → 詳細の表 (`InfoTable`)」。マウスを乗せたときの情報は画像のすぐ上の 1 行 (`.hover-line`) に出す
- 色・フォント・行間は `index.html` の `:root` の変数 (`--text`, `--link`, `--font-sans`, `--font-mono`) で決める。ダークモードは `light-dark()` で切り替える
- 全体の音量は `audio.ts` が localStorage に保存する
- 最後に開いた ROM は `rom_store.ts` が IndexedDB に保存する。初期画面の「起動時に自動で開く」(既定は off, localStorage に保存) をオンにすると、ページを開いたときにその ROM を開く (URL の `#` のタブと選択はそのまま)

## 開発

```sh
deno task dev      # バンドルを監視しながら http://localhost:8080/ で配信
deno task bundle   # bundle.js を作るだけ
deno task cli:bundle  # コマンドライン版を dist/bokmagic.js にまとめる (docs/cli.md)
deno fmt && deno lint && deno check index.tsx
```

- `bundle.js` はコミットしない (.gitignore 済み)
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

# コマンドライン版と URL での ROM の受け渡し

ブラウザの画面を操作しなくてもアセットを確かめられるようにする仕組み。decomp 側のエージェントなどが使うことを想定している。

- **コマンドライン版** (`cli/`): ROM と ID を渡すと、情報を JSON で標準出力に出し、`-o` で画像を PNG に書き出す
- **URL の `?rom=`**: ROM の場所を URL に書いて開くと、ドロップしなくてもその ROM でアセットを表示する

## コマンドライン版

### 置き場所

GitHub Pages に画面と一緒に公開している (`.github/workflows/pages.yml` が main への push のたびに `deno task cli:bundle` で 1 ファイルにまとめて置く)。 Deno は URL のスクリプトをそのまま実行できるので、使う側 (decomp など) にはファイルを置かない。

```
https://akatsuki105.github.io/bokmagic-web/bokmagic.js
```

- ROM は使う側の手元のものを読むだけで、どこにも送らない
- Deno は取得したスクリプトを手元にキャッシュして使い回す。新しい版を使うときは `--reload` を付けて 1 回実行する
- 手元で試すときは `deno task cli:bundle` で `dist/bokmagic.js` を作り (`dist/` はコミットしない)、そのファイルを `deno run` する

### 使い方

```sh
deno run --allow-read --allow-write https://akatsuki105.github.io/bokmagic-web/bokmagic.js <rom.gba> <command> [target] [options]
```

- `--allow-read` は ROM を読むため、`--allow-write` は PNG を書くため (`-o` を使わないなら要らない)。スクリプトの取得にはネットワークの権限は要らない
- 引数なしで動かすと使い方を出す
- 結果は常に JSON で標準出力に出す。エラーは標準エラー出力に出し、使い方の誤りは終了コード 2、それ以外の失敗は 1

| コマンド                           | 対象                                 | 出すもの                                                                                 |
| ---------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `list <sprite\|aux\|tilemap\|map>` | —                                    | 一覧 (`items`)                                                                           |
| `sprite <ID>`                      | MainSprite (`SPRITE_*`)              | ポーズ数・アニメ数・タイル数・palStart と、選んだポーズのサブスプライト・オフセット・box |
| `aux <ID>`                         | AuxSprite (`SPRITE_*`)               | ポーズ数・大きさ・オフセット・plttID と、選んだポーズの中身                              |
| `tilemap <ID>`                     | タイルマップ (`TILEMAP_*`)           | ヘッダ・レイヤ・タイルの読み込み元・使っているマップ                                     |
| `map <ID>`                         | マップを読み込むスクリプト (`Scr_*`) | ステージ・場面・BG ごとのタイルマップと優先度・パレット・Collision Map                   |

| オプション               | 対象         | 意味                                                                                                 |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------------------------- |
| `-o`, `--out <file.png>` | 全部         | 画像を PNG で書き出す。JSON の `png` に書いたパスが入る                                              |
| `--scale <n>`            | 全部         | 拡大率 (最近傍, 既定 1)                                                                              |
| `--pose <n>`             | sprite, aux  | ポーズ番号 (既定 0)                                                                                  |
| `--sheet`                | sprite, aux  | 全ポーズを 8 列に並べた 1 枚にする                                                                   |
| `--pltt <n>`             | sprite, aux  | plttID (既定はスプライトの既定値, 10 進数でも 16 進数でもよい)                                       |
| `--pltt <ID>`            | tilemap, map | BG パレットのファイルID (既定: tilemap はグレースケールかマップの指定、map はスクリプトの最初の指定) |
| `--xflip`, `--yflip`     | sprite, aux  | 反転                                                                                                 |
| `--layers <a,b,...>`     | tilemap      | 描くレイヤ (既定は全部, 番号の小さい方が奥)                                                          |
| `--part <n>`             | tilemap      | タイルの読み込み元にするタイルセット部品の番号 (`#n`)                                                |
| `--set <n>`              | tilemap      | `--part` の部品を探すタイルセットの番号 (既定 0。U3IJ はタイルセットが 11 個ある)                    |
| `--scene <n>`            | map          | 場面の番号 (既定 0)                                                                                  |
| `--hide-bg <a,b,...>`    | map          | 描かない BG 番号                                                                                     |

ID は `0x5D36` のような 16 進数で書く。U32J (rev1, rev0) では decomp の定数名 (`SPRITE_SHADEMAN`, `TILEMAP_7DB3`, `Scr_0x02BF` など) も使える (`generated/names.ts` をバンドルに含めている)。U33J と U3IJ では名前は出ず、ID だけ使える。U3IJ (ボクタイ1) では `list map`、`map` は使えない (スクリプトが読めない)。`tilemap` は使えるが、このタイルマップを使うマップは探さないので、タイルは `--set` と `--part` で選ぶ

### 例

`BOKMAGIC=https://akatsuki105.github.io/bokmagic-web/bokmagic.js` として:

```sh
# シェードマンのポーズ 3 を 3 倍で書き出す
deno run --allow-read --allow-write $BOKMAGIC baserom.gba sprite SPRITE_SHADEMAN --pose 3 --scale 3 -o shademan.png

# AuxSprite の全ポーズを 1 枚に並べる
deno run --allow-read --allow-write $BOKMAGIC baserom.gba aux SPRITE_EFF_1C1B --sheet --scale 2 -o eff.png

# マップ (Scr_0x048C が読み込むもの) を、スクリプトが指定するパレットで合成して書き出す
deno run --allow-read --allow-write $BOKMAGIC baserom.gba map 0x048C -o map.png

# マップの一覧 (スクリプト ID, ステージ, 場面ごとのタイルマップと BG)
deno run --allow-read $BOKMAGIC baserom.gba list map
```

### 画像の決まり

- 背景は透明。スプライトは原点を含む範囲を切り出す (JSON の `originX` / `originY` が画像上の原点)
- タイルマップは、ファイル内にタイルがあればそれを、無ければそのタイルマップを使う最初のマップのスクリプトの読み込みでタイルを組み立てる (JSON の `tilesSource`)。`--part` で部品を指定したときはそれを使う
- マップは Map タブと同じく、BG を優先度の順に重ねる ([rom/map.md](rom/map.md))。Collision Map の重ね表示やグリッドは、今のところ出さない

### 作り

- `cli/main.ts`: 引数の解釈とコマンド。データの読み込みは画面と同じモジュール (`sprite_main.ts`, `tilemap.ts`, `map.ts`, `analysis.ts` など) をそのまま使う
- `cli/png.ts`: PNG の書き出し。圧縮は Deno 標準の `CompressionStream("deflate")` を使い、依存は増やさない
- 描画の結果は `render.ts` の `Pixels` (幅・高さ・RGBA の配列) で、ブラウザの `ImageData` には依存しない。画面では `SpriteCanvas` が描く直前に `ImageData` に包む

## URL の `?rom=`

```
http://localhost:8080/?rom=rom/U32J_rev1.gba#main/0x5D36
```

- `?rom=` の ROM を取得して開き、`#` のタブと ID を表示する。開いた後は `#` を変えるだけで、ROM を読み直さずに別のアセットへ移れる
- 相対パスはページの場所から解決する。読み込めなければヘッダにエラーを出す
- この ROM は IndexedDB に保存しない (初期画面の一覧に増やさない)
- タイトルを押して初期画面に戻ると、URL から `?rom=` も消える

### ROM をどこから配るか

ブラウザは、ページと違う場所 (オリジン) のファイルを自由には取得できない。

1. **同じサーバから配る (おすすめ)**: このリポジトリで `deno task dev` を動かすと、リポジトリ直下の `rom/` (.gitignore 済み) もそのまま配られる。ROM を `rom/` に置いて `?rom=rom/<ファイル名>` で開く
2. **別のローカルサーバから配る**: ROM 側のサーバが CORS のヘッダを返す必要がある (例: `deno run --allow-net --allow-read jsr:@std/http/file-server --cors`)。`?rom=http://localhost:8099/baserom.gba` のように書く
3. **公開サイト (GitHub Pages) から `http://localhost` の ROM を読む**: CORS に加えて、Chrome では公開サイトからローカルへのアクセス用のヘッダも要る。手間が多いのですすめない

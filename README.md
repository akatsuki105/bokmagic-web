# bokmagic-web

ボクらの太陽シリーズの ROM のアセットビューワ

作りと ROM データの読み方は [docs/](docs/README.md) にまとめてある

## 対応している ROM

- 続・ボクらの太陽 (U32J rev1)
- 新・ボクらの太陽 (U33J): 名前 (スプライト名、スクリプト名など) は boktai2 decomp から作った U32J 用のものなので出さない. 文字コードも U32J とは違い、まだ分かっていないので、フォントの文字コードと文字は出さない. 曲テーブルの位置も分かっていないので Sound タブは使えない

## m4a/

MP2K (m4a, いわゆる Sappy) の曲を PCM に書き出すモジュール. ディレクトリの外のファイルを import しないので、他の GBA ゲームの解析にもそのまま使える. 使い方は `m4a/mod.ts` の先頭のコメントを参照

## Build

```sh
$ deno task bundle
```

## Deploy

main に push すると `.github/workflows/pages.yml` がバンドルして GitHub Pages に公開する (公開するのは画面の `index.html` と `bundle.js`、コマンドライン版の `bokmagic.js` だけ。コマンドライン版は [docs/cli.md](docs/cli.md))

## Dev

http://localhost:8080/

```sh
$ deno task dev
```

## Generated tables

`generated/` 以下は boktai2 decomp のヘッダとソースから `tools/gen_tables.ts` で生成する (手で編集しない)

- `names.ts`: スプライト、アニメファイル、BG パレット、タイルマップ、当たり判定マップ、スクリプト、文字列、曲の定数名
- `aux_anims.ts`: AuxSprite とアニメファイルの組
- `bgpltt_refs.ts`: BG パレットが読まれている場所
- `particle_refs.ts`: パーティクルのグループ名・ポーズ名と、一緒に使われるアニメファイル・OBJ パレット
- `charmap.ts`: フォントの字形番号 -> 文字 (charmap.txt)

```sh
$ ./tools/gen_tables.ts <path/to/boktai2>
$ deno fmt generated/
```

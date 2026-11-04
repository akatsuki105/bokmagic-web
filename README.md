# bokmagic-web

ボクらの太陽シリーズの ROM のアセットビューワです。

作りと ROM データの読み方は [docs/](docs/README.md) にまとめています。

## 参考にしたもの

- Raphael Robatsch さんの [bokmagic](https://git.sr.ht/~raphi/bokmagic) (Qt 製のアセットビューワ): このリポジトリとは別のプロジェクトで、コードは共有していません。ROM のデータの読み方を調べるときに参考にさせていただきました。
- [Boktai Hacking Wiki](https://boktaihacking.net/wiki/Category:Boktai_2): ROM のデータの調査でとてもお世話になりました。

先行して作られたツールと、調査をまとめてくださった方々に感謝します。

## サードパーティのライセンス

このツールは次のソフトウェアを含んでいます。

| ソフトウェア                                 | ライセンス  | 著作権者                                |
| -------------------------------------------- | ----------- | --------------------------------------- |
| [preact](https://github.com/preactjs/preact) | MIT License | Copyright (c) 2015-present Jason Miller |

ライセンスの全文は [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) を参照してください。

## 対応している ROM

- 続・ボクらの太陽 (U32J rev1)
- 新・ボクらの太陽 (U33J): 名前 (スプライト名、スクリプト名など) は boktai2 decomp から作った U32J 用のものなので出しません。文字コードも U32J とは違い、まだ分かっていないので、フォントの文字コードと文字は出しません。曲テーブルの位置も分かっていないので、Sound タブは使えません。

## m4a/

MP2K (m4a, いわゆる Sappy) の曲を PCM に書き出すモジュールです。ディレクトリの外のファイルを import しないので、他の GBA ゲームの解析にもそのまま使えます。使い方は `m4a/mod.ts` の先頭のコメントを参照してください。

## Build

```sh
$ deno task bundle
```

## Deploy

main に push すると、`.github/workflows/pages.yml` がバンドルして GitHub Pages に公開します。公開するのは、画面の `index.html` と `bundle.js`、コマンドライン版の `bokmagic.js` だけです。コマンドライン版の使い方は [docs/cli.md](docs/cli.md) を参照してください。

## Dev

http://localhost:8080/

```sh
$ deno task dev
```

## Generated tables

`generated/` 以下は、boktai2 decomp のヘッダとソースから `tools/gen_tables.ts` で生成しています (手で編集しないでください)。

- `names.ts`: スプライト、アニメファイル、BG パレット、タイルマップ、当たり判定マップ、スクリプト、文字列、曲の定数名
- `aux_anims.ts`: AuxSprite とアニメファイルの組
- `bgpltt_refs.ts`: BG パレットが読まれている場所
- `particle_refs.ts`: パーティクルのグループ名・ポーズ名と、一緒に使われるアニメファイル・OBJ パレット
- `charmap.ts`: フォントの字形番号 -> 文字 (charmap.txt)

```sh
$ ./tools/gen_tables.ts <path/to/boktai2>
$ deno fmt generated/
```

# bokmagic-web

ボクらの太陽シリーズの ROM のアセットビューワです。

作りと ROM データの読み方は [docs/](docs/README.md) にまとめています。

## 対応している ROM

- 続・ボクらの太陽 (U32J rev1)
- 新・ボクらの太陽 (U33J)

## Build

```sh
# Build
$ deno task bundle

# Dev
$ deno task dev # http://localhost:8080/
```

デプロイは `.github/workflows/pages.yml`を参照。 CLI版の使い方は [docs/cli.md](docs/cli.md) を参照してください。

## Generated tables

定数名や参照情報をまとめたテーブル(`generated/`) は `tools/gen_tables.ts` で [boktai2 decomp](https://github.com/akatsuki105/boktai2) の内容から更新します(手で編集しないでください)。

```sh
$ ./tools/gen_tables.ts <path/to/boktai2>
$ deno fmt generated/
```

## 参考にしたもの

- Raphael Robatsch さんの [bokmagic](https://git.sr.ht/~raphi/bokmagic) (Qt 製のアセットビューワ): このリポジトリとは別のプロジェクトで、コードは共有していません。ROM のデータの読み方を調べるときに参考にさせていただきました。
- [Boktai Hacking Wiki](https://boktaihacking.net/wiki/Category:Boktai_2): ROM のデータの調査でとてもお世話になりました。

先行して作られたツールと、調査をまとめてくださった方々に感謝します。

## ライセンス

MIT License です。全文は [LICENSE](LICENSE) を参照してください。

## サードパーティのライセンス

このツールは次のソフトウェアを含んでいます。

| ソフトウェア                                 | ライセンス  | 著作権者                                |
| -------------------------------------------- | ----------- | --------------------------------------- |
| [preact](https://github.com/preactjs/preact) | MIT License | Copyright (c) 2015-present Jason Miller |

ライセンスの全文は [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) を参照してください。

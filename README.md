# bokmagic-web

ボクらの太陽シリーズの ROM のアセットビューワ

## 対応している ROM

- 続・ボクらの太陽 (U32J rev1)
- 新・ボクらの太陽 (U33J): 名前 (スプライト名、スクリプト名、文字の対応など) は boktai2 decomp から作った U32J 用のものなので出さない

## Build

```sh
$ deno task bundle
```

## Dev

http://localhost:8080/

```sh
$ deno task dev
```

## Generated tables

`names.ts` (スプライト、アニメファイル、BG パレットの定数名)、`aux_anims.ts` (AuxSprite とアニメファイルの組)、`bgpltt_refs.ts` (BG パレットが読まれている場所) は boktai2 decomp のヘッダとソースから生成する

```sh
$ deno run --allow-read --allow-write tools/gen_tables.ts <path/to/boktai2>
$ deno fmt names.ts aux_anims.ts bgpltt_refs.ts
```

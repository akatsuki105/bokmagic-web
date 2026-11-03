# bokmagic-web

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

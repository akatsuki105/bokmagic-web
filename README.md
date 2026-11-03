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

`sprite_names.ts` (スプライトとアニメファイルの定数名) と `aux_anims.ts` (AuxSprite とアニメファイルの組) は boktai2 decomp のヘッダとソースから生成する

```sh
$ deno run --allow-read --allow-write tools/gen_tables.ts <path/to/boktai2>
$ deno fmt sprite_names.ts aux_anims.ts
```

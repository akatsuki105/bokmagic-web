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

## Sprite names

`sprite_names.ts` は boktai2 decomp の `include/constants/sprite.h` から生成する

```sh
$ deno run --allow-read --allow-write tools/gen_sprite_names.ts <path/to/boktai2>
```

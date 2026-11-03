# bokcc (vendored)

boktai2 decomp の `tools/bokcc/` から、バイトコードを命令木にして .bokc として描くのに要るファイルだけを手を入れずにコピーしたもの。

- コピー元: `tools/bokcc/instruction_reader.ts`, `instruction.ts`, `eucjp.ts`
- コピー元のコミット: 902e0595e (2026-10-26)

更新するときは同じファイルを上書きコピーする。このディレクトリは `deno fmt` / `deno lint` の対象から外してある。

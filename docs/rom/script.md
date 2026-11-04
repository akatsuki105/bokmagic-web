# スクリプト (gScriptDirectory)

ゲームのイベントやマップの読み込みは独自 VM のバイトコード (スクリプト) で書かれている。ツールはスクリプトの一覧を読み、bokcc で命令木にして .bokc として表示する。
さらに命令木を実行せずにたどる静的解析 (ScriptScanner) で、マップを読み込む呼び出しの引数を拾い、Map / Collision タブに使う。

## ROM 上の位置

- [gFS](filesystem.md) のエントリのうち、ID の上位16ビットが `0xA8D9` (`DIR_SCRIPT`) のものが gScriptDirectory を指す。下位16ビットは作品ごとに違う (U32J: `0xA41E`, U33J: `0x49BC`)。
- gScriptDirectory は普通の Directory (ファイル数, ID 表, オフセット表) の形をしていないので、`FileSystem.list` / `get` ではなく `FileSystem.rawEntry(0xA8D9)` で、上位16ビットだけを比べて指す先の ROM オフセットをそのまま取る。
- U32J rev1 では `0x08CBF248` (decomp の `include/vm.h` のコメント)。

## 構造

### ScriptDirectory

`script_entries` が可変長なので、それより後ろは `offsets` の位置 (E とする) からの相対で書く。U32J rev1 での実際の位置は decomp の `include/vm.h` の `ScriptDirectory` にある。

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u32 | buildDate | ビルド日時 (Unix 秒) |
| `0x04` | ScriptOffset[] | script_entries | スクリプトID - 1 で引く。`0xFFFFFFFF` で終わる (U32J は 11539 件) |
| E + `0x00` | u32 | offsets.script_data | E からの相対。`bytecodeSize` を指す |
| E + `0x04` | u32 | offsets.string_index | E からの相対。文字列の索引 |
| E + `0x08` | u32 | offsets.string_data | E からの相対。文字列の本体 |
| E + `0x0C` | u32 | offsets.unknown | E からの相対 |
| E + script_data | u32 | bytecodeSize | バイトコードの大きさ |
| E + script_data + `0x04` | u8[bytecodeSize] | bytecode | スクリプトの本体が並ぶ |
| その後ろ | u32 | specialScriptSize | |
| その後ろ | u8[] | specialScriptData | ID を持たない特別なスクリプト (VM_ExecSpecial) |

ツールが読むのは buildDate, script_entries, script_data, bytecode だけ。文字列と specialScriptData は読まない。

### ScriptOffset (script_entries の1件)

| オフセット | 型 | 名前 | 意味 |
| --- | --- | --- | --- |
| `0x00` | u24 (bit0-23) | offset | bytecode の先頭からのオフセット |
| `0x03` | u8 (bit24-31) | varCount | ローカル変数の個数 (スタックフレームの大きさ) |

複数のスクリプトID が同じ offset を指すことがある (同じ実体)。数千件のこともある。

### ScriptEntry (script.ts の型)

| 名前 | 意味 |
| --- | --- |
| id | スクリプトID (script_entries の添字 + 1) |
| offset | ROM オフセット (= bytecode の位置 + ScriptOffset の bit0-23) |
| varCount | ScriptOffset の bit24-31 |

### バイトコード

スクリプト1本はブロック命令 (`0x80`) 1つ。命令の種類は先頭バイトの上位ニブルで決まる (`include/vm.h`)。

| 上位ニブル | 名前 | 意味 |
| --- | --- | --- |
| `0x00` | 定数 / END | 下位ニブルが定数の型 (`0x0` はブロックや引数列の終わり, `0x1` s16, `0x2` u8, `0x6` u16, `0x7` 文字列, `0x8` u24, `0x9` s32, `0xE` StringRef など) |
| `0x10` / `0x20` | MEMORY / MEMORY_INDEXED | メモリ参照 (gStat, gWorld, scratch など) |
| `0x30` | EXPRESSION | 式 (逆ポーランド記法) |
| `0x40` | PARAMETER | 引数。0 は直前の結果 (r), 1 以上は p0, p1, ... (`VM_ParseParameter`) |
| `0x50` | LABEL | 1文字の名前付き引数 (`.n = 16` など) と if/switch の節 (`c` `d` `e` `i`) |
| `0x60` | CONTROL | 制御命令。先頭 u16 が ID |
| `0x70` | CALL | 別のスクリプトを即値のIDで呼ぶ (`VM_CallScript`) |
| `0x80` | BLOCK | ブロック |
| `0x90` | VARIABLE | ローカル変数 v1, v2, ... (`VM_GetVariable`) |
| `0xA0` | END_EXPRESSION | 式の終わり |

制御命令の ID (`bokcc/instruction.ts` の `ControlType`)

| ID | 名前 | 意味 |
| --- | --- | --- |
| `0x0D86` | If | 条件が真の最初の節だけを実行する (`VM_Ctrl_If`) |
| `0x4A6F` | Switch | 最初に一致した case か default の節だけを実行する。fall-through は無い (`VM_Ctrl_Switch`) |
| `0x121F` | CallIndirect | 実行時に決めたIDでスクリプトを呼ぶ |
| `0xCD3A` | Return | |
| `0xC8BB` | LoadMap | 先頭の値 (u16) を次のマップの初期化スクリプトIDにする (`VM_Ctrl_LoadMap`) |
| `0x9906` | EntityCreate | gCommandList から引いた関数を (u16)ID 付きで呼ぶ (`VM_Ctrl_CreateEntity`) |
| `0xB745` | SubroutineCall | gCommandList から引いた関数を呼ぶ (`VM_Ctrl_CallSubroutine`) |
| `0xB96E` | DebugPrint | |
| `0xD4CB` | SetZoneCallback | |

SubroutineCall / EntityCreate が呼ぶ関数の ID は `src/vm_commands.s` の gCommandList にある。呼ばれた関数は `VM_SeekToNamedArg` / `VM_GetNamedArgValue` で名前付き引数 (ラベル) を読む。

## パースの手順

1. `parseScriptDirectory(rom, fs)` (script.ts): `fs.rawEntry(0xA8D9)` で先頭を得る。先頭 u32 を buildDate にし、`+0x04` から u32 を `0xFFFFFFFF` まで集める。その次の u32 (script_data) を足した位置 + 4 を bytecode の先頭にし、各エントリを `{ id: i + 1, offset: bytecode + (e & 0xFFFFFF), varCount: e >>> 24 }` にする。decomp の `VM_MountScriptDirectory` と同じ解決の仕方。
2. `decodeScript(rom, s)` (script.ts): `s.offset` から `bokcc/` の `InstructionReader.decompile()` で命令木 (`Instruction[]`) にする。
3. 表示では命令木の各要素の `toString(ctx)` で .bokc の文字列にする (`view_script.tsx`)。

### bokcc (vendored)

- `bokcc/` は decomp の `tools/bokcc/` から `instruction_reader.ts`, `instruction.ts`, `eucjp.ts` を手を入れずにコピーしたもの (`bokcc/README.md`, コピー元コミット 902e0595e)。
- `deno.json` の fmt / lint の exclude に入れてある。直すときはこのリポジトリで書き換えず、decomp 側で直して上書きコピーする。
- `Instruction` は `insnType` (Constant, Variable, Parameter, Expression, Label, Control, Call, Block, Operator など), `value`, `children`, `address` (ROM オフセット) を持つ木。制御命令の `children[0]` が先頭の値 (SubroutineCall なら関数ID), ラベルは `value` が文字コードで `children` が値の列。式は `children` が逆ポーランド記法の並びで、演算子は `OPERATORS` の番号 (`4` が `+`, `22` が `=` など)。

### analysis.ts の関数

ROM 全体を見ないと決まらないものを ROM ごとに1回だけ計算し、`WeakMap<ROMFile, Map>` に覚えておく (`memo`)。

| 関数 | 返すもの |
| --- | --- |
| `scriptDirectory(rom)` | `parseScriptDirectory` の結果 |
| `scriptCallers(rom)` | スクリプトID → それを定数で呼んでいる (`0x70`) スクリプトIDの列。全スクリプトの命令木を再帰でたどって集める。同じ offset のスクリプトは最初のIDで1回だけたどるので、呼び出し元として出るのはそのIDだけ |
| `mapLoads(rom)` | `ScriptScanner.roots()` の各起点を `scan()` し、読み込み呼び出しを種類別 (tilemaps, tilesets, pltts, bgs, collisions, stages) に分けたもの。タイルマップの読み込みが無い起点は捨てる |
| `collisionLoads(rom)` | 当たり判定マップID (`0x30AD` の `.p`) → それを読み込む呼び出し。同じ呼び出し位置で `.n` も同じものは1つにまとめる。[Collision タブ](collision.md) が使う |
| `mapEntries(rom)` | Map タブの1項目の列。[map.md](map.md) を参照 |

## 静的解析 (ScriptScanner)

`script_scan.ts` の `ScriptScanner` は VM ではない。スクリプトを実行せずに命令木をたどり、アセットを読み込む呼び出しの引数のうち、定数で決まるものを拾う。メモリ (gStat など) の値は追わない。

### 拾う呼び出し

| ID | 呼び方 | 関数 (decomp) | 拾う引数 |
| --- | --- | --- | --- |
| `0x11D4` | SubroutineCall | Cmd_LoadTileSet | `.t` BG, `.d` タイルセット, `.c` 部品IDの列, `.s` 読み込み先, `.m` タイルマップ ([bg.md](bg.md)) |
| `0x7A27` | SubroutineCall | Cmd_LoadTileMap | `.d` タイルマップ, `.t` BG の構成, `.n` レイヤ数, `.i` / `.c` レイヤの並び ([bg.md](bg.md)) |
| `0x30AD` | SubroutineCall | Map_LoadMapScripted | `.p` 当たり判定マップ, `.n` タイルマップ ([collision.md](collision.md)) |
| `0x82B3` | SubroutineCall | Cmd_82B3 | `.s` StageID (`gStat->stageID` に入る) |
| `0x4AE5` | EntityCreate | Entity4AE5_Create | `.p` マップの BG パレットの列 (最大4) ([palette.md](palette.md)) |
| `0xB4B4` | EntityCreate | Cmd_CreateBG | `.i` BG 番号, `.p` BG の優先度, `.d` タイルマップ ([bg.md](bg.md)) |

`0x30AD` の `.n` はゲーム側では読むだけで使わない (`Map_LoadMapScripted` のコメント)。ツールはこれをタイルマップIDとみなして、当たり判定をどの場面のタイルマップに付けるかを決めている (推測に基づく対応付け)。

1回の呼び出しは `LoadCall` にする。

| 名前 | 意味 |
| --- | --- |
| root | 展開を始めたスクリプトID |
| script | 呼び出しが書かれているスクリプトID |
| sub | 上の表の ID |
| address | 呼び出し命令の ROM オフセット |
| conditional | 定数で決まらない if/switch の節の中にある |
| args | ラベルの文字 → 値の列。値は下位16ビット、定数で決まらなければ `null` |

### たどり方

- **環境**: スクリプト1回の実行ごとに `{ vars, params, conditional }` を持つ。`vars` はローカル変数で、長さ8の `null` で始める (`varCount` は使わない)。`params` は呼び出し元が渡した値。
- **値の評価** (`value`): 定数はその値、変数は `vars[n]`、引数は `params[n - 1]` (`n = 0` の直前の結果は `null`)、式は下の RPN 評価。メモリ参照、ブロック、スクリプト呼び出しの戻り値などはすべて `null`。
- **式** (`expression`): 逆ポーランド記法の並びをスタックで評価する。単項 `-` `!` `~` と二項 `+` から `&&` までを JS で計算する。値が1つでも `null`、0 除算、それ以外の演算子 (`=` など) があれば `null`。
- **代入** (式の文): 式の中のブロックやスクリプト呼び出しは中まで実行する。左辺が変数で `=` を含むとき、`[変数, 右辺, =]` の3要素なら右辺の値を入れ、それ以外 (`v1 = p0 + 1` など) は `null` にする。
- **スクリプト呼び出し (`0x70`)**: 引数を評価して `params` に束縛し、呼び先の命令木を新しい環境で実行する。`conditional` は呼び出し元のものを引き継ぐ。呼び出しの深さは `MAX_DEPTH` = 16 まで。今の呼び出し列に既にあるID (再帰) は展開しない。
- **if / switch**: 節を「入る条件」と本体の組に並べ直す (else / default は条件 1、switch の case は `head === 値`)。前から順に見て、条件が 0 の節は飛ばし、定数で真の節に当たればそこだけ実行して終わる。条件が `null` の節に当たったら、そこから後ろの節を全部、変数の写しで `conditional = true` にして実行し、終わった後の変数を合流させる (どの節にも入らない場合も合流に含める)。食い違った変数は `null` になる。
- **記録**: SubroutineCall / EntityCreate の先頭の値が上の表の ID なら、ラベルの値を評価して `LoadCall` にする。それ以外の制御命令 (LoadMap, CallIndirect, Return など) の中は見ない。

### 起点 (`roots()`)

全スクリプトの命令木を1回ずつ (同じ offset は1回) 見て、次を起点にする。

1. `0x7A27` / `0x11D4` / `0x30AD` の SubroutineCall か `0x4AE5` の EntityCreate を直接含むスクリプト。
2. 1 を定数で呼んでいる呼び出し元を `ROOT_LEVELS` = 3 段まで遡ったもの。U33J は ID を引数で2-3段受け渡してから読み込むので、引数が定数で決まる高さから展開する必要がある。
3. LoadMap (`0xC8BB`) の行き先のスクリプトID。

`scan(root)` は起点を引数無しで呼んだものとして展開し、届いた `LoadCall` を実行順に返す。

### できないこと

- メモリ (gStat, gWorld, scratch など) の値で分かれる分岐は決まらないので、全部の節を通る。
- if/switch の条件の式や、変数の右辺の中で呼ぶスクリプトは展開しない (`value` は呼び出しを `null` にするだけ)。
- Return を見ないので、return の後ろの文もたどる。
- CallIndirect の行き先はたどらない。

## 表示での扱い

- Script タブ (`view_script.tsx`): 左にスクリプトの一覧 (ID か名前で絞り込み)、右に .bokc、ID, ROM アドレス (`offset + 0x08000000`), variables (`varCount`), called by (`scriptCallers`), 同じ offset を指す別のID (「同じ実体」, 開いたときだけリンクを作る) を出す。
- 選んでいるスクリプトは URL の `#script/0xXXXX` に入れる (`scriptHref`)。Map タブと Collision タブはここへリンクする。
- .bokc の中の `Script_...` の名前はリンクにする。
- スクリプト名と文字列名 (`generated/names.ts` の SCRIPT_NAMES, STRING_NAMES, decomp の `include/constants/script.h` と `strings.h` から作る) は U32J rev1 のときだけ使う (`decomp.ts`)。それ以外の ROM では `Script_0xXXXX` のような番号の名前になる (`bokcc/instruction.ts` の `scriptName`)。

## 根拠

- `include/vm.h`: `ScriptDirectory`, `ScriptOffset`, `ScriptDirectoryOffsets`, opcode の定義, VM のスタックフレームと p0 / v1 の対応
- `include/file.h`, `src/file.c`: `DIR_SCRIPT` = `0xA8D9`, gFS の `((0xA8D9 << 16) | 0xA41E)` → gScriptDirectory
- `src/vm.c`: `VM_MountScriptDirectory`, `VM_Parse_ScriptDirectory_ScriptEntries`, `VM_LookupByID`, `VM_CallScript`, `VM_ParseParameter`, `VM_GetVariable`, `VM_ExecBlock`
- `src/vm_ctrl1.c`: `VM_Ctrl_If_Internal`, `VM_Ctrl_Switch`
- `src/vm_ctrl2.c`: `VM_Ctrl_LoadMap`, `VM_Ctrl_CreateEntity`, `VM_Ctrl_CallSubroutine`
- `src/vm_commands.s`: gCommandList (`0x11D4`, `0x7A27`, `0x30AD`, `0x82B3`, `0x4AE5`, `0xB4B4`, `0x1B77`, `0x515D`)
- `src/entity_08000a94.c`: `Cmd_LoadTileSet`, `Cmd_LoadTileMap`, `Cmd_CreateBG`
- `src/camera.c`: `Map_LoadMapScripted`
- `src/map_pltt_4ae5.c`: `Entity4AE5_Create`, `Entity4AE5_Init` (`.p` を最大4個読む)
- `src/menu.c`: `Cmd_82B3`, `Cmd_515D`, `FUN_0808fc14`
- `src/entity_d438.c`: `Cmd_1B77`
- `data/scripts/scripts.bokc`: `Script_0x001D`, `Script_0x0020`
- `include/constants/strings.h`: `STR_MAP_CODENAME` = `0x14F9`, `STR_STARTMENU_MAP` = `0x1826`

## 未解明

- **マップ名の対応**: マップのコードネーム (String_14F9 から並ぶ文字列) は `Script_0x001D` で `EntityCreate(0x1B77, ..., .s = StringRef(STR_MAP_CODENAME))` に渡されるが、製品版の `Cmd_1B77` は中身が空なので、コード上はマップとコードネームの対応が無い。
- **表示用のマップ名**: 表示名 (String_1826 から並ぶ文字列) はフロアごとにあり、`Script_0x0020` でスタートメニューに `.A = StringRef(STR_STARTMENU_MAP)` として渡される。どの添字を引くかは確認できていない。候補は `Cmd_515D` が `.f` から入れる `gStat->unk_256` で、`FUN_0808fc14` (menu.c) が stageID と `unk_256` から行番号を引いている (推測)。
- `ScriptDirectoryOffsets.unknown` と specialScriptData の中身。

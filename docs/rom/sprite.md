# スプライト (OBJ)

このゲームの OBJ (GBA のハードウェアスプライト) で描かれる絵は、次の 3 種類のデータから作られる。どれも 4bpp タイルと SpriteShape (OBJ の形とサイズ) の組をいくつか並べた「ポーズ (メタスプライト)」を単位にしている。

- MainSprite: 主人公・ボス・UI など絵の多いもの。1 キャラ 1 ファイルで、ポーズとアニメを自分のファイルに持つ (`sprite_main.ts`, `anim_main.ts`)。
- AuxSprite: 小道具など。全キャラ分が 1 つの AuxSpriteFile にまとまっている。アニメは持たず、別ディレクトリの AuxAnimFile を外から当てる (`sprite_aux.ts`, `anim_aux.ts`)。
- Particle: 小さなエフェクト。1 つの ParticleFile の中にグループが 3 つあり、1 コマは OBJ 1 枚。アニメは AuxAnimFile を使い回す (`particle.ts`)。

3 種類とも最後は `render.ts` の `Obj` の配列に分解し、`renderObjs` で `Pixels` (`render.ts`, RGBA の画像) に描く。パレットはどれも gObjPlttData (OBJ パレットファイル) の 16 色パレットを plttID で引く ([palette.md](palette.md))。ファイルの探し方 (gFS, `GetFile`) は [filesystem.md](filesystem.md) を参照。

どのスプライトにどのアニメファイルを当てるかは ROM のデータからは決まらない。ビューワは decomp のソースから拾った表 (`generated/aux_anims.ts`, `generated/particle_refs.ts`) で候補を出しているだけで、パースのコードはこの表に依存しない (AuxAnim の節の「表示での扱い」を参照)。

## MainSprite

1 ファイルに 1 キャラ分のポーズ・アニメ・タイル・パレット番号が入っている。タイルは横 16 枚の 2D シートとして並んでいて、サブスプライトごとに矩形を切り出して OBJ VRAM へ送る。アニメは同じファイルの MainAnim をゲームのステートマシン (`MainSprite_AdvanceAnim` など) と同じ処理で再生する。

### ROM 上の位置

- ディレクトリ `DIR_MAIN_SPRITE` (0xCB05) の各ファイルが 1 つの MainSpriteGfxFile。ファイル ID は SpriteID (`SPRITE_*`)。
- `GetFile` が返す ROM 上のポインタを `OpenMainSpriteFile` がそのままヘッダとして読むので、圧縮はされていない。
- ヘッダ内のオフセットはすべてファイル先頭からのバイト数 (`OpenMainSpriteFile` がファイル先頭を足してポインタにする)。

### 構造

MainSpriteGfxFile (ヘッダ, 0x20 バイト)

| オフセット | 型  | 名前           | 意味                                                                               |
| ---------- | --- | -------------- | ---------------------------------------------------------------------------------- |
| `0x00`     | u16 | palStart       | 基準の OBJ パレット番号。`MainSprite_LoadPose` が MainSprite.plttID の初期値にする |
| `0x02`     | u16 | poseCount      | MainSpritePose の数                                                                |
| `0x04`     | u16 | animationCount | MainAnim の数                                                                      |
| `0x06`     | u16 | subspriteCount | MainSubsprite の総数 (リポジトリでは未使用)                                        |
| `0x08`     | u16 | cmdCount       | MainAnimCmd の総数 (リポジトリでは未使用)                                          |
| `0x0A`     | u16 | tileCount      | タイル枚数 (1 枚 32 バイト, 4bpp)                                                  |
| `0x0C`     | u32 | poses          | MainSpritePose[poseCount] へのオフセット                                           |
| `0x10`     | u32 | anims          | MainAnim[animationCount] へのオフセット                                            |
| `0x14`     | u32 | subsprites     | MainSubsprite[subspriteCount] へのオフセット                                       |
| `0x18`     | u32 | cmds           | MainAnimCmd[cmdCount] へのオフセット                                               |
| `0x1C`     | u32 | tiles          | タイル (tileCount × 32 バイト) へのオフセット                                      |

MainSpritePose (20 バイト)

| オフセット | 型  | 名前            | 意味                                                                       |
| ---------- | --- | --------------- | -------------------------------------------------------------------------- |
| `0x00`     | u16 | unk_0           | 不明。MainSprite.unk_0 にコピーされる                                      |
| `0x02`     | u16 | subspriteCount  | このポーズのサブスプライト数                                               |
| `0x04`     | s16 | offsetX         | 画面座標に足すオフセット (decomp の型は u16, 「未解明」を参照)             |
| `0x06`     | s16 | offsetY         | 同上                                                                       |
| `0x08`     | s16 | boxRight        | 画面外判定の矩形                                                           |
| `0x0A`     | s16 | boxBottom       | 同上                                                                       |
| `0x0C`     | s16 | boxLeft         | 同上                                                                       |
| `0x0E`     | s16 | boxTop          | 同上                                                                       |
| `0x10`     | u32 | subspriteOffset | subsprites 配列の先頭から、このポーズの最初の MainSubsprite までのバイト数 |

MainSubsprite (8 バイト, OBJ 1 枚)

| オフセット | 型  | 名前                                      | 意味                                                                                           |
| ---------- | --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `0x00`     | u8  | flip                                      | bit2: xflip, bit3: yflip。他のビットは不明                                                     |
| `0x01`     | u8  | shape                                     | SpriteShape = `(size << 2) \| shape` (render の節の `OBJ_SIZE`)                                |
| `0x02`     | s16 | x                                         | ポーズの原点からの OBJ 左上の X                                                                |
| `0x04`     | s16 | y                                         | 同 Y                                                                                           |
| `0x06`     | u16 | tileNum (bit0-11) / paletteNum (bit12-15) | tileNum: tiles 上のタイル番号 (2D シート上の左上)。paletteNum: palStart からの相対パレット番号 |

MainAnim (8 バイト)

| オフセット | 型  | 名前      | 意味                                                               |
| ---------- | --- | --------- | ------------------------------------------------------------------ |
| `0x00`     | u16 | unk_0     | アニメの識別値。`MainSprite_SetAnim` が MainSprite.unk_12 と比べる |
| `0x02`     | u16 | cmdCount  | コマ数                                                             |
| `0x04`     | u32 | cmdOffset | cmds 配列の先頭から、このアニメの最初のコマまでのバイト数          |

MainAnimCmd (4 バイト, 1 コマ)

| オフセット | 型  | 名前     | 意味                        |
| ---------- | --- | -------- | --------------------------- |
| `0x00`     | u16 | poseIdx  | 当てるポーズ番号            |
| `0x02`     | u16 | duration | 表示フレーム数 (等速のとき) |

タイルの並び

- 4bpp, 1 タイル 32 バイト。横 16 タイル (0x200 バイト) で 1 行の 2D シートになっている (`MAIN_SPRITE_SHEET_TILES = 16`)。
- サイズ w×h の OBJ の (列 c, 行 r) のタイルは `tiles[tileNum + r * 16 + c]`。

### パースの手順

`parseMainSprite` (`sprite_main.ts`) が DataView とファイル先頭の ROM オフセットから `MainSpriteGfx` を作る。

1. ヘッダから palStart, poseCount, animationCount, tileCount と 5 つのオフセットを読む。
2. ポーズ i を `poses + i * 20` から読む。サブスプライトは `subsprites + subspriteOffset` から subspriteCount 個 (8 バイトずつ) を読み、`0x06` の u16 を tileNum (下位 12 ビット) と paletteNum (上位 4 ビット) に分ける。
3. アニメ i を `anims + i * 8` から読み、コマを `cmds + cmdOffset` から cmdCount 個 (4 バイトずつ) 読む。
4. タイルは `tiles` から `tileCount * 32` バイトを ROM のバッファの subarray として持つ (コピーしない)。

ポーズを OBJ に分解するのは `poseToObjs` (`sprite_main.ts`)。`MainSprite_DrawInternal` と同じ配置にする。

1. サブスプライトの shape から `OBJ_SIZE` で w, h を引く (未定義の shape は飛ばす)。
2. パレットは `gObjPlttData[(plttID + paletteNum) * 16]`。plttID の既定値は palStart。範囲外ならグレースケール。
3. スプライト全体の反転 (SPRFLAG_XFLIP / SPRFLAG_YFLIP 相当の引数) があれば座標を `x' = -(x + w)` (Y も同様) にし、OBJ の反転は「サブスプライトの flip ビット XOR スプライトの反転」にする。
4. 最後にポーズの offsetX/offsetY を足す (反転しない)。
5. `tileStride` は 16 (2D シート)。

### アニメーション (anim_main.ts)

`MainSpriteAnimState` (`anim_main.ts`) は MainSprite 構造体のうちアニメに関わるメンバだけを持ち、`src/sprite_anim_main.c` の処理をそのまま移している。

状態

| 名前                       | 意味                                       |
| -------------------------- | ------------------------------------------ |
| poseIdx                    | 最後に `MainSprite_SetPose` で当てたポーズ |
| hidden                     | SPRFLAG_HIDDEN (PLAY_ONCE_HIDE で立つ)     |
| unk_12                     | 再生中の MainAnim.unk_0                    |
| animCmdTimer               | 今のコマの経過フレーム                     |
| animCmdDuration            | 今のコマの実フレーム数                     |
| animSpeed                  | 再生速度。u10.6 固定小数で 64 が 1.0       |
| animCmdIdx / animCmdLength | 今のコマ番号 / コマ数                      |
| animFlags                  | 再生フラグ (下表)                          |
| playMode                   | 再生モード (下表)                          |
| animEvents                 | そのフレームに起きたこと (下表)            |

playMode (`PLAYMODE_*`): 0 = PAUSE (止まる), 1 = LOOP (0/2/3 以外はすべてループ扱い), 2 = ONCE_AND_STOP (最後で PAUSE になる), 3 = PLAY_ONCE_HIDE (最後で PAUSE になり、SPRFLAG_HIDDEN を立てる)。

animFlags (`MainAnimPlayFlags16`)

| ビット | 名前       | 意味                                                                                                         |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------ |
| 0      | KEEP_FRAME | 頭出ししない。animCmdIdx, animCmdTimer, animEvents, animSpeed を初期化せず、今の animCmdIdx のコマから続ける |
| 1      | REVERSE    | 逆再生。最後のコマから始め、animCmdIdx を減らし、0 で終端                                                    |
| 2      | FORCE_POSE | 同じアニメ (unk_12 が一致) を指定してもポーズを当て直す                                                      |

animEvents (`MainAnimEvents8`): bit0 WILL_END (次のコマ切り替えで終わる), bit1 ENDED (今終わった), bit2 ADVANCED (コマが進んだ)。

コマの実フレーム数は `cmdDuration(cmd, speed) = (FixToInt(6, duration * speed) & 0xFFFF) || 1`。つまり `duration * speed / 64` を 0 方向へ丸め、0 なら 1。

`setAnim` (`MainSprite_SetAnim`)

1. 始めのコマを選ぶ: KEEP_FRAME なら今の animCmdIdx、REVERSE なら最後、どちらでもなければ先頭。
2. `unk_12 !== anim.unk_0` か FORCE_POSE なら、そのコマのポーズを当てる。
3. unk_12, animCmdLength, animFlags, playMode, コマ列を更新し、animCmdDuration を計算する。このとき animSpeed は **まだ 1.0 に戻す前の値** を使う。
4. KEEP_FRAME でなければ animCmdIdx (REVERSE なら最後), animCmdTimer = 0, animEvents = 0, animSpeed = 64 にする。

`advance` (`MainSprite_AdvanceAnim`, 1 フレーム分)

1. PAUSE なら何もしない。animEvents を 0 にする。
2. animCmdTimer が 0 なら今のコマのポーズを当てる。
3. animCmdTimer を 1 増やし、animCmdDuration 以上ならコマを進める (REVERSE なら戻す)。端を越えたら終了: ENDED を立て、ONCE_AND_STOP なら PAUSE、PLAY_ONCE_HIDE なら PAUSE + hidden、それ以外は先頭 (REVERSE なら最後) に戻して ADVANCED。終了でなければ ADVANCED。その後 timer = 0 にして新しいコマの animCmdDuration を計算する。
4. コマが進まなかったフレームで `animCmdTimer + 1 >= animCmdDuration` かつ最後のコマ (REVERSE なら 0 番) なら WILL_END。

`setAnimFrame` (`MainSprite_SetAnimFrame`): cmdIdx を cmdCount - 1 で頭打ちにしてそのコマのポーズを当て、animCmdDuration を今の animSpeed で計算し直し、timer = 0、animEvents を WILL_END の条件だけで作り直す。

`setAnimSpeed` (`MainSprite_SetAnimSpeed`): animSpeed を変え、今のコマの animCmdDuration を計算し直し、WILL_END だけ付け直す。timer はそのまま。

### 表示での扱い

- MainSprite タブ (`view_main.tsx`) はファイル一覧 (ID 昇順) から 1 つ選び、pose, plttID (既定値 palStart), scale, xflip を変えられる。yflip のチェックボックスは無い (`poseToObjs` 自体は yflip を扱える)。
- パレットの行は、そのポーズのサブスプライトが使う paletteNum ごとに `plttID + paletteNum` を並べる。
- アニメのパネルは `new MainSpriteAnimState()` (MainSprite_Add 直後と同じ unk_12 = 0, PAUSE) に対して `setAnim` を呼び、`useFrameLoop` で GBA のフレームレート (約 59.73fps) ごとに `advance` する。速度は SetAnim が 1.0 に戻すので、64 以外ならその後に `setAnimSpeed` を当て直す。
- unk_0 が 0 のアニメを新しい状態に SetAnim すると、unk_12 (0) と一致するのでポーズは当たらず、最初の `advance` で初めてコマのポーズになる。これはゲームと同じ挙動。
- PLAY_ONCE_HIDE で終わると絵を消す。ゲームではもう一度出すのは呼び出し側 (`MainSprite_Show`) の仕事なので、ビューワは SetAnim のときに hidden を戻している。
- KEEP_FRAME で animCmdIdx がコマ数以上のとき、ゲームは範囲外を読むが、`setAnim` は最後のコマに丸めている。
- ゲームの描画では他に回転・拡大 (affine), 点滅, 画面外判定, パレットスロットの確保 (`FUN_0822f650`, `AllocBlendPlttSlot` 系) が掛かるが、ビューワは扱わない。

### 根拠

- `include/sprite_main.h`: MainSpriteGfx, MainSpritePose, MainSubsprite, MainAnim, MainAnimCmd, MainSprite, PLAYMODE_*, MainAnimPlayFlags16, MainAnimEvents8。
- `src/sprite_main.c`: `OpenMainSpriteFile` (オフセット → ポインタ), `MainSprite_LoadPose` (palStart → plttID, subspriteOffset はバイト数), `MainSprite_Load` (animSpeed = 1.0)。
- `src/video.c` `CopyMainSpriteTileDataToVram`: 1 要求ごとに `size` バイトずつ `count` 回転送し、転送元を毎回 0x200 進める。要求は `asm/func/MainSprite_DrawInternal.inc` が積み、src = `tiles + tileNum * 32`、size = `gOAMTileWidthTable[shape] << 5`、count = `gOAMTileHeightTable[shape]` (表は `src/video_reg.c` `Video_CreateSpriteLUT`)。これが横 16 タイルの 2D シートの根拠。tileNum は `lsl #20; lsr #20` で 12 ビットとして使われる。
- `asm/func/MainSprite_DrawInternal.inc`: パレットは使われている paletteNum ごとに `plttID + paletteNum` と `pltt + paletteNum * 32` で `FUN_0822f650` を呼んでスロットを取る。スプライトの XFLIP/YFLIP で座標を `-(x + w)` にし、OAM の反転ビットは「スプライトの反転 != サブスプライトの flip ビット」で立てる (XOR)。
- `src/sprite_main_arm.c` `MainSprite_DrawListInternal`: ポーズの offsetX/offsetY を画面座標に足してから `MainSprite_DrawInternal` を呼ぶ。
- 重なり順: `MainSprite_DrawInternal` はサブスプライトを順に gStagedOAMBuffer に積む。`asm/func/Video_BuildOAM.inc` は z (attr3 の上位バイト) ごとに後入れ先出しの連結リストを作ってから OAM に並べるので、同じ z では後に積んだ (後ろの) サブスプライトの OAM 番号が若く、手前に出る。ただし SPRFLAG_OAM_DIRECT のときは gOAMBuffer へ直接順に書くので前のものが手前になる (ビューワは扱わない)。
- `src/sprite_anim_main.c`: `MainSprite_SetAnimFrame`, `MainSprite_SetAnimSpeed`, `MainSprite_AdvanceAnim` (NONMATCHING_C)。`asm/func/MainSprite_SetAnim.inc`: 始めのコマの選び方、unk_12 と FORCE_POSE、速度リセット前の duration 計算。

### 未解明

- MainSpritePose.unk_0, MainAnim.unk_0 の意味。`FUN_0822f2bc` が unk_0 でポーズを探すが、呼び出し元は見つかっていない。
- MainSubsprite.flip の bit2/bit3 以外。
- tileNum の bit10-11: 転送元の添字としては 12 ビット使われるが、実データで 0x400 以上が出るかは確認していない。
- offsetX/offsetY の符号: decomp は u16 として持ち、`MainSprite_DrawListInternal` も `ldrh` で読んで足す。リポジトリは s16 で読む。0x8000 未満なら同じ値になる。負の値が実データにあるかは確認していない。

## AuxSprite

全 AuxSprite が 1 つの AuxSpriteFile にまとまっていて、`Video_GetAuxSprite` が SpriteID でエントリを探す。ポーズのタイルは 1D (サブスプライトの順に詰めて) 並び、パレットはスプライト全体で 1 つ。アニメは持たない。

### ROM 上の位置

- `DIR_AUX_SPRITE` (0x98F5) のファイル 0xFF54。`AgbMain` (`src/main.c`) が `LoadAuxSpriteFile(GetFile(DIR_AUX_SPRITE, 0xFF54))` で読む。
- `GetFile` のポインタを直接使うので圧縮されていない。ヘッダ内のオフセットはファイル先頭からのバイト数。

### 構造

AuxSpriteFile (ヘッダ 0x18 バイト + entries)

| オフセット | 型                         | 名前                | 意味                                                 |
| ---------- | -------------------------- | ------------------- | ---------------------------------------------------- |
| `0x00`     | u32                        | unk_00              | 0                                                    |
| `0x04`     | s32                        | entryCount          | エントリ数 (`Video_GetAuxSprite` は符号付きで比べる) |
| `0x08`     | u32                        | unk_08              | 0                                                    |
| `0x0C`     | u32                        | offsetToTiles       | タイル配列へのオフセット                             |
| `0x10`     | u32                        | offsetToMetasprites | AuxSpritePose 配列へのオフセット                     |
| `0x14`     | u32                        | offsetToSubsprites  | AuxSubsprite 配列へのオフセット                      |
| `0x18`     | AuxSpriteEntry[entryCount] | entries             | 各スプライトの見出し                                 |

配列の長さはヘッダに無い。タイルは `offsetToMetasprites - offsetToTiles` バイト、ポーズは `(offsetToSubsprites - offsetToMetasprites) / 12` 個として読む (decomp の `static_assert` の配列サイズとも合う)。サブスプライト配列はファイルの終わりまでだが、ポーズから参照される分だけ読む。

AuxSpriteEntry (12 バイト)

| オフセット | 型  | 名前          | 意味                                                                             |
| ---------- | --- | ------------- | -------------------------------------------------------------------------------- |
| `0x00`     | u16 | id            | SpriteID                                                                         |
| `0x02`     | u8  | flags         | AuxSpriteGfxFlags。bit4 = ASGFLAG_BPP8。このゲームでは全て 0 (decomp のコメント) |
| `0x03`     | u8  | unk_03        | 0                                                                                |
| `0x04`     | u8  | pw            | 画面外判定の矩形の幅                                                             |
| `0x05`     | u8  | ph            | 同 高さ                                                                          |
| `0x06`     | s8  | px            | 同 原点からの X オフセット                                                       |
| `0x07`     | s8  | py            | 同 Y オフセット                                                                  |
| `0x08`     | u32 | spritesOffset | ポーズ配列の先頭から、このスプライトの最初のポーズまでのバイト数 (12 の倍数)     |

AuxSpritePose (12 バイト)

| オフセット | 型  | 名前            | 意味                                                                                  |
| ---------- | --- | --------------- | ------------------------------------------------------------------------------------- |
| `0x00`     | u8  | subspriteCount  | サブスプライト数                                                                      |
| `0x01`     | u8  | tileCount       | このポーズのタイル数 (サブスプライトのタイル数の合計)                                 |
| `0x02`     | u16 | plttID          | OBJ パレット番号。描画で使われるのは最初のポーズの値だけ (下記)                       |
| `0x04`     | u32 | tileOffset      | タイル配列の先頭から、このポーズの最初のタイルまでのバイト数 (tiles[tileOffset >> 5]) |
| `0x08`     | u32 | subspriteOffset | サブスプライト配列の先頭から、このポーズの最初のサブスプライトまでのバイト数          |

AuxSubsprite (4 バイト)

| オフセット | 型 | 名前   | 意味                    |
| ---------- | -- | ------ | ----------------------- |
| `0x00`     | u8 | shape  | SpriteShape             |
| `0x01`     | u8 | unk_01 | 0                       |
| `0x02`     | s8 | x      | 原点からの OBJ 左上の X |
| `0x03`     | s8 | y      | 同 Y                    |

### パースの手順

`parseAuxSprites` (`sprite_aux.ts`) が全エントリを読み、ID 昇順の `AuxSpriteGfx[]` を返す。

1. `fs.get(DIR_AUX_SPRITE, 0xFF54)` でファイルを探す。
2. ヘッダから entryCount と 3 つのオフセットを読み、全ポーズ数 `(offsetToSubsprites - offsetToMetasprites) / 12` を出す。タイルは `offsetToTiles` から `offsetToMetasprites` までを subarray で持つ。
3. 全ポーズを読む。tileNum は `tileOffset >> 5`、サブスプライトは `offsetToSubsprites + subspriteOffset` から subspriteCount 個。
4. エントリを `0x18 + i * 12` から読み、最初のポーズ番号を `spritesOffset / 12` にする。
5. エントリごとに:
   - `poses` = 最初のポーズからポーズ配列の最後まで全部 (`allPoses.slice(firstPose)`)。
   - `poseCount` = 次に大きい firstPose (なければ全ポーズ数) までの数。ROM にポーズ数は無いので、ビューワが推定した値。
   - `plttID` = 最初のポーズの plttID。

ポーズの OBJ への分解は `auxPoseToObjs` (`sprite_aux.ts`)。`AuxSprite_DrawInternal` と同じ配置にする。

1. ポーズは `poses[poseIdx]`。
2. パレットはスプライト全体で 1 つ: `gObjPlttData[plttID * 16]` (既定値は最初のポーズの plttID)。
3. タイルはポーズの tileNum から始め、サブスプライトの順に `w/8 * h/8` 枚ずつ進める 1D 配置。`tileStride` は `w / 8`。
4. 反転はスプライト全体にだけ掛かる: 座標を `-x - w` / `-y - h` にし、すべての OBJ を同じ向きで反転する。サブスプライトに反転ビットは無い。

### 表示での扱い

- AuxSprite タブ (`view_aux.tsx`) は ID 昇順の一覧から選び、pose, plttID (既定値は最初のポーズの plttID), scale, xflip, yflip を変えられる。アニメ再生中は xflip/yflip をアニメが決めるので無効になる。
- **ポーズ番号は後ろのエントリのポーズまで届く**。ゲームは `gfx->poses[poseIdx]` を範囲チェックなしで引くだけなので、アニメのコマが poseCount 以上のポーズ (次のエントリ以降のポーズ) を指すことがある。そのため `poses` は配列の最後まで持ち、pose の入力欄は `poses.length - 1` まで、サムネイル一覧は自分の `poseCount` 個だけ出す。詳細の表には `poses` を `poseCount (+残り after this entry)` と出し、poseCount 以上のポーズを選ぶと「後ろのエントリのポーズ」と付ける。
- 各ポーズの plttID も ROM にあるが、描画には使われない (最初のポーズの値だけが使われる)。詳細の表に `pose plttID` として出すだけ。
- pw/ph/px/py は画面外判定の矩形にしか使われない (`AuxSprite_DrawListScreen` など)。表示位置には影響しないので詳細の表に出すだけ。
- ASGFLAG_BPP8 は見ていない (4bpp として描く)。
- AuxSprite.plttOffset (ゲームで plttID に足される) は扱わない。plttID の入力欄で代わりに変えられる。

### 根拠

- `include/sprite_aux.h`: AuxSpriteFile, AuxSpriteEntry, AuxSpritePose, AuxSubsprite, AuxSpriteGfx, AuxSprite。
- `src/main.c` `AgbMain`: `LoadAuxSpriteFile(GetFile(DIR_AUX_SPRITE, 0xFF54))`。
- `src/video.c` `LoadAuxSpriteFile`: gAuxSubsprites, gAuxSpriteTiles を設定。`Video_GetAuxSprite`: entries を線形に探し、`poses + spritesOffset` (バイト加算) を gfx->poses に、最初のポーズの plttID を gfx->plttID にする。
- `asm/func/AuxSprite_DrawInternal.inc`:
  - ポーズは `gfx->poses + poseIdx * 12`、サブスプライトは `gAuxSubsprites + pose.subspriteOffset`。
  - タイルは `Video_AllocObjTiles(gAuxSpriteTiles + pose.tileOffset, pose.tileCount)` で連続した 1D のまま確保し、各 OBJ のタイル番号はそこに `gOAMTileCounts[shape]` を順に足した値。
  - パレットは `AllocBlendPlttSlot(gfx->plttID + p->plttOffset, gfx->pltt)` の 1 回だけ (ポーズの plttID は読まない)。
  - SPRFLAG_XFLIP/YFLIP で座標を `-x - w` にし、OAM の反転ビットはスプライトのフラグからだけ立てる。
- 重なり順は MainSprite と同じく `Video_BuildOAM` による (後のサブスプライトが手前)。
- `src/video.c` `AuxSprite_DrawListScreen`: pw/ph/px/py を画面外判定に使う。

### 未解明

- AuxSpriteFile.unk_00 / unk_08, AuxSpriteEntry.unk_03, AuxSubsprite.unk_01 (このゲームでは 0)。
- 本当のポーズ数 (エントリごと)。リポジトリの poseCount は次のエントリの先頭までとみなした推定値。
- U33J で同じファイル ID (0xFF54) と構造が使えるかは確認していない (コードは同じ定数で読む)。

## AuxAnim (アニメファイル)

AuxSprite と Particle が使うアニメ。1 ファイルに複数のアニメがあり、各アニメは variant (同じアニメの別バージョンのコマ列) を持てる。1 コマは u16 にポーズ番号・反転・フレーム数を詰めたもの。再生状態 AuxAnimState はスプライトの外にあり、毎フレーム AdvanceAnim でスプライトにポーズと反転を当てる。

### ROM 上の位置

- ディレクトリ `DIR_ANIMATION` (0x922E) の各ファイルが 1 つの AuxAnimFile。ファイル ID は `ANIM_*`。
- 圧縮はされていない (`AuxAnim_SetAnim` がファイルのポインタから直接読む)。

### 構造

AuxAnimFile

| オフセット | 型                      | 名前           | 意味                                        |
| ---------- | ----------------------- | -------------- | ------------------------------------------- |
| `0x00`     | u16                     | animationCount | アニメ数                                    |
| `0x02`     | u16                     | cmdCount       | ファイル全体のコマ数 (リポジトリでは未使用) |
| `0x04`     | AuxAnim[animationCount] | animations     | 4 バイトずつ                                |
| ...        | AuxAnimCmd[cmdCount]    | cmds           | コマ列                                      |

AuxAnim (4 バイト)

| オフセット | 型  | 名前                                   | 意味                                                                                |
| ---------- | --- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| `0x00`     | u8  | unk_0 (bit0-3) / variantCount (bit4-7) | 下位 4 ビットは常に 0。上位 4 ビットが variant 数。**バイト全体は variant 数 << 4** |
| `0x01`     | u8  | cmdCount                               | 1 variant のコマ数                                                                  |
| `0x02`     | u16 | cmdOffset                              | ファイル先頭から、このアニメの最初のコマまでのバイト数                              |

variant v のコマ列は `cmdOffset + v * cmdCount * 2` から cmdCount 個。variantCount が 0 でも variant 0 のコマは並んでいる。

AuxAnimCmd (u16)

| ビット | 名前     | 意味                                                        |
| ------ | -------- | ----------------------------------------------------------- |
| 0-3    | duration | 表示フレーム数 (等速のとき)                                 |
| 4      | xflip    | X 反転                                                      |
| 5      | yflip    | Y 反転                                                      |
| 6-15   | poseIdx  | AuxSprite ならポーズ番号、Particle ならグループ内のコマ番号 |

### パースの手順

`parseAuxAnimFiles` (`anim_aux.ts`) が `DIR_ANIMATION` の全ファイルを読む。

1. animationCount を `0x00` から読む。
2. アニメ i を `0x04 + i * 4` から読み、variantCount を `u8 >> 4`、cmdCount、cmdOffset を取る。
3. `max(1, variantCount)` 個の variant について、`cmdOffset + (v * cmdCount + j) * 2` からコマを読む。
4. 全コマの poseIdx の最大値を `maxPose` として持つ (スプライトのポーズ数との見比べ用)。

再生は `AuxAnimState` (`anim_aux.ts`)。状態は cmds, flags, cmdCount, duration, wait, cmdIdx, animIdx, speed (0x40 が等速), tick と、当てる側の poseIdx / xflip / yflip。

AuxAnimPlayFlags (再生フラグ): bit0 XFLIP, bit1 YFLIP, bit2 REVERSE。

- `setAnim` (`AuxAnim_SetAnim`): コマ列を variant から選び、speed を 0x40 にする。animIdx が違う・cmdCount が 0・REVERSE の有無が変わった、のどれかなら頭出し (cmdIdx を先頭か最後、`wait = duration = コマの duration`, tick = 0) して true。そうでなければ flags だけ更新して false。
- `restartAnim` (`AuxAnim_RestartAnim`): cmdCount を 0 にしてから setAnim (必ず頭出し)。
- `setAnimSpeed` (`AuxAnim_SetAnimSpeed`): speed が変わるときだけ `wait = ((speed * duration) >> 6) & 0xFF || 1`。
- `advance` (`AuxSprite_AdvanceAnim`): 今のコマの poseIdx をスプライトに当て、反転は「再生フラグの XFLIP/YFLIP != コマの xflip/yflip」(XOR)。tick を増やし、wait 以上ならコマを進める (REVERSE なら戻す)。端を越えたら反対の端に戻して true (一巡)。進めた後 `duration = 次のコマの duration`, `wait = ((duration * speed) >> 6) & 0xFF || 1`。
- `advanceParticle` (`Particle_AdvanceAnim`): ポーズの当て方 (`Particle_SetTile`) 以外で `AuxSprite_AdvanceAnim` と違うのは次の 2 点だけ。
  - 次のコマの wait を `((duration * speed) >> 6) & 0xFF` とし、0 を 1 に直さない (`wait || 1` が無い)。次のフレームで `tick (1) >= wait (0)` になるので、進み方は 1 と同じになる。
  - AuxAnimState.duration を更新しない。後で `AuxAnim_SetAnimSpeed` を呼ぶと、SetAnim したときのコマの duration で wait が計算される。

### 表示での扱い

- アニメのパネル `AuxAnimPanel` (`view_aux.tsx`) は AuxSprite タブと Particle タブで共通。`particle` が真なら `advanceParticle`、偽なら `advance` で進める。
- アニメファイルの一覧は 2 つに分ける: decomp のソースで一緒に使われているもの (`generated/aux_anims.ts` の `AUX_ANIM_REFS`, Particle は `generated/particle_refs.ts` の `PARTICLE_ANIM_REFS`) と、その他すべて。候補があれば開いたときに最初の候補を再生する。
- 各ファイルのラベルには maxPose を出し、`maxPose < poseCount` なら印なし、`maxPose < poses.length` (後ろのエントリのポーズまで使う) なら `+`、それ以上 (ポーズ配列からはみ出す) なら `!` を付ける。
- 「restart」は AuxAnimState を作り直してから setAnim する。速度は setAnim が 0x40 に戻すので、その後に setAnimSpeed で当て直す。
- variant が variantCount 以上のとき、ゲームは `cmds + variant * cmdCount` をそのまま読むが、`setAnim` は variant 0 に戻している。
- **組み合わせの表は UI 専用**。`tools/gen_tables.ts` が decomp のソースを正規表現で拾って作る:
  - `aux_anims.ts`: (1) 1 行に `SPRITE_*` と `ANIM_*` (または `ANM_*`) の定数が両方ある、(2) 同じ関数 (行頭が `}` の行で区切る) に `Video_GetAuxSprite(_, X)` と `GetFile(DIR_ANIMATION, Y)` が両方ある。MainSprite の ID が混ざることもある。
  - `particle_refs.ts`: 同じ関数に `GetParticleGroup(X)` と `GetFile(DIR_ANIMATION, Y)` / `Particle_SetPltt(_, Z)` がある。グループ名は `include/particle.h`、ポーズ名は `include/constants/particle.h` から。
  - 表は U32J rev1 のもの。`decomp()` (`decomp.ts`) は別の ROM では空の表を返す。
  - `sprite_aux.ts`, `anim_aux.ts`, `particle.ts` はこれらの表を import しない。

### 根拠

- `include/sprite_animation.h`: AuxAnim (bitfield `unk_0 : 4`, `variantCount : 4`), AuxAnimCmd のビット, AuxAnimFile, AuxAnimState, AuxAnimPlayFlags, `AuxAnimCmd_GetDuration`, `AuxAnimCmd_GetFlip`。
- `src/sprite_anim_aux.c`: `AuxAnim_SetAnim` (cmds = `file + cmdOffset + variant * cmdCount` 個分), `AuxAnim_RestartAnim`, `AuxAnim_SetAnimSpeed`。
- `include/sprite_aux.h` `AuxSprite_AdvanceAnim` (static inline), `include/particle.h` `Particle_AdvanceAnim` (static inline): 2 つの違いはこの 2 関数の比較による。
- variantCount が上位 4 ビットにあることは、全ファイルで `sum(cmdCount * max(1, variantCount))` が AuxAnimFile.cmdCount と一致することでも確かめてある (`anim_aux.ts` のコメント)。

### 未解明

- AuxAnim.unk_0 (下位 4 ビット, ROM では常に 0)。
- どのスプライトにどのアニメファイルを当てるかは ROM のデータからは分からない (ソースから拾った候補しかない)。

## Particle

小さなエフェクト用のスプライト。1 つの ParticleFile がタイルとグループ (このゲームでは 3 つ) を持つ。1 コマは OBJ 1 枚で、グループの shape がコマのサイズを決め、コマ番号からタイル番号を計算する。

### ROM 上の位置

- `DIR_PARTICLE` (0xCEAA) のファイル 0x3002。`AgbMain` (`src/main.c`) が `LoadParticleFile(GetFile(DIR_PARTICLE, 0x3002))` で読む。
- `LoadParticleFile` はタイルを OBJ VRAM の先頭 (タイル 0) に常駐させる。そのため OAM のタイル番号はファイル内のタイルの通し番号と同じ。
- グループ ID は `PTCL_GROUP_0` (0x1C1A), `PTCL_GROUP_1` (0x1C1C), `PTCL_GROUP_2` (0x1C1E)。

### 構造

ParticleFile

| オフセット | 型                        | 名前          | 意味                                 |
| ---------- | ------------------------- | ------------- | ------------------------------------ |
| `0x00`     | u32                       | unk_00        | 不明                                 |
| `0x04`     | u16                       | tileCount     | タイル枚数 (このゲームでは 317)      |
| `0x06`     | u16                       | groupCount    | グループ数 (このゲームでは 3)        |
| `0x08`     | u32                       | offsetToTiles | ファイル先頭からタイルまでのバイト数 |
| `0x0C`     | ParticleGroup[groupCount] | groups        | 8 バイトずつ                         |

ParticleGroup (8 バイト)

| オフセット | 型  | 名前   | 意味                                     |
| ---------- | --- | ------ | ---------------------------------------- |
| `0x00`     | u16 | id     | グループ ID (`GetParticleGroup` で探す)  |
| `0x02`     | u8  | flags  | bit4 = PGFLAG_BPP8 (8bpp)                |
| `0x03`     | u8  | shape  | SpriteShape。1 コマのサイズ              |
| `0x04`     | u16 | tile   | このグループの先頭タイル番号             |
| `0x06`     | u16 | plttID | `Particle_Add` が当てる OBJ パレット番号 |

コマ番号 poseIdx のタイル番号は `poseIdx * (w/8 * h/8) + tile`。

### パースの手順

`parseParticleFiles` (`particle.ts`) が `DIR_PARTICLE` の全ファイル (このゲームでは 0x3002 の 1 つ) を読む。

1. tileCount, groupCount を読み、グループを `0x0C + i * 8` から読む。
2. グループごとに、ROM には無い 2 つの値を計算する:
   - `poseCount` = 次に大きいグループの tile (なければ tileCount) までに入るコマ数。
   - `poseLimit` = ファイルの最後 (tileCount) までに入るコマ数。
   - どちらも `floor(タイル数 / tilesPerPose)`。`tilesPerPose` は shape の `w/8 * h/8`。
3. タイルは `offsetToTiles` から `tileCount * 32` バイトを subarray で持つ。

`particlePoseObjs` (`particle.ts`) がコマを OBJ 1 枚にする: 原点は OBJ の左上 (x = y = 0)、`tileNum = poseIdx * tilesPerPose + tile`、`tileStride = w / 8`、反転は引数のまま。

### 表示での扱い

- Particle タブ (`view_particle.tsx`) は全ファイルの全グループを一覧にする。名前と説明は `PARTICLE_GROUP_NAMES`、コマの名前は `PARTICLE_POSE_NAMES` (`generated/particle_refs.ts`)。
- pose の入力欄は `poseLimit - 1` まで、サムネイル一覧は `poseCount` 個。poseCount 以上を選ぶと「後ろのグループのタイル」と付ける。ゲームはコマ番号の範囲を確かめないので、コマ番号は次のグループのタイルにも届きうる。poseLimit はファイルの外を読まないためのビューワの上限で、ゲームの制限ではない。
- パレットの既定値はグループの plttID。ソースで同じ関数の `Particle_SetPltt` に渡されている plttID (`PARTICLE_PLTT_REFS`) をボタンで選べる。
- 原点は `Particle_Add` と同じ offset 0 (左上)。`Particle_Setup` は offset (-8, -8) にするが、ビューワは扱わない。
- 8bpp (PGFLAG_BPP8) は扱わず 4bpp として描く。`particle.ts` のコメントでは、このゲームに 8bpp のグループは無いとしている。詳細の表には flags から 4bpp/8bpp を出す。
- アニメは AuxAnim の節の `AuxAnimPanel` を `particle` 付きで使う (`Particle_AdvanceAnim` と同じ進め方)。

### 根拠

- `include/particle.h`: ParticleFile, ParticleGroup, PGFLAG_BPP8, `PTCL_GROUP_*`, `Particle_SetTile`, `Particle_AdvanceAnim`。
- `src/main.c` `AgbMain`: `LoadParticleFile(GetFile(DIR_PARTICLE, 0x3002))`。
- `src/video.c` `LoadParticleFile`: タイルを `OBJ_VRAM0` へ DMA する。`GetParticleGroup`: groups を id で線形に探す。`Video_ResetObjTileAlloc`: 他の OBJ のタイルはパーティクルのタイルの後ろから確保する。
- `src/particle.c` `Particle_SetPose`: `gSpriteSizeTable[shape]` から w, h を取り、`tileNum = poseIdx * (w/8 * h/8) + g->tile`。`Particle_Add`: offset (0, 0), パレットは `AllocParticlePlttSlot(g->plttID, ...)`。`Particle_SetPltt`。`Particle_DrawList`: XFLIP/YFLIP を OAM の反転ビットにそのまま立てる。

### 未解明

- ParticleFile.unk_00。
- PTCL_GROUP_1 の名前 (decomp のコメントでは推測)。

## OBJ の描画 (render.ts)

3 種類のスプライトはどれも `Obj` (GBA の OBJ 1 枚分) の配列に分解され、`renderObjs` が 1 枚の `Pixels` (`render.ts`, RGBA の画像) に描く。ROM のデータを読む部分ではない。

### ROM 上の位置

該当なし (`render.ts` は ROM を読まない)。

### 構造

`OBJ_SIZE`: SpriteShape (`(size << 2) | shape`) → [w, h]。shape 3 (禁止) のキーは無い。

| SpriteShape | サイズ | SpriteShape | サイズ | SpriteShape | サイズ |
| ----------- | ------ | ----------- | ------ | ----------- | ------ |
| `0x00`      | 8×8    | `0x01`      | 16×8   | `0x02`      | 8×16   |
| `0x04`      | 16×16  | `0x05`      | 32×8   | `0x06`      | 8×32   |
| `0x08`      | 32×32  | `0x09`      | 32×16  | `0x0A`      | 16×32  |
| `0x0C`      | 64×64  | `0x0D`      | 64×32  | `0x0E`      | 32×64  |

`Obj` (4bpp の OBJ 1 枚)

| 名前         | 型          | 意味                                |
| ------------ | ----------- | ----------------------------------- |
| x, y         | number      | 原点からの OBJ 左上の座標           |
| w, h         | number      | ピクセル単位のサイズ                |
| hflip, vflip | boolean     | OBJ の反転                          |
| tiles        | Uint8Array  | タイルデータ (4bpp, 32 バイト/枚)   |
| tileNum      | number      | tiles の何枚目から使うか            |
| tileStride   | number      | tiles 上で 1 行下のタイルまでの枚数 |
| pltt         | Uint32Array | RGBA8888 の 16 色。色 0 は透明扱い  |

`tileStride` の値

| 使う側                        | 値    | 理由                         |
| ----------------------------- | ----- | ---------------------------- |
| MainSprite (`poseToObjs`)     | 16    | タイルが横 16 枚の 2D シート |
| AuxSprite (`auxPoseToObjs`)   | w / 8 | 1D (OBJ ごとに詰めて並ぶ)    |
| Particle (`particlePoseObjs`) | w / 8 | 1D                           |

### パースの手順

`renderObjs(objs, bounds = objBounds(objs))` (`render.ts`)

1. `objBounds` で全 OBJ を囲む矩形を作る。原点 (0, 0) は必ず含める。
2. その大きさの `Pixels` を作り、`objs` の先頭から順に描く (後の OBJ が上書きする = 手前)。
3. 各ピクセルは、反転を考えた OBJ 内の座標 (sx, sy) から `tile = tileNum + (sy >> 3) * tileStride + (sx >> 3)` を求め、`tiles[tile * 32 + (sy & 7) * 4 + ((sx & 7) >> 1)]` の下位 4 ビット (sx が偶数) か上位 4 ビット (奇数) を色番号にする。
4. 色番号 0 は描かない。tiles の範囲外は飛ばす。
5. 戻り値 `Rendered` は画像と、画像上の原点の位置 (originX, originY)。`SpriteCanvas` (`components.tsx`) はこれで原点の十字を描く。

同じファイルにある `renderTileGrid` (タイルを順に並べて描く) と `GRAYSCALE_PLTT` は、タイルセットなど他のタブ用。

### 表示での扱い

- 重なり順はゲームに合わせ、配列の後ろほど手前にする。ゲームでは同じ優先度・同じ z のとき、後に積んだ OBJ の OAM 番号が若くなり手前に出るため (MainSprite の「根拠」の `Video_BuildOAM` を参照)。
- 描けるのは 1 スプライト分だけで、OAM の優先度 (attr2), z, affine (回転・拡大), モザイク, 半透明, 画面外判定は扱わない。
- 8bpp の OBJ は扱わない (4bpp だけ)。
- パレットは gObjPlttData の色をそのまま使う。ゲームは OBJ パレットをスロットに確保して使い (`AllocBlendPlttSlot`, `AllocParticlePlttSlot`)、確保時に明るさなどを掛けている可能性がある (推測, 関数名から)。ビューワはスロットを扱わない。パレットの読み方は [palette.md](palette.md)。
- パレット番号が範囲外のときは 16 階調のグレースケールで描く (`sprite_main.ts`, `sprite_aux.ts` の `FALLBACK_PLTT`)。
- サムネイル (`PoseGrid`) は長辺 64px に収まるよう縮める。

### 根拠

- `include/sprite_common.h`: SpriteShape は `(OAM1.14-15 << 2) | OAM0.14-15`。
- `src/video_reg.c`: `gSpriteSizeTable` (SpriteShape → サイズ), `Video_CreateSpriteLUT` (幅・高さ・タイル数の表)。
- `asm/func/Video_BuildOAM.inc`: gStagedOAMBuffer を z ごとに後入れ先出しのリストにしてから、優先度ごとに gOAMBuffer へ並べる。

### 未解明

特になし

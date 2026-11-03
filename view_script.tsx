// スクリプト (gScriptDirectory) のタブ, バイトコードを bokcc で .bokc にして表示する
// 選んでいるスクリプトは URL の #script/0xXXXX に入れておく (ほかのタブからリンクできるように)

import { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { decodeScript, type ScriptEntry } from "./script.ts";
import { scriptCallers, scriptDirectory } from "./analysis.ts";
import { type PrintContext, scriptName } from "./bokcc/instruction.ts";
import { SCRIPT_NAMES, STRING_NAMES } from "./names.ts";
import { decomp, hasDecompTables } from "./decomp.ts";
import { hashID, hex4, useHashID } from "./components.tsx";

// 名前表は U32J rev1 のときだけ使う (decomp.ts), ROM を読み込むたびに作り直す
const printContext = (): PrintContext => ({
  scriptNames: new Map(Object.entries(decomp(SCRIPT_NAMES)).map(([id, [name]]) => [Number(id), name])),
  stringNames: new Map(Object.entries(decomp(STRING_NAMES)).map(([id, [name]]) => [Number(id), name])),
});
const scriptIdByName = () => new Map(Object.entries(decomp(SCRIPT_NAMES)).map(([id, [name]]) => [name, Number(id)]));

// 開いている作品が変わったときだけ作り直す
let cached: { enabled: boolean; ctx: PrintContext; idByName: Map<string, number> } | undefined;
const names = () => {
  if (cached?.enabled !== hasDecompTables()) cached = { enabled: hasDecompTables(), ctx: printContext(), idByName: scriptIdByName() };
  return cached;
};

export const scriptHref = (id: number) => `#script/${hex4(id)}`;

export const ScriptViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const dir = scriptDirectory(rom);
  const [selected, setSelected] = useState(hashID("script") ?? 1);
  const [filter, setFilter] = useState("");
  useHashID("script", setSelected);

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return dir.scripts;
    return dir.scripts.filter((s) => scriptName(s.id, names().ctx).toLowerCase().includes(f) || hex4(s.id).toLowerCase().includes(f));
  }, [dir, filter]);

  const script = dir.scripts[selected - 1];

  return (
    <div class="viewer">
      <div>
        <input type="search" placeholder="filter (ID / name)" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
        <ul class="sprite-list">
          {list.map((s) => (
            <li key={s.id} class={s.id === selected ? "selected" : ""}>
              <a href={scriptHref(s.id)}>{scriptName(s.id, names().ctx)}</a>
            </li>
          ))}
        </ul>
      </div>
      {script && <ScriptView key={script.id} rom={rom} script={script} />}
    </div>
  );
};

const ScriptView: FunctionComponent<{ rom: ROMFile; script: ScriptEntry }> = ({ rom, script }) => {
  const dir = scriptDirectory(rom);
  const callers = scriptCallers(rom).get(script.id) ?? [];
  const aliases = dir.scripts.filter((s) => s.offset === script.offset && s.id !== script.id);
  const text = useMemo(() => {
    try {
      return decodeScript(rom.data, script).map((i, k) => (k === 0 ? `${scriptName(script.id, names().ctx)}() ` : "") + i.toString(names().ctx)).join("\n");
    } catch (e) {
      return `// decode error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [rom, script]);
  const desc = decomp(SCRIPT_NAMES)[script.id]?.[1];

  return (
    <div class="sprite-view">
      <h2>
        {scriptName(script.id, names().ctx)} {desc}
      </h2>
      <p>
        ID: {hex4(script.id)}, ROM: 0x{(script.offset + 0x08000000).toString(16).toUpperCase().padStart(8, "0")}, variables: {script.varCount}
      </p>
      {aliases.length > 0 && (
        <p>
          同じ実体: <ScriptLinks ids={aliases.map((s) => s.id)} />
        </p>
      )}
      <p>
        called by: {callers.length > 0 ? <ScriptLinks ids={callers} /> : "(定数で呼んでいるスクリプトは無し)"}
      </p>
      <pre class="bokc">
        <LinkedText text={text} />
      </pre>
    </div>
  );
};

const ScriptLinks: FunctionComponent<{ ids: number[] }> = ({ ids }) => (
  <>
    {ids.map((id, k) => (
      <span key={id}>
        {k > 0 && ", "}
        <a href={scriptHref(id)}>{scriptName(id, names().ctx)}</a>
      </span>
    ))}
  </>
);

// .bokc の中のスクリプト名をリンクにする
const LinkedText: FunctionComponent<{ text: string }> = ({ text }) => {
  const parts: (string | preact.JSX.Element)[] = [];
  let last = 0;
  for (const m of text.matchAll(/\bScript_\w+/g)) {
    const name = m[0];
    const id = /^Script_0x[0-9A-F]{4}$/.test(name) ? parseInt(name.slice(9), 16) : names().idByName.get(name);
    if (id === undefined) continue;
    parts.push(text.slice(last, m.index), <a href={scriptHref(id)}>{name}</a>);
    last = m.index! + name.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
};

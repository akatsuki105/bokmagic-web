// スクリプト (gScriptDirectory) のタブ, バイトコードを bokcc で .bokc にして表示する
// 選んでいるスクリプトは URL の #script/0xXXXX に入れておく (ほかのタブからリンクできるように)

import { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { ROMFile } from "./rom.ts";
import { decodeScript, type ScriptEntry } from "./script.ts";
import { scriptCallers, scriptDirectory } from "./analysis.ts";
import { type PrintContext, scriptName } from "./bokcc/instruction.ts";
import { SCRIPT_NAMES, STRING_NAMES } from "./names.ts";
import { hex4 } from "./components.tsx";

const PRINT_CONTEXT: PrintContext = {
  scriptNames: new Map(Object.entries(SCRIPT_NAMES).map(([id, [name]]) => [Number(id), name])),
  stringNames: new Map(Object.entries(STRING_NAMES).map(([id, [name]]) => [Number(id), name])),
};
const SCRIPT_ID_BY_NAME = new Map(Object.entries(SCRIPT_NAMES).map(([id, [name]]) => [name, Number(id)]));

export const scriptHref = (id: number) => `#script/${hex4(id)}`;

// #script/0xXXXX の 0xXXXX
const idFromHash = (): number | undefined => {
  const m = location.hash.match(/^#script\/(0x[0-9A-Fa-f]+)$/);
  return m ? parseInt(m[1], 16) : undefined;
};

export const ScriptViewer: FunctionComponent<{ rom: ROMFile }> = ({ rom }) => {
  const dir = scriptDirectory(rom);
  const [selected, setSelected] = useState(idFromHash() ?? 1);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const onHash = () => {
      const id = idFromHash();
      if (id !== undefined) setSelected(id);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return dir.scripts;
    return dir.scripts.filter((s) => scriptName(s.id, PRINT_CONTEXT).toLowerCase().includes(f) || hex4(s.id).toLowerCase().includes(f));
  }, [dir, filter]);

  const script = dir.scripts[selected - 1];

  return (
    <div class="viewer">
      <div>
        <input type="search" placeholder="filter (ID / name)" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
        <ul class="sprite-list">
          {list.map((s) => (
            <li key={s.id} class={s.id === selected ? "selected" : ""}>
              <a href={scriptHref(s.id)}>{scriptName(s.id, PRINT_CONTEXT)}</a>
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
      return decodeScript(rom.data, script).map((i, k) => (k === 0 ? `${scriptName(script.id, PRINT_CONTEXT)}() ` : "") + i.toString(PRINT_CONTEXT)).join("\n");
    } catch (e) {
      return `// decode error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [rom, script]);
  const desc = SCRIPT_NAMES[script.id]?.[1];

  return (
    <div class="sprite-view">
      <h2>
        {scriptName(script.id, PRINT_CONTEXT)} {desc}
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
        <a href={scriptHref(id)}>{scriptName(id, PRINT_CONTEXT)}</a>
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
    const id = /^Script_0x[0-9A-F]{4}$/.test(name) ? parseInt(name.slice(9), 16) : SCRIPT_ID_BY_NAME.get(name);
    if (id === undefined) continue;
    parts.push(text.slice(last, m.index), <a href={scriptHref(id)}>{name}</a>);
    last = m.index! + name.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
};

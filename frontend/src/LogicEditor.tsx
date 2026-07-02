/* Declarative gameplay logic editors.

   EdgeLogicEditor — the edge's logic tab: idle (ambient) / choice (player
   button) / auto (fires when its condition holds), plus condition clauses,
   effects and once. Strictly the thin layer from the design doc: variables,
   comparisons, set/add. Anything richer belongs in the compile instructions.

   VariablesPanel — the project's typed variable bag (shown in the Inspector
   when nothing is selected). */
import { api } from "./api";
import { dialog } from "./dialogs";
import type {
  Clause, ClauseOp, EdgeLogic, Effect, GEdge, GameVar, Graph, VarValue,
} from "./types";

const OPS: ClauseOp[] = ["==", "!=", ">", ">=", "<", "<="];

function varByName(vars: GameVar[], name: string): GameVar | undefined {
  return vars.find((v) => v.name === name);
}

/** number input or true/false select, matched to the variable's type. */
function ValueInput({
  vars, varName, value, onChange,
}: {
  vars: GameVar[];
  varName: string;
  value: VarValue;
  onChange: (v: VarValue) => void;
}) {
  const isBool = varByName(vars, varName)?.type === "bool";
  if (isBool) {
    return (
      <select value={String(value === true)} onChange={(e) => onChange(e.target.value === "true")}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      type="number"
      value={typeof value === "number" ? value : 0}
      onChange={(e) => onChange(+e.target.value)}
    />
  );
}

export function EdgeLogicEditor({
  edge, vars, refresh,
}: {
  edge: GEdge;
  vars: GameVar[];
  refresh: () => Promise<void>;
}) {
  const logic = (edge.params?.logic ?? {}) as EdgeLogic;
  const type = logic.type ?? "idle";
  const condition = logic.condition ?? [];
  const effects = logic.effects ?? [];

  const save = (patch: Partial<EdgeLogic>) =>
    api
      .updateEdge(edge.id, {
        params: { ...edge.params, logic: { ...logic, type, ...patch } },
      } as Partial<GEdge>)
      .then(refresh);

  const defaultVar = vars[0]?.name ?? "";
  const noVars = vars.length === 0;

  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="muted">type — how the player runtime treats this edge</label>
      <select value={type} onChange={(e) => save({ type: e.target.value as EdgeLogic["type"] })}>
        <option value="idle">idle — ambient, weighted-random</option>
        <option value="choice">choice — player button</option>
        <option value="auto">auto — fires when condition holds</option>
      </select>

      {type === "choice" && (
        <>
          <label className="muted">button label</label>
          <input
            value={logic.trigger ?? ""}
            placeholder={edge.label || edge.kind}
            onChange={(e) => save({ trigger: e.target.value })}
          />
        </>
      )}
      {type === "idle" && (
        <>
          <label className="muted">weight — likelihood vs sibling idles ({logic.weight ?? 1})</label>
          <input
            type="range" min={0.1} max={5} step={0.1}
            value={logic.weight ?? 1}
            onChange={(e) => save({ weight: +e.target.value })}
          />
        </>
      )}

      <label className="muted" style={{ marginTop: 4 }}>
        condition — all must hold {noVars && "(declare variables first — deselect to edit them)"}
      </label>
      {condition.map((c, i) => (
        <div className="clauseRow" key={i}>
          <select
            value={c.var}
            onChange={(e) => {
              const next = [...condition];
              next[i] = { ...c, var: e.target.value };
              save({ condition: next });
            }}
          >
            {vars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          <select
            value={c.op}
            onChange={(e) => {
              const next = [...condition];
              next[i] = { ...c, op: e.target.value as ClauseOp };
              save({ condition: next });
            }}
          >
            {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <ValueInput
            vars={vars} varName={c.var} value={c.value}
            onChange={(v) => {
              const next = [...condition];
              next[i] = { ...c, value: v };
              save({ condition: next });
            }}
          />
          <button
            className="danger" style={{ flex: "0 0 auto" }}
            onClick={() => save({ condition: condition.filter((_, k) => k !== i) })}
          >✕</button>
        </div>
      ))}
      <button
        disabled={noVars}
        onClick={() => save({
          condition: [...condition, { var: defaultVar, op: ">=" as ClauseOp, value: 1 } as Clause],
        })}
      >+ condition</button>

      <label className="muted" style={{ marginTop: 4 }}>effects — applied when traversed</label>
      {effects.map((ef, i) => (
        <div className="clauseRow" key={i}>
          <select
            value={ef.op}
            onChange={(e) => {
              const next = [...effects];
              next[i] = { ...ef, op: e.target.value as Effect["op"] };
              save({ effects: next });
            }}
          >
            <option value="set">set</option>
            <option value="add">add</option>
          </select>
          <select
            value={ef.var}
            onChange={(e) => {
              const next = [...effects];
              next[i] = { ...ef, var: e.target.value };
              save({ effects: next });
            }}
          >
            {vars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          <ValueInput
            vars={vars} varName={ef.var} value={ef.value}
            onChange={(v) => {
              const next = [...effects];
              next[i] = { ...ef, value: v };
              save({ effects: next });
            }}
          />
          <button
            className="danger" style={{ flex: "0 0 auto" }}
            onClick={() => save({ effects: effects.filter((_, k) => k !== i) })}
          >✕</button>
        </div>
      ))}
      <button
        disabled={noVars}
        onClick={() => save({
          effects: [...effects, { op: "add", var: defaultVar, value: 1 } as Effect],
        })}
      >+ effect</button>

      <label className="row" style={{ marginTop: 4, gap: 6 }}>
        <input
          type="checkbox" style={{ width: "auto", flex: "0 0 auto" }}
          checked={!!logic.once}
          onChange={(e) => save({ once: e.target.checked })}
        />
        <span className="muted">once — traversable a single time per run</span>
      </label>
    </div>
  );
}

export function VariablesPanel({
  graph, refresh,
}: {
  graph: Graph;
  refresh: () => Promise<void>;
}) {
  const vars = (graph.project.meta?.variables as GameVar[] | undefined) ?? [];

  const save = (next: GameVar[]) =>
    api
      .updateProject(graph.project.id, { meta: { ...graph.project.meta, variables: next } })
      .then(refresh);

  const add = async () => {
    const name = await dialog.prompt({
      title: "New variable", label: "Name (used in conditions/effects)", placeholder: "depth",
    });
    if (!name) return;
    const clean = name.trim().replace(/\s+/g, "_");
    if (vars.some((v) => v.name === clean)) {
      dialog.toast("Variable already exists", "error");
      return;
    }
    await save([...vars, { name: clean, type: "number", default: 0 }]);
  };

  const update = (i: number, patch: Partial<GameVar>) => {
    const next = [...vars];
    next[i] = { ...next[i], ...patch };
    // keep the default's JS type in sync with the declared type
    if (patch.type === "bool") next[i].default = Boolean(next[i].default);
    if (patch.type === "number") next[i].default = Number(next[i].default) || 0;
    return save(next);
  };

  return (
    <>
      <div className="railHead" style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>Variables · {vars.length}</h2>
        <button className="iconBtn" onClick={add}>+ New</button>
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        The game state bag — conditions gate edges, effects change values. Shared by every scene.
      </p>
      {vars.map((v, i) => (
        <div className="clauseRow" key={v.name} style={{ marginTop: 4 }}>
          <span style={{ flex: 1, fontWeight: 600 }}>{v.name}</span>
          <select
            value={v.type}
            onChange={(e) => update(i, { type: e.target.value as GameVar["type"] })}
          >
            <option value="number">number</option>
            <option value="bool">bool</option>
          </select>
          {v.type === "bool" ? (
            <select
              value={String(v.default === true)}
              onChange={(e) => update(i, { default: e.target.value === "true" })}
            >
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          ) : (
            <input
              type="number"
              value={Number(v.default) || 0}
              onChange={(e) => update(i, { default: +e.target.value })}
            />
          )}
          <button
            className="danger" style={{ flex: "0 0 auto" }}
            onClick={() => save(vars.filter((_, k) => k !== i))}
          >✕</button>
        </div>
      ))}
    </>
  );
}

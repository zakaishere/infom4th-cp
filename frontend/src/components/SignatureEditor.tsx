import { TYPES, describe, type Signature } from "../lib/functionMode";

/** Edits a function problem's name, typed parameters and return type. */
export function SignatureEditor({ value, onChange, disabled }: { value: Signature; onChange: (s: Signature) => void; disabled?: boolean }) {
  const setParam = (i: number, change: Partial<Signature["params"][number]>) =>
    onChange({ ...value, params: value.params.map((p, j) => (i === j ? { ...p, ...change } : p)) });
  const typeSelect = (type: string, set: (type: string) => void) => (
    <select value={type} disabled={disabled} onChange={(e) => set(e.target.value)} style={{ width: "auto" }}>
      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
  return (
    <div className="card-flat stack">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <label className="small">Function name <input className="mono" value={value.functionName} disabled={disabled} style={{ width: 180 }}
          onChange={(e) => onChange({ ...value, functionName: e.target.value.trim() })} /></label>
        <label className="small">Returns {typeSelect(value.returnType, (returnType) => onChange({ ...value, returnType }))}</label>
      </div>
      {value.params.map((p, i) => (
        <div key={i} className="row">
          <span className="small muted" style={{ width: "5.5rem" }}>Parameter {i + 1}</span>
          <input className="mono" value={p.name} disabled={disabled} style={{ width: 160 }} placeholder="name" onChange={(e) => setParam(i, { name: e.target.value.trim() })} />
          {typeSelect(p.type, (type) => setParam(i, { type }))}
          {!disabled && value.params.length > 1 && <button type="button" className="ghost small" onClick={() => onChange({ ...value, params: value.params.filter((_, j) => j !== i) })}>Remove</button>}
        </div>
      ))}
      {!disabled && value.params.length < 10 && (
        <div><button type="button" className="small" onClick={() => onChange({ ...value, params: [...value.params, { name: "x" + (value.params.length + 1), type: "int" }] })}>+ Add parameter</button></div>
      )}
      <code className="small">{describe(value)}</code>
      <span className="small muted">
        Each test input has one line per parameter, written as JSON (<code>[2,7,11,15]</code>, <code>9</code>, <code>"abc"</code>, <code>true</code>).
        The expected output is the return value in JSON. Answers are compared as values: spacing does not matter and doubles may differ by 1e-5.
        Brainfuck cannot be offered on function problems.
      </span>
    </div>
  );
}

import type { ReactNode } from "react";

/** Numbered step header used by the problem and contest wizards. */
export function Steps({ steps, current, onSelect }: { steps: string[]; current: number; onSelect: (i: number) => void }) {
  return (
    <ol className="steps">
      {steps.map((label, i) => (
        <li key={label} className={i === current ? "active" : i < current ? "done" : ""}>
          <button type="button" onClick={() => onSelect(i)}><span className="step-number">{i < current ? "✓" : i + 1}</span>{label}</button>
        </li>
      ))}
    </ol>
  );
}

export function StepNav({ current, last, onBack, onNext, nextLabel = "Next", nextDisabled, children }: {
  current: number; last: number; onBack: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean; children?: ReactNode;
}) {
  return (
    <div className="row-between" style={{ marginTop: "1.25rem" }}>
      <button type="button" onClick={onBack} disabled={current === 0}>← Back</button>
      <div className="row">{children}{current < last && onNext && <button type="button" className="primary" onClick={onNext} disabled={nextDisabled}>{nextLabel} →</button>}</div>
    </div>
  );
}

export type LogLine = { text: string; state: "running" | "done" | "error" };

export function ProgressLog({ lines }: { lines: LogLine[] }) {
  if (!lines.length) return null;
  return (
    <ul className="progress-log">
      {lines.map((l, i) => <li key={i} className={l.state}><span>{l.state === "done" ? "✓" : l.state === "error" ? "✕" : "…"}</span>{l.text}</li>)}
    </ul>
  );
}

export function slugify(text: string) {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

/** Pairs uploaded test files by name: 01.in with 01.out / 01.ans / 01.a / 01.txt. */
export async function pairTestFiles(files: FileList) {
  const inputs = new Map<string, File>(), outputs = new Map<string, File>();
  for (const file of Array.from(files)) {
    const match = file.name.match(/^(.*)\.(in|input|out|ans|a|output|txt)$/i);
    if (!match) continue;
    (/^(in|input)$/i.test(match[2]) ? inputs : outputs).set(match[1], file);
  }
  const names = [...inputs.keys()].filter((n) => outputs.has(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return Promise.all(names.map(async (n) => ({ name: n, input: await inputs.get(n)!.text(), expected: await outputs.get(n)!.text() })));
}

/** Parses pasted tests: cases separated by a line of ===, input and output separated by a line of ---. */
export function parsePastedTests(text: string) {
  return text.split(/^\s*===+\s*$/m).map((block) => block.split(/^\s*---+\s*$/m)).filter((p) => p.length === 2 && (p[0].trim() || p[1].trim()))
    .map(([input, expected]) => ({ input: input.replace(/^\n/, ""), expected: expected.replace(/^\n/, "") }));
}

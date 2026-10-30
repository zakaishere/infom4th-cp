import { useRef, useState, type ReactNode } from "react";

type Tip = { x: number; y: number; text: ReactNode } | null;

/** Hover text placed inside a position:relative chart, kept away from the edge it would overflow. */
function TipBox({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return <div className="chart-tip" style={{ left: tip.x + "%", top: tip.y + "%", transform: `translate(${tip.x > 65 ? "-100%" : "0"}, -120%)` }}>{tip.text}</div>;
}

function niceTicks(low: number, high: number, count = 4, integer = false) {
  const span = Math.max(high - low, 1);
  const raw = span / count, power = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power;
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks: number[] = [];
  for (let t = Math.ceil(low / step) * step; t <= high + 1e-9; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return ticks;
}

export type LinePoint = { x: number; y: number; tip: ReactNode };

/** One series on one axis: a 2px line, an end dot with its value, and a crosshair on hover. */
export function LineChart({ points, xLabels, yLabel, invert, integer, markers, label }: {
  points: LinePoint[]; xLabels: [string, string]; yLabel?: (y: number) => string; invert?: boolean; integer?: boolean;
  markers?: { x: number; label: string; tip: string }[]; label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const W = 640, H = 220, L = 44, R = 44, T = markers ? 26 : 14, B = 24;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const pad = integer ? 0 : Math.max(20, (Math.max(...ys) - Math.min(...ys)) * 0.1);
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const px = (x: number) => (maxX === minX ? L + (W - L - R) / 2 : L + ((x - minX) / (maxX - minX)) * (W - L - R));
  const py = (y: number) => {
    const share = maxY === minY ? 0.5 : (y - minY) / (maxY - minY);
    return T + (invert ? share : 1 - share) * (H - T - B);
  };
  const format = yLabel ?? ((y: number) => y.toLocaleString());
  const ticks = niceTicks(minY, maxY, 4, integer);
  const last = points[points.length - 1];
  const hit = active === null ? null : points[active];
  return (
    <div className="chart" onMouseLeave={() => setActive(null)}>
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}
        onMouseMove={(e) => {
          const r = box.current!.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          points.forEach((p, i) => { if (Math.abs(px(p.x) - x) < Math.abs(px(points[best].x) - x)) best = i; });
          setActive(best);
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} className="chart-grid" />
            <text x={L - 8} y={py(t) + 4} textAnchor="end" className="chart-axis">{format(t)}</text>
          </g>
        ))}
        <text x={L} y={H - 6} className="chart-axis">{xLabels[0]}</text>
        <text x={W - R} y={H - 6} textAnchor="end" className="chart-axis">{xLabels[1]}</text>
        {markers?.map((m) => (
          <g key={m.label + m.x}>
            <line x1={px(m.x)} x2={px(m.x)} y1={T} y2={H - B} className="chart-grid" />
            <text x={px(m.x)} y={T - 8} textAnchor="middle" className="chart-marker"><title>{m.tip}</title>{m.label}</text>
          </g>
        ))}
        {points.length > 1 && <polyline className="chart-line" points={points.map((p) => px(p.x) + "," + py(p.y)).join(" ")} />}
        {hit && <line x1={px(hit.x)} x2={px(hit.x)} y1={T} y2={H - B} className="chart-cross" />}
        {hit && <circle cx={px(hit.x)} cy={py(hit.y)} r="5" className="chart-dot" />}
        <circle cx={px(last.x)} cy={py(last.y)} r="5" className="chart-dot" />
        <text x={px(last.x) + 9} y={py(last.y) + 4} className="chart-end">{format(last.y)}</text>
      </svg>
      {hit && <TipBox tip={{ x: (px(hit.x) / W) * 100, y: (py(hit.y) / H) * 100, text: hit.tip }} />}
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A year of submissions per day, Monday at the top, in one hue from faint to full. */
export function Heatmap({ activity, today }: { activity: { date: string; count: number }[]; today: string }) {
  const [tip, setTip] = useState<Tip>(null);
  const counts = new Map(activity.map((a) => [a.date, a.count]));
  const end = new Date(today + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 52 * 7 - ((end.getUTCDay() + 6) % 7));
  const CELL = 11, GAP = 2, LEFT = 26, TOP = 16, step = CELL + GAP;
  const cells: { date: string; count: number; column: number; row: number }[] = [];
  const months: { column: number; label: string }[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const index = cells.length, column = Math.floor(index / 7), row = index % 7;
    cells.push({ date: iso(d), count: counts.get(iso(d)) ?? 0, column, row });
    if (d.getUTCDate() === 1 && column < 52) months.push({ column, label: MONTHS[d.getUTCMonth()] });
  }
  const columns = Math.ceil(cells.length / 7);
  const W = LEFT + columns * step, H = TOP + 7 * step;
  const level = (n: number) => (n === 0 ? 0 : n < 2 ? 1 : n < 4 ? 2 : n < 8 ? 3 : 4);
  return (
    <div className="chart heatmap-scroll" onMouseLeave={() => setTip(null)}>
      <div className="chart" style={{ minWidth: 620 }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Activity over the last year: ${activity.reduce((s, a) => s + a.count, 0)} submissions`}>
          {months.map((m) => <text key={m.column} x={LEFT + m.column * step} y={10} className="chart-axis small-axis">{m.label}</text>)}
          {["Mon", "Wed", "Fri"].map((d, i) => <text key={d} x={0} y={TOP + (i * 2 + 1) * step - 3} className="chart-axis small-axis">{d}</text>)}
          {cells.map((c) => (
            <rect key={c.date} x={LEFT + c.column * step} y={TOP + c.row * step} width={CELL} height={CELL} rx="2" className={"heat-" + level(c.count)}
              onMouseEnter={() => setTip({ x: ((LEFT + c.column * step + CELL / 2) / W) * 100, y: ((TOP + c.row * step) / H) * 100, text: <>{c.count} submission{c.count === 1 ? "" : "s"} · {c.date}</> })} />
          ))}
        </svg>
        <TipBox tip={tip} />
      </div>
    </div>
  );
}

/** Solved share of each practice tag. The list below it carries the exact numbers. */
export function SkillRadar({ skills }: { skills: { tag: string; solved: number; total: number }[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const C = 130, R = 88, size = 300, n = skills.length;
  const at = (i: number, share: number): [number, number] => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [size / 2 + Math.cos(angle) * R * share, C + Math.sin(angle) * R * share];
  };
  const share = (s: { solved: number; total: number }) => (s.total ? s.solved / s.total : 0);
  return (
    <div className="chart radar" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${size} 260`} role="img" aria-label={"Problems solved per tag: " + skills.map((s) => `${s.tag} ${s.solved} of ${s.total}`).join(", ")}>
        {[0.25, 0.5, 0.75, 1].map((r) => <polygon key={r} className="chart-grid-area" points={skills.map((_, i) => at(i, r).join(",")).join(" ")} />)}
        {skills.map((s, i) => {
          const [x, y] = at(i, 1), [lx, ly] = at(i, 1.16);
          return (
            <g key={s.tag}>
              <line x1={size / 2} y1={C} x2={x} y2={y} className="chart-grid" />
              <text x={lx} y={ly + 4} textAnchor={lx < size / 2 - 5 ? "end" : lx > size / 2 + 5 ? "start" : "middle"} className="chart-axis">{s.tag}</text>
            </g>
          );
        })}
        <polygon className="radar-area" points={skills.map((s, i) => at(i, Math.max(share(s), 0.02)).join(",")).join(" ")} />
        {skills.map((s, i) => {
          const [x, y] = at(i, Math.max(share(s), 0.02));
          return (
            <g key={s.tag} onMouseEnter={() => setTip({ x: (x / size) * 100, y: (y / 260) * 100, text: <>{s.tag}: {s.solved} of {s.total} solved</> })}>
              <circle cx={x} cy={y} r="12" fill="transparent" />
              <circle cx={x} cy={y} r="4" className="chart-dot" />
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

/** Label, thin bar and value on one row, for counts that are read and compared. */
export function BarList({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bar-list">
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <span className="small">{r.label}</span>
          <div className="bar-track"><div style={{ width: (r.value / max) * 100 + "%" }} /></div>
          <span className="small mono">{r.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

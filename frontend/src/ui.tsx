import { useEffect, useMemo, useState, type ReactNode } from "react";
import { serverNow } from "./api";

export const VERDICTS: Record<string, { label: string; short: string; tone: string }> = {
  ACCEPTED: { label: "Accepted", short: "AC", tone: "ok" },
  WRONG_ANSWER: { label: "Wrong answer", short: "WA", tone: "bad" },
  TIME_LIMIT_EXCEEDED: { label: "Time limit exceeded", short: "TLE", tone: "bad" },
  MEMORY_LIMIT_EXCEEDED: { label: "Memory limit exceeded", short: "MLE", tone: "bad" },
  RUNTIME_ERROR: { label: "Runtime error", short: "RE", tone: "bad" },
  COMPILATION_ERROR: { label: "Compilation error", short: "CE", tone: "warn" },
  OUTPUT_LIMIT_EXCEEDED: { label: "Output limit exceeded", short: "OLE", tone: "bad" },
  JUDGE_ERROR: { label: "Judge error", short: "JE", tone: "neutral" },
};

export const LANGUAGE_NAMES: Record<string, string> = {
  CPP: "C++17", CPP20: "C++20", C: "C17", JAVA: "Java 17", PYTHON: "Python 3", PYPY: "PyPy 3", JAVASCRIPT: "JavaScript (Node)",
  GO: "Go", RUST: "Rust", KOTLIN: "Kotlin", CSHARP: "C# (Mono)", RUBY: "Ruby 3", PHP: "PHP 8", ZIG: "Zig 0.13", BRAINFUCK: "Brainfuck",
};
/** Every language the judge can be configured to run, in display order. */
export const ALL_LANGUAGES = ["CPP", "CPP20", "C", "JAVA", "PYTHON", "PYPY", "JAVASCRIPT", "GO", "RUST", "KOTLIN", "CSHARP", "RUBY", "PHP", "ZIG", "BRAINFUCK"];

/** Shows the judging state of a submission: queued, running, or the final verdict. */
export function Verdict({ status, verdict }: { status?: string | null; verdict?: string | null }) {
  if (verdict && VERDICTS[verdict]) {
    const v = VERDICTS[verdict];
    return <span className={"badge " + v.tone} title={v.label}>{v.label}</span>;
  }
  if (status === "RUNNING") return <span className="badge info">Judging…</span>;
  if (status === "FAILED") return <span className="badge neutral" title="Infrastructure failure; no penalty">Judge error</span>;
  if (status === "QUEUED" || status === "RETRY") return <span className="badge neutral">In queue</span>;
  return <span className="badge neutral">Pending</span>;
}

/** Links a handle to its profile. The click stops here, so a clickable table row around it does not also fire. */
export function UserLink({ handle, children, className, title }: { handle: string; children?: ReactNode; className?: string; title?: string }) {
  return (
    <a href={"#/u/" + encodeURIComponent(handle)} className={"user-link" + (className ? " " + className : "")} title={title} onClick={(e) => e.stopPropagation()}>
      {children ?? "@" + handle}
    </a>
  );
}

/** A comma separated list of handles, such as a team's members, each linking to its profile. */
export function UserList({ handles }: { handles?: string | null }) {
  if (!handles) return null;
  const list = handles.split(",").map((h) => h.trim()).filter(Boolean);
  return <>{list.map((h, i) => <span key={h}>{i > 0 && ", "}<UserLink handle={h}>{h}</UserLink></span>)}</>;
}

export function Badge({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={"badge " + tone}>{children}</span>;
}

export function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (total >= 86400 ? Math.floor(total / 86400) + "d " : "") + pad(h % 24) + ":" + pad(m) + ":" + pad(s);
}

/** Compact remaining time for small rings/chips (e.g. "5d 12h" or "01:29"). */
export function shortClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total >= 86400) {
    const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600);
    return `${d}d ${h}h`;
  }
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}`;
}

/** Human-readable contest duration from seconds (minutes up to multi-day). */
export function formatDuration(seconds: number) {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  const d = Math.floor(totalMin / 1440);
  const remMin = totalMin % 1440;
  const h = Math.floor(remMin / 60);
  const m = remMin % 60;
  if (d > 0) {
    const parts = [`${d}d`];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    return parts.length === 1 ? `${d} day${d === 1 ? "" : "s"}` : parts.join(" ");
  }
  if (h > 0) return m > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
  return `${m} min`;
}

export const CONTEST_FORMAT_LABEL: Record<string, string> = {
  STANDARD: "Normal",
  BASIC: "Basic",
  WARMUP: "Warmup",
};

/** Browser local IANA time zone so every input and display matches the user's wall clock while following serverNow(). */
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function when(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { timeZone: localTimeZone(), year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" });
}

/** Time of day in the user's local time zone. */
export function timeOf(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { timeZone: localTimeZone(), hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
}

/** Value for a datetime-local input, formatted in the user's local time zone from an epoch millisecond instant. */
export function toZoneInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Epoch milliseconds for a datetime-local value in the user's local time zone. Returns NaN when empty or invalid. */
export function fromZoneInput(value: string) {
  if (!value) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
}

export function ago(value?: string | null) {
  if (!value) return "never";
  const seconds = Math.round((serverNow() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.round(seconds / 60) + "m ago";
  return Math.round(seconds / 3600) + "h ago";
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="loading"><span className="spinner" aria-hidden />{label}</div>;
}

export function ErrorBox({ error }: { error?: { message: string } | null }) {
  if (!error) return null;
  return <div className="notice bad">{error.message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row-between" style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Privileged actions require a written reason that is stored in the audit log. */
export function ReasonDialog({ title, description, confirm = "Confirm", danger, onSubmit, onClose }: {
  title: string; description?: ReactNode; confirm?: string; danger?: boolean;
  onSubmit: (reason: string) => Promise<unknown> | void; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { await onSubmit(reason.trim()); } finally { setBusy(false); }
      }}>
        {description && <div>{description}</div>}
        <Field label="Reason (recorded in the audit log)">
          <textarea required autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </Field>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className={danger ? "danger" : "primary"} disabled={busy || !reason.trim()}>{confirm}</button>
        </div>
      </form>
    </Modal>
  );
}

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Small, escape-first Markdown subset for statements: headings, code, emphasis, lists, paragraphs. */
export function Markdown({ text }: { text?: string | null }) {
  const html = useMemo(() => {
    if (!text) return "";
    const blocks: string[] = [];
    const fenced = escape(text).replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => {
      blocks.push("<pre class=\"mono card-flat\">" + code + "</pre>");
      return "\u0000" + (blocks.length - 1) + "\u0000";
    });
    const inline = (s: string) => s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return fenced.split(/\n{2,}/).map((para) => {
      const block = para.match(/^\u0000(\d+)\u0000$/);
      if (block) return blocks[Number(block[1])];
      const heading = para.match(/^(#{1,4})\s+(.*)$/);
      if (heading) return "<h" + (heading[1].length + 1) + ">" + inline(heading[2]) + "</h" + (heading[1].length + 1) + ">";
      if (/^\s*[-*]\s+/.test(para)) return "<ul>" + para.split("\n").map((l) => "<li>" + inline(l.replace(/^\s*[-*]\s+/, "")) + "</li>").join("") + "</ul>";
      return "<p>" + inline(para).replace(/\n/g, "<br/>").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]) + "</p>";
    }).join("");
  }, [text]);
  return <div className="statement" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Syntax-highlighted code editor (CodeMirror). */
export { CodeEditor } from "./components/CodeEditor";

export const TEMPLATES: Record<string, string> = {
  CPP: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n",
  CPP20: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n",
  C: "#include <stdio.h>\n\nint main(void) {\n\n    return 0;\n}\n",
  JAVA: "import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));\n\n    }\n}\n",
  PYTHON: "import sys\n\ndef main():\n    data = sys.stdin.read().split()\n\nmain()\n",
  PYPY: "import sys\n\ndef main():\n    data = sys.stdin.read().split()\n\nmain()\n",
  JAVASCRIPT: "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/);\n\n",
  GO: "package main\n\nimport (\n    \"bufio\"\n    \"fmt\"\n    \"os\"\n)\n\nfunc main() {\n    in := bufio.NewReader(os.Stdin)\n    var n int\n    fmt.Fscan(in, &n)\n}\n",
  RUST: "use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    let mut it = input.split_whitespace();\n}\n",
  KOTLIN: "fun main() {\n    val n = readLine()!!.trim().toInt()\n}\n",
  CSHARP: "using System;\n\nclass Program {\n    static void Main() {\n        var line = Console.ReadLine();\n    }\n}\n",
  RUBY: "data = STDIN.read.split\n\n",
  PHP: "<?php\n$data = preg_split('/\\s+/', trim(stream_get_contents(STDIN)));\n\n",
  ZIG: "const std = @import(\"std\");\n\npub fn main() !void {\n    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);\n    const allocator = arena.allocator();\n    const input = try std.io.getStdIn().readToEndAlloc(allocator, 1 << 30);\n    var tokens = std.mem.tokenizeAny(u8, input, \" \\r\\n\\t\");\n    const stdout = std.io.getStdOut().writer();\n    _ = &tokens;\n    _ = stdout;\n}\n",
  // Comment text must avoid the eight command characters: + - < > [ ] , .
  BRAINFUCK: "Echo the input: cells are 8 bit and wrap and the end of input reads as zero\n,[.,]\n",
};

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className={"stat" + (tone ? " stat-" + tone : "")}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

export function Meter({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0;
  return <div className="meter" role="meter" aria-valuenow={value} aria-valuemax={max}><div className={value > max ? "over" : ""} style={{ width: pct + "%" }} /></div>;
}

/** Circular progress ring, e.g. elapsed contest time. */
export function Ring({ value, max, size = 88, children }: { value: number; max: number; size?: number; children?: ReactNode }) {
  const r = (size - 10) / 2, c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-value" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

/** Pulsing "live" indicator. */
export function LiveDot() {
  return <span className="live-dot" aria-hidden />;
}

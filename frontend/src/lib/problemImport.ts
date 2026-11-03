export const BANK_FORMAT = "infom4th.problem-bank";
export const MAX_BANK_BYTES = 64 * 1024 * 1024;
export type ImportMode = "draft" | "validate" | "approve" | "publish" | "duel";
export type BankProblem = {
  slug: string; title: string; statement: string; inputFormat: string; outputFormat: string;
  constraints: string; explanation: string; setterNotes: string; difficulty: string; checker: string;
  timeLimitMs: number; memoryLimitMb: number; outputLimitKb: number; languages: string[];
  tests: { input: string; expected: string; sample: boolean }[];
  reference: { label: string; language: string; sourceCode: string };
  /** A function problem's signature (see lib/functionMode.ts); the server checks it and the tests. */
  functionSignature?: ObjectValue;
};
type ObjectValue = Record<string, unknown>;
const bytes = (text: string) => new TextEncoder().encode(text).length;

/** Read the actual file, including gzip and UTF-8 BOMs, with a decompressed-size bound. */
export async function readProblemBankFile(file: Blob): Promise<BankProblem[]> {
  if (file.size > MAX_BANK_BYTES) throw new Error("Choose a bank smaller than 64 MiB");
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const compressed = signature[0] === 0x1f && signature[1] === 0x8b;
  let stream = file.stream();
  if (compressed) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read gzip files. Use the .json file or a browser that supports gzip import");
    stream = stream.pipeThrough(new DecompressionStream("gzip"));
  }
  const reader = stream.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let content = "", total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BANK_BYTES) {
        await reader.cancel();
        throw new Error("The uncompressed bank exceeds 64 MiB");
      }
      content += decoder.decode(chunk.value, { stream: true });
    }
    content += decoder.decode();
  } catch (error) {
    if (total > MAX_BANK_BYTES) throw error;
    throw new Error(compressed ? "Could not read this compressed bank. It may be incomplete or damaged; use a fresh .json.gz download" : "This file is not UTF-8 text. Save the original JSON file as UTF-8 and try again");
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(content.replace(/^\uFEFF/, "")); }
  catch { throw new Error("This is not a complete JSON bank. Select the original .json or .json.gz file rather than copying its preview"); }
  return parseProblemBank(value);
}

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as ObjectValue;
}
function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error("Invalid " + field);
  return value;
}
function number(value: unknown, field: string, fallback: number, min: number, max: number) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new Error("Invalid " + field);
  return n;
}

/** Fully checks the bank before the first write. Whitespace inside tests and code is preserved. */
export function parseProblemBank(value: unknown): BankProblem[] {
  const bank = object(value);
  if (bank.format !== BANK_FORMAT || bank.version !== 1) throw new Error("Choose an InfoM4th problem bank (format version 1)");
  if (!Array.isArray(bank.problems) || bank.problems.length < 1 || bank.problems.length > 100) throw new Error("A bank must contain 1–100 problems");
  const slugs = new Set<string>();
  return bank.problems.map((raw, index) => {
    try {
      const p = object(raw), slug = text(p.slug, "slug", 120, true);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("Invalid slug");
      if (slugs.has(slug)) throw new Error("Duplicate slug in bank: " + slug);
      slugs.add(slug);
      const difficulty = p.difficulty ?? "MEDIUM", checker = p.checker ?? "TOKENS";
      if (typeof difficulty !== "string" || !["EASY", "MEDIUM", "HARD"].includes(difficulty)) throw new Error("Invalid difficulty");
      if (typeof checker !== "string" || !["TOKENS", "EXACT", "TRIMMED_LINES"].includes(checker)) throw new Error("Invalid output comparison");
      if (!Array.isArray(p.languages) || p.languages.length < 1 || p.languages.length > 16 || p.languages.some(l => typeof l !== "string" || !/^[A-Z][A-Z0-9_]{0,23}$/.test(l))) throw new Error("Invalid languages");
      const languages = [...new Set(p.languages as string[])];
      const outputLimitKb = number(p.outputLimitKb, "output limit", 1024, 1, 65536);
      if (!Array.isArray(p.tests) || p.tests.length < 2 || p.tests.length > 200) throw new Error("Supply 2–200 tests, including samples and hidden tests");
      let suiteBytes = 0;
      const tests = p.tests.map(rawTest => {
        const t = object(rawTest);
        if (typeof t.input !== "string" || typeof t.expected !== "string" || typeof t.sample !== "boolean") throw new Error("Each test needs input text, expected output text, and a sample flag");
        suiteBytes += bytes(t.input) + bytes(t.expected);
        if (bytes(t.expected) > outputLimitKb * 1024) throw new Error("Expected output exceeds the problem output limit");
        return { input: t.input, expected: t.expected, sample: t.sample };
      });
      if (suiteBytes > 16 * 1024 * 1024) throw new Error("Test suite exceeds 16 MiB");
      if (!tests.some(t => t.sample) || !tests.some(t => !t.sample)) throw new Error("Both sample and hidden tests are required");
      const r = object(p.reference), language = text(r.language, "reference language", 24, true);
      if (!languages.includes(language)) throw new Error("Reference language is not in the allowed languages");
      const result: BankProblem = {
        slug, title: text(p.title, "title", 255, true), statement: text(p.statement, "statement", 262144, true),
        inputFormat: text(p.inputFormat, "input format", 262144), outputFormat: text(p.outputFormat, "output format", 262144),
        constraints: text(p.constraints, "constraints", 262144), explanation: text(p.explanation, "public explanation", 262144),
        setterNotes: text(p.setterNotes, "private setter notes", 262144), difficulty, checker, languages,
        timeLimitMs: number(p.timeLimitMs, "time limit", 2000, 1, 60000),
        memoryLimitMb: number(p.memoryLimitMb, "memory limit", 256, 16, 4096), outputLimitKb, tests,
        reference: { label: r.label === undefined ? "Main solution" : text(r.label, "reference label", 100, true), language, sourceCode: text(r.sourceCode, "reference source", 262144, true) },
      };
      if (p.functionSignature != null) result.functionSignature = object(p.functionSignature);
      if (bytes(JSON.stringify(result)) > 20 * 1024 * 1024) throw new Error("Problem request exceeds 20 MiB");
      return result;
    } catch (error) { throw new Error(`Problem ${index + 1}: ${error instanceof Error ? error.message : "Invalid data"}`); }
  });
}

type Status = { status: string; validation_status: string | null };
export type ImportUpdate = { message: string; versionId?: string };
export type ImportTransport = {
  importProblem: (problem: BankProblem) => Promise<{ outcome: "IMPORTED" | "SKIPPED"; versionId: string }>;
  status: (id: string) => Promise<Status>;
  action: (id: string, action: string, body?: unknown) => Promise<unknown>;
  wait: () => Promise<void>;
};

/** Sequential use keeps judge load bounded. Retrying an owned in-page attempt resumes its saved version. */
export async function importProblem(
  problem: BankProblem, mode: ImportMode, transport: ImportTransport,
  update: (value: ImportUpdate) => void, stopped: () => boolean, previousVersion?: string, maxPolls = 900,
): Promise<"done" | "skipped"> {
  const check = () => { if (stopped()) throw new Error("Stopped; the saved version can be continued with Retry"); };
  check();
  let id = previousVersion;
  if (!id) {
    update({ message: "Importing statement, tests and reference" });
    const result = await transport.importProblem(problem);
    id = result.versionId;
    if (result.outcome === "SKIPPED") { update({ message: "Skipped: this slug already exists", versionId: id }); return "skipped"; }
  }
  update({ message: "Draft saved", versionId: id });
  check();
  if (mode === "draft") return "done";
  let current = await transport.status(id);
  check();
  if (current.status === "DRAFT") {
    await transport.action(id, "validate");
    current = { status: "IN_TESTING", validation_status: "PENDING" };
  }
  let polls = 0;
  while (current.status === "IN_TESTING") {
    check();
    if (["FAILED", "JUDGE_ERROR"].includes(current.validation_status ?? "")) throw new Error("Validation failed; open the problem for its report");
    if (polls++ >= maxPolls) throw new Error("Validation is still queued or running. Retry later to continue this version");
    update({ message: "Validating reference solution on every test", versionId: id });
    await transport.wait(); check(); current = await transport.status(id);
  }
  check();
  if (!["READY_FOR_REVIEW", "APPROVED", "PUBLISHED"].includes(current.status) || current.validation_status !== "PASSED") throw new Error("Validation did not pass; open the problem for its report");
  if (mode === "validate") { update({ message: "Validated; ready for review", versionId: id }); return "done"; }
  if (current.status === "READY_FOR_REVIEW") {
    update({ message: "Approving validated problem", versionId: id });
    await transport.action(id, "approve", { reason: "Bulk import: reference solution passed all sample and hidden tests in the sandbox" });
  }
  check();
  if (mode === "publish" && current.status !== "PUBLISHED") {
    update({ message: "Publishing to Practice", versionId: id });
    await transport.action(id, "publish-practice");
  }
  // A version can already be PUBLISHED through practice; adding it to the duel pool is idempotent.
  if (mode === "duel") {
    update({ message: "Adding to the duel problems", versionId: id });
    await transport.action(id, "publish-duel");
  }
  update({ message: mode === "publish" ? "Published to Practice" : mode === "duel" ? "Added to the duel problems" : "Approved; available for contests", versionId: id });
  return "done";
}

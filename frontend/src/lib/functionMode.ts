/**
 * Function problems (LeetCode style): contestants write one function; the judge generates the code
 * that reads the input and prints the result (judge/drivers.py, which uses the same conventions).
 * Each test input holds one JSON value per parameter line; the expected output holds one JSON value.
 */
export type Param = { name: string; type: string };
export type Signature = { functionName: string; params: Param[]; returnType: string };

export const BASES = ["int", "long", "double", "bool", "string"] as const;
type Base = (typeof BASES)[number];
export const TYPES = BASES.flatMap((b) => [b, b + "[]", b + "[][]"]);
/** Every language but Brainfuck, which has no functions. */
export const FUNCTION_LANGUAGES = ["CPP", "CPP20", "C", "JAVA", "PYTHON", "PYPY", "JAVASCRIPT", "GO", "RUST", "KOTLIN", "CSHARP", "RUBY", "PHP", "ZIG"];
export const EMPTY_SIGNATURE: Signature = { functionName: "twoSum", params: [{ name: "nums", type: "int[]" }, { name: "target", type: "int" }], returnType: "int[]" };

export function parseSignature(raw: string | null | undefined): Signature | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Signature; } catch { return null; }
}

function split(type: string): [Base, number] {
  const base = type.replace(/(\[\])+$/, "") as Base;
  return [base, (type.length - base.length) / 2];
}

/** twoSum -> two_sum, as Rust and Ruby name it (same rule as the judge and the backend). */
export const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** twoSum(nums: int[], target: int) → int[] */
export function describe(s: Signature) {
  return `${s.functionName}(${s.params.map((p) => `${p.name}: ${p.type}`).join(", ")}) → ${s.returnType}`;
}

const nest = (open: string, close: string, inner: string, dims: number) => open.repeat(dims) + inner + close.repeat(dims);
const CPP: Record<Base, string> = { int: "int", long: "long long", double: "double", bool: "bool", string: "string" };
const C: Record<Base, string> = { int: "int", long: "long long", double: "double", bool: "bool", string: "char*" };
const JAVA: Record<Base, string> = { int: "int", long: "long", double: "double", bool: "boolean", string: "String" };
const PY: Record<Base, string> = { int: "int", long: "int", double: "float", bool: "bool", string: "str" };
const JS: Record<Base, string> = { int: "number", long: "number", double: "number", bool: "boolean", string: "string" };
const GO: Record<Base, string> = { int: "int", long: "int64", double: "float64", bool: "bool", string: "string" };
const RUST: Record<Base, string> = { int: "i32", long: "i64", double: "f64", bool: "bool", string: "String" };
const KOTLIN: Record<Base, string> = { int: "Int", long: "Long", double: "Double", bool: "Boolean", string: "String" };
const CS: Record<Base, string> = { int: "int", long: "long", double: "double", bool: "bool", string: "string" };
const DOC: Record<Base, string> = { int: "Integer", long: "Integer", double: "Float", bool: "Boolean", string: "String" };
const ZIG: Record<Base, string> = { int: "i32", long: "i64", double: "f64", bool: "bool", string: "[]const u8" };

function kotlinType(base: Base, dims: number): string {
  if (dims === 0) return KOTLIN[base];
  if (dims === 1 && base !== "string") return KOTLIN[base] + "Array";
  return `Array<${kotlinType(base, dims - 1)}>`;
}

/** Starter code for one language: the function to complete, nothing else. */
export function starter(language: string, s: Signature): string {
  const ps = s.params.map((p) => ({ name: p.name, t: split(p.type) }));
  const [rb, rd] = split(s.returnType);
  const name = s.functionName;
  switch (language) {
    case "CPP": case "CPP20": {
      const arg = ({ name, t: [b, d] }: (typeof ps)[number]) => d ? `${nest("vector<", ">", CPP[b], d)}& ${name}` : `${CPP[b]} ${name}`;
      return `class Solution {\npublic:\n    ${nest("vector<", ">", CPP[rb], rd)} ${name}(${ps.map(arg).join(", ")}) {\n        \n    }\n};\n`;
    }
    case "C": {
      const args = ps.flatMap(({ name, t: [b, d] }) => d === 0 ? [`${C[b]} ${name}`]
        : d === 1 ? [`${C[b]}* ${name}`, `int ${name}Size`] : [`${C[b]}** ${name}`, `int ${name}Size`, `int* ${name}ColSize`]);
      if (rd >= 1) args.push("int* returnSize");
      if (rd === 2) args.push("int** returnColumnSizes");
      const note = rd === 0 ? "" : rd === 1
        ? "/**\n * Return an array allocated with malloc and set *returnSize to its length.\n */\n"
        : "/**\n * Return an array of arrays allocated with malloc; set *returnSize to the number of rows\n * and *returnColumnSizes to a malloc'ed array with each row's length.\n */\n";
      return `${note}${C[rb]}${"*".repeat(rd)} ${name}(${args.join(", ")}) {\n    \n}\n`;
    }
    case "JAVA":
      return `class Solution {\n    public ${JAVA[rb]}${"[]".repeat(rd)} ${name}(${ps.map(({ name, t: [b, d] }) => `${JAVA[b]}${"[]".repeat(d)} ${name}`).join(", ")}) {\n        \n    }\n}\n`;
    case "PYTHON": case "PYPY": {
      const py = (b: Base, d: number) => nest("list[", "]", PY[b], d);
      return `class Solution:\n    def ${name}(self, ${ps.map(({ name, t: [b, d] }) => `${name}: ${py(b, d)}`).join(", ")}) -> ${py(rb, rd)}:\n        pass\n`;
    }
    case "JAVASCRIPT": {
      const docs = ps.map(({ name, t: [b, d] }) => ` * @param {${JS[b]}${"[]".repeat(d)}} ${name}`);
      return `/**\n${docs.join("\n")}\n * @return {${JS[rb]}${"[]".repeat(rd)}}\n */\nfunction ${name}(${ps.map((p) => p.name).join(", ")}) {\n    \n}\n`;
    }
    case "GO":
      return `func ${name}(${ps.map(({ name, t: [b, d] }) => `${name} ${"[]".repeat(d)}${GO[b]}`).join(", ")}) ${"[]".repeat(rd)}${GO[rb]} {\n    \n}\n`;
    case "RUST":
      return `impl Solution {\n    pub fn ${snake(name)}(${ps.map(({ name, t: [b, d] }) => `${snake(name)}: ${nest("Vec<", ">", RUST[b], d)}`).join(", ")}) -> ${nest("Vec<", ">", RUST[rb], rd)} {\n        \n    }\n}\n`;
    case "KOTLIN":
      return `class Solution {\n    fun ${name}(${ps.map(({ name, t: [b, d] }) => `${name}: ${kotlinType(b, d)}`).join(", ")}): ${kotlinType(rb, rd)} {\n        \n    }\n}\n`;
    case "CSHARP":
      return `public class Solution {\n    public ${CS[rb]}${"[]".repeat(rd)} ${name}(${ps.map(({ name, t: [b, d] }) => `${CS[b]}${"[]".repeat(d)} ${name}`).join(", ")}) {\n        \n    }\n}\n`;
    case "RUBY": {
      const docs = ps.map(({ name, t: [b, d] }) => `# @param {${DOC[b]}${"[]".repeat(d)}} ${snake(name)}`);
      return `${docs.join("\n")}\n# @return {${DOC[rb]}${"[]".repeat(rd)}}\ndef ${snake(name)}(${ps.map((p) => snake(p.name)).join(", ")})\n    \nend\n`;
    }
    case "PHP": {
      const docs = ps.map(({ name, t: [b, d] }) => `     * @param ${DOC[b]}${"[]".repeat(d)} $${name}`);
      return `<?php\n\nclass Solution {\n\n    /**\n${docs.join("\n")}\n     * @return ${DOC[rb]}${"[]".repeat(rd)}\n     */\n    function ${name}(${ps.map((p) => "$" + p.name).join(", ")}) {\n        \n    }\n}\n`;
    }
    case "ZIG":
      return `const std = @import("std");\n\n// Allocate returned slices with \`allocator\`; it is freed when the program ends.\npub fn ${name}(allocator: std.mem.Allocator, ${ps.map(({ name, t: [b, d] }) => `${name}: ${"[]".repeat(d)}${ZIG[b]}`).join(", ")}) !${"[]".repeat(rd)}${ZIG[rb]} {\n    _ = allocator;\n    \n}\n`;
    default:
      return "";
  }
}

/** Sample input lines labelled with their parameter names: [["nums", "[2,7]"], ["target", "9"]]. */
export function labelInput(s: Signature, input: string): [string, string][] {
  const lines = input.split("\n").filter((line) => line.trim());
  return lines.map((line, i) => [s.params[i]?.name ?? "?", line.trim()]);
}

function fits(value: unknown, base: Base, dims: number): boolean {
  if (dims) return Array.isArray(value) && value.every((v) => fits(v, base, dims - 1));
  if (base === "int") return Number.isInteger(value) && Math.abs(value as number) <= 2147483647;
  if (base === "long") return Number.isInteger(value);
  if (base === "double") return typeof value === "number";
  if (base === "bool") return typeof value === "boolean";
  return typeof value === "string";
}

function checkValue(text: string, type: string, what: string): string | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return `${what} is not valid JSON`; }
  const [base, dims] = split(type);
  return fits(value, base, dims) ? null : `${what} is not a ${type}`;
}

/** The first problem with a test, in the backend's words, or null when it fits the signature. */
export function checkTest(s: Signature, input: string, expected: string): string | null {
  const lines = input.split("\n").filter((line) => line.trim());
  if (lines.length !== s.params.length) return `the input needs exactly ${s.params.length} line${s.params.length === 1 ? "" : "s"}, one JSON value per parameter`;
  for (let i = 0; i < lines.length; i++) {
    const problem = checkValue(lines[i], s.params[i].type, `parameter ${s.params[i].name}`);
    if (problem) return problem;
  }
  return checkValue(expected, s.returnType, "the expected output");
}

/** Problems with the signature itself (the backend also rejects reserved words). */
export function checkSignature(s: Signature): string[] {
  const problems: string[] = [];
  const valid = /^[a-z][a-zA-Z0-9]{0,39}$/;
  if (!valid.test(s.functionName)) problems.push("The function name must start with a lowercase letter and use only letters and digits");
  if (s.params.length === 0 || s.params.length > 10) problems.push("The function needs 1-10 parameters");
  const seen = new Set([snake(s.functionName)]);
  for (const p of s.params) {
    if (!valid.test(p.name)) problems.push(`Parameter "${p.name}" must start with a lowercase letter and use only letters and digits`);
    else if (seen.has(snake(p.name))) problems.push(`Two names are the same: ${p.name}`);
    seen.add(snake(p.name));
  }
  return problems;
}

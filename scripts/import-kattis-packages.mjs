// Converts contest problems in the standard ICPC/Kattis package format (problem.yaml, statement in
// LaTeX or Markdown, data/sample and data/secret, submissions/accepted) into InfoM4th problem banks.
//
//   node scripts/import-kattis-packages.mjs <folder with packages> --source "FPC 2024" --prefix fpc24 \
//        [--out draft/warmup/fpc24] [--only a,b] [--difficulty a=EASY,b=MEDIUM] [--max-mb 60]
//
// Only problems the platform can judge as-is are converted: the default output comparison (tokens),
// no custom output checker, no interactive problems, no floating-point tolerance, and an accepted
// C, C++ or Python solution. Every skipped problem is listed with its reason. A problem whose license
// does not allow redistribution (anything but CC BY / CC BY-SA / CC0 / public domain) is skipped too.
// Statements are converted to the platform's plain Markdown; anything the converter could not
// translate is reported, so a person can read those statements before publishing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeProblemBank } from './package-problem-bank.mjs';

const OPEN_LICENSES = ['cc by-sa', 'cc by', 'cc0', 'public domain'];

// ---------- problem.yaml (the subset packages use: scalars, one nested level, simple lists) ----------
export function parseYaml(text) {
  const root = {}; let current = null, currentKey = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const m = line.trim().match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (indent === 0 && m) {
      currentKey = m[1];
      if (m[2] === '') { current = {}; root[currentKey] = current; }
      else { root[currentKey] = scalar(m[2]); current = null; }
    } else if (current && m) current[m[1]] = scalar(m[2]);
    else if (currentKey && line.trim().startsWith('- ')) {
      if (!Array.isArray(root[currentKey])) root[currentKey] = [];
      root[currentKey].push(scalar(line.trim().slice(2)));
    }
  }
  return root;
}
function scalar(value) {
  const v = value.trim();
  if (/^".*"$|^'.*'$/.test(v)) return v.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((s) => scalar(s)).filter((s) => s !== '');
  return v;
}

// ---------- LaTeX statement → the platform's Markdown (paragraphs, **bold**, *italic*, `code`, lists) ----------
const SYMBOLS = {
  '\\leq': '≤', '\\le': '≤', '\\geq': '≥', '\\ge': '≥', '\\neq': '≠', '\\ne': '≠', '\\cdot': '·', '\\times': '×',
  '\\ldots': '…', '\\dots': '…', '\\cdots': '…', '\\to': '→', '\\rightarrow': '→', '\\leftarrow': '←', '\\infty': '∞',
  '\\pm': '±', '\\approx': '≈', '\\in': '∈', '\\notin': '∉', '\\subseteq': '⊆', '\\cup': '∪', '\\cap': '∩', '\\sum': 'Σ',
  '\\lfloor': '⌊', '\\rfloor': '⌋', '\\lceil': '⌈', '\\rceil': '⌉', '\\mid': '|', '\\lvert': '|', '\\rvert': '|',
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε', '\\pi': 'π', '\\sigma': 'σ', '\\Delta': 'Δ',
  '\\quad': ' ', '\\qquad': '  ', '\\,': ' ', '\\;': ' ', '\\!': '', '\\{': '{', '\\}': '}', '\\%': '%', '\\&': '&', '\\#': '#',
  '\\$': '$', '\\_': '_', '\\textasciitilde': '~', '\\backslash': '\\', '\\ell': 'ℓ', '\\prime': '′', '\\circ': '°', '\\deg': '°',
  '\\odot': '⊙', '\\oplus': '⊕', '\\otimes': '⊗', '\\wedge': '∧', '\\vee': '∨', '\\neg': '¬', '\\setminus': '∖', '\\emptyset': '∅',
  '\\forall': '∀', '\\exists': '∃', '\\Rightarrow': '⇒', '\\Leftrightarrow': '⇔', '\\colon': ':', '\\sim': '~', '\\lambda': 'λ',
  '\\mu': 'μ', '\\theta': 'θ', '\\phi': 'φ', '\\omega': 'ω', '\\tau': 'τ', '\\rho': 'ρ',
  '\\equiv': '≡', '\\bmod': 'mod', '\\mod': 'mod', '\\log': 'log', '\\max': 'max', '\\min': 'min', '\\gcd': 'gcd', '\\lt': '<', '\\gt': '>',
};
/** Reads a balanced {...} group starting at s[i] === '{'; returns [content, index after the group]. */
function group(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}
/** Replaces \name{a}{b}... with fn(a, b, ...) everywhere, innermost-safe by repeated passes. */
function command(s, name, args, fn) {
  const re = new RegExp('\\\\' + name + '\\*?\\s*(?=\\{)', 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length; const values = [];
    for (let k = 0; k < args; k++) {
      while (s[i] === ' ' || s[i] === '\n') i++;
      if (s[i] !== '{') break;
      const [v, next] = group(s, i); values.push(v); i = next;
    }
    if (values.length < args) continue;
    out += s.slice(last, m.index) + fn(...values); last = i; re.lastIndex = i;
  }
  return out + s.slice(last);
}
function math(m) {
  let s = m;
  s = command(s, 'frac', 2, (a, b) => `(${math(a)})/(${math(b)})`);
  s = command(s, 'sqrt', 1, (a) => `√(${math(a)})`);
  s = s.replace(/\\(?:texttt|mathtt|textbf|mathbf)\s+([A-Za-z0-9])/g, '$1').replace(/\\(?:mathop|mathrel|mathbin)(?=[^{A-Za-z])/g, '');
  // Wrappers can nest (\text{``\texttt{ab}''}): unwrap until nothing is left.
  for (let pass = 0; pass < 3; pass++)
    s = command(s, '(?:text|textrm|mathrm|mathit|mathbf|mathsf|mathcal|operatorname|textit|textbf|mbox|texttt|mathtt|mathrel|mathop|mathbin|overline|hat|bar|vec|boldsymbol)', 1, (a) => a);
  s = s.replace(/``|''/g, '"');
  s = command(s, 'binom', 2, (a, b) => `C(${math(a)}, ${math(b)})`);
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)\s*([()[\]|.]|\\[{}])/g, (_, d) => (d === '.' ? '' : d.replace('\\', '')));
  for (const [k, v] of Object.entries(SYMBOLS).sort((a, b) => b[0].length - a[0].length))
    // Only letter commands need the guard (\le must not eat \left); \{ is followed by anything.
    s = s.replace(new RegExp(k.replace(/[\\{}$%&#_]/g, (c) => '\\' + c) + (/[A-Za-z]$/.test(k) ? '(?![A-Za-z])' : ''), 'g'), v);
  // a_{l+1} → a_(l+1), but 10^{12} → 10^12.
  const script = (mark) => (_, x) => mark + (/^[A-Za-z0-9]+$/.test(x.trim()) ? x.trim() : `(${x.replace(/\s+/g, '')})`);
  s = s.replace(/\^\{([^{}]*)\}/g, script('^')).replace(/_\{([^{}]*)\}/g, script('_')).replace(/[{}]/g, '');
  s = s.replace(/\*/g, '·').replace(/\s+/g, ' ').trim();
  return s;
}
export function latexToMarkdown(tex, issues) {
  let s = tex.replace(/\r/g, '');
  s = s.replace(/(^|[^\\])%.*$/gm, '$1');                       // comments
  s = s.replace(/\\problemname\s*\{[^}]*\}/g, '');
  // Statement macros (\newcommand{\maxn}{10^{12}}, \def\maxn{...}): expand them, then drop the definitions.
  const macros = {};
  s = s.replace(/\\(?:newcommand|renewcommand|providecommand)\*?\s*\{?\\([A-Za-z]+)\}?(?:\[\d\])?\s*(?=\{)|\\def\s*\\([A-Za-z]+)\s*(?=\{)/g, (m, a, b) => `\u0001${a ?? b}\u0002`);
  s = s.replace(/\u0001([A-Za-z]+)\u0002/g, (m, name, offset) => m);
  let out = '', i = 0;
  while (i < s.length) {
    const start = s.indexOf('\u0001', i);
    if (start < 0) { out += s.slice(i); break; }
    out += s.slice(i, start);
    const end = s.indexOf('\u0002', start), name = s.slice(start + 1, end);
    const [body, next] = group(s, end + 1);
    macros[name] = body; i = next;
  }
  s = out;
  for (let pass = 0; pass < 4; pass++)
    for (const [name, body] of Object.entries(macros)) s = s.replace(new RegExp('\\\\' + name + '(?![A-Za-z])\\s?', 'g'), () => body);
  // BAPCtools writes the input and output sections as environments.
  s = s.replace(/\\begin\{(Input|Output|Interaction|Notes)\}/g, (_, t) => `\n\n\\section*{${t}}\n\n`).replace(/\\end\{(?:Input|Output|Interaction|Notes)\}/g, '\n\n');
  // Decorative pictures at the top of a statement carry no information: drop them silently.
  s = command(s, 'illustration', 3, () => '');
  s = s.replace(/\\footnotemark(\[[^\]]*\])?/g, '');
  s = command(s, 'footnotetext', 1, (a) => ` (${a})`);
  s = s.replace(/\\textcopyright\b/g, '©');
  s = command(s, '(?:autoref|ref|cref|Cref)', 1, () => { issues.add('refers to a figure or section'); return 'the figure'; });
  // Math first, so its symbols never meet the text rules.
  s = s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, a, b) => '\n\n' + math(a ?? b) + '\n\n');
  s = s.replace(/\\begin\{(?:equation|align|eqnarray)\*?\}([\s\S]*?)\\end\{(?:equation|align|eqnarray)\*?\}/g, (_, a) => '\n\n' + math(a.replace(/&|\\\\/g, ' ')) + '\n\n');
  s = s.replace(/\$([^$]+)\$|\\\(([\s\S]+?)\\\)/g, (_, a, b) => math(a ?? b));
  // Figures and pictures cannot be shown: keep the caption and flag the problem.
  s = s.replace(/\\begin\{figure\}[\s\S]*?\\end\{figure\}/g, (f) => { issues.add('has a figure'); const cap = f.match(/\\caption\{([^}]*)\}/); return cap ? `\n\n(Figure: ${cap[1]})\n\n` : '\n\n(A figure is omitted here.)\n\n'; });
  s = s.replace(/\\includegraphics(\[[^\]]*\])?\{[^}]*\}/g, () => { issues.add('has a figure'); return '(A figure is omitted here.)'; });
  // Tables: drop the floating wrapper, show the grid as an aligned text block (the platform has no tables).
  s = s.replace(/\\begin\{table\}(\[[^\]]*\])?|\\end\{table\}/g, '\n\n');
  s = s.replace(/\\begin\{tabular\}\s*\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g, (_, body) => {
    const rows = body.replace(/\\hline|\\toprule|\\midrule|\\bottomrule|\\cline\{[^}]*\}/g, '').split(/\\\\/)
      .map((r) => r.split('&').map((cell) => cell.replace(/\s+/g, ' ').trim())).filter((r) => r.join('').trim());
    const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length))) ?? [];
    // \u0005 stands for ``` until the end, so the quote rules (`` → ") cannot touch the fence.
    return '\n\n\u0005\n' + rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join(' | ').trimEnd()).join('\n') + '\n\u0005\n\n';
  });
  // Sections become headings; Input and Output are split out by the caller.
  s = s.replace(/\\(?:sub)*section\*?\s*\{([^}]*)\}/g, (_, t) => `\n\n## ${t.trim()}\n\n`);
  s = s.replace(/\\paragraph\*?\s*\{([^}]*)\}/g, (_, t) => `\n\n**${t.trim()}** `);
  // Lists, innermost first; the platform shows one flat list level, so nested items follow their parent.
  const list = /\\begin\{(itemize|enumerate|description)\}((?:(?!\\begin\{(?:itemize|enumerate|description)\})[\s\S])*?)\\end\{\1\}/;
  for (let guard = 0; guard < 50 && list.test(s); guard++)
    s = s.replace(list, (_, _kind, body) =>
      '\n\u0004' + body.split(/\\item(?:\[([^\]]*)\])?/).reduce((acc, part, i, all) => {
        if (i === 0 || i % 2 === 1) return acc;   // text before the first item, or the optional [label]
        const label = all[i - 1];
        const lines = part.split('\n\u0004').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
        return lines.length ? acc + `- ${label ? `**${label}** ` : ''}${lines.join('\n')}\n` : acc;
      }, '').trim() + '\n');
  s = s.replace(/\n?\u0004/g, '\n\n');
  s = s.replace(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g, (_, code) => '\n\n\u0005\n' + code.replace(/^\n|\n$/g, '') + '\n\u0005\n\n');
  s = s.replace(/\\verb(.)(.*?)\1/g, (_, _d, code) => '`' + code + '`');
  s = s.replace(/\\texttt\s+([A-Za-z0-9])/g, '`$1`');
  s = s.replace(/\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|bfseries|itshape|ttfamily|centering|raggedright)(?![A-Za-z])/g, '');
  s = command(s, '(?:label|vspace|hspace|phantom|hphantom|vphantom)', 1, () => '');
  s = command(s, '(?:textbf|bf)', 1, (a) => `**${a}**`);
  s = command(s, '(?:emph|textit|textsl|it)', 1, (a) => `*${a}*`);
  s = command(s, '(?:texttt|code|lstinline)', 1, (a) => '`' + a + '`');
  s = command(s, 'href', 2, (_u, t) => t);
  s = command(s, 'url', 1, (u) => u);
  s = command(s, 'footnote', 1, (a) => ` (${a})`);
  s = command(s, '(?:textsc|textrm|textsf|underline|mbox|text|textnormal|small|large|Large|centering|noindent)', 1, (a) => a);
  s = s.replace(/\\begin\{(?:center|flushleft|flushright|quote|minipage|samepage)\}(\{[^}]*\})?|\\end\{(?:center|flushleft|flushright|quote|minipage|samepage)\}/g, '\n\n');
  s = s.replace(/``|''/g, '"').replace(/---/g, '—').replace(/--/g, '–');
  s = s.replace(/\\\\(\[[^\]]*\])?/g, '\n').replace(/~/g, ' ').replace(/\\(?:noindent|medskip|bigskip|smallskip|newline|par|vspace\*?\{[^}]*\}|hspace\*?\{[^}]*\}|clearpage|newpage|centering)\b/g, '\n');
  for (const [k, v] of Object.entries(SYMBOLS)) if (/^\\[%&#_${}]$/.test(k)) s = s.split(k).join(v);
  // Symbols written outside math mode.
  for (const [k, v] of Object.entries(SYMBOLS).sort((a, b) => b[0].length - a[0].length))
    if (/^\\[A-Za-z]+$/.test(k)) s = s.replace(new RegExp('\\' + k + '(?![A-Za-z])', 'g'), v);
  const leftover = s.match(/\\[A-Za-z]+/g);
  if (leftover) { issues.add('untranslated LaTeX: ' + [...new Set(leftover)].slice(0, 6).join(' ')); s = s.replace(/\\[A-Za-z]+\*?/g, ''); }
  s = s.replace(/[{}]/g, '');
  s = s.split('\n').map((l) => l.trimEnd()).join('\n').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // The platform turns every single newline into a line break: rejoin the source's wrapped lines,
  // except in lists, headings and code blocks.
  s = s.replace(/\u0005/g, '```');
  const fences = [];
  s = s.replace(/```[\s\S]*?```/g, (f) => { fences.push(f); return `\u0003${fences.length - 1}\u0003`; });
  s = s.split(/\n{2,}/).map((p) => (/^(- |## |\u0003)/.test(p) ? p : p.replace(/\n/g, ' '))).join('\n\n');
  return s.replace(/\u0003(\d+)\u0003/g, (_, n) => fences[Number(n)]);
}

/** Splits a converted statement into story, input and output sections (Kattis uses \section*{Input} and {Output}). */
export function sections(markdown) {
  const parts = markdown.split(/^## (.*)$/m);
  let statement = parts[0].trim(), input = '', output = '';
  const extra = [];
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim(), body = (parts[i + 1] ?? '').trim();
    if (/^input/i.test(title) && !input) input = body;
    else if (/^output/i.test(title) && !output) output = body;
    else extra.push(`### ${title}\n\n${body}`);
  }
  if (extra.length) statement = [statement, ...extra].filter(Boolean).join('\n\n');
  return { statement, input, output };
}

// ---------- package reading ----------
function find(dir, names) { for (const n of names) { const p = path.join(dir, n); if (fs.existsSync(p)) return p; } return null; }
function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : []));
}
const text = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const REFERENCE = [['.cpp', 'CPP'], ['.cc', 'CPP'], ['.cxx', 'CPP'], ['.c', 'C'], ['.py', 'PYTHON'], ['.py3', 'PYTHON']];

export function convert(dir, options) {
  const yamlFile = path.join(dir, 'problem.yaml');
  const meta = fs.existsSync(yamlFile) ? parseYaml(text(yamlFile)) : {};
  // Newer packages nest the name per language: name: { en: ... }.
  if (meta.name && typeof meta.name === 'object') meta.name = meta.name.en ?? Object.values(meta.name)[0];
  if (Array.isArray(meta.author)) meta.author = meta.author.join(', ');
  const short = path.basename(dir);
  const skip = (reason) => ({ skipped: true, short, title: meta.name ?? short, reason });
  const license = String(meta.license ?? '').toLowerCase();
  if (!OPEN_LICENSES.some((l) => license === l || license.startsWith(l + ' '))) return skip(`license "${meta.license ?? 'not stated'}" does not allow redistribution`);
  const validation = String(meta.validation ?? 'default');
  const type = String(meta.type ?? 'pass-fail');
  if (/interactive/.test(validation + type) || fs.existsSync(path.join(dir, 'data', 'sample')) && walk(path.join(dir, 'data'), '.interaction').length) return skip('interactive');
  if (/custom/.test(validation) || find(dir, ['output_validators', 'output_validator']) && walk(find(dir, ['output_validators', 'output_validator']), '').length)
    return skip('needs a custom output checker');
  const flags = String(meta.validator_flags ?? meta.validator_options ?? '');
  if (/float|tolerance/.test(flags)) return skip('needs floating-point tolerance');
  if (/case_sensitive|space_change_sensitive/.test(flags)) return skip('needs exact case or spacing rules: ' + flags);

  const statementFile = find(dir, ['problem_statement/problem.en.tex', 'statement/problem.en.tex', 'problem_statement/problem.tex', 'statement/problem.en.md', 'problem_statement/problem.en.md']);
  if (!statementFile) return skip('no English statement');
  const issues = new Set();
  const markdown = statementFile.endsWith('.md') ? text(statementFile) : latexToMarkdown(text(statementFile), issues);
  // The platform's statements have no images: a problem explained by a figure would be unfair to show without it.
  if (issues.has('has a figure') && !options.allowFigures) return skip('its statement relies on a figure (use --allow-figures to convert it anyway)');
  const { statement, input, output } = sections(markdown);
  if (!input || !output) issues.add('could not find the Input/Output sections');

  const samples = walk(path.join(dir, 'data', 'sample'), '.in'), secret = walk(path.join(dir, 'data', 'secret'), '.in');
  const pair = (file, sample) => {
    const ans = file.replace(/\.in$/, '.ans');
    return fs.existsSync(ans) ? { input: text(file), expected: text(ans), sample } : null;
  };
  const sampleTests = samples.map((f) => pair(f, true)).filter(Boolean), hidden = secret.map((f) => pair(f, false)).filter(Boolean);
  if (!sampleTests.length) return skip('no sample tests');
  if (!hidden.length) return skip('no hidden tests');
  // The platform stores at most 16 MiB of tests (and 200 tests) per problem. Keep every example, then the
  // largest hidden tests that fit (they catch slow solutions), then as many smaller ones as fit.
  const size = (t) => Buffer.byteLength(t.input) + Buffer.byteLength(t.expected);
  let budget = options.suiteBytes - sampleTests.reduce((n, t) => n + size(t), 0), slots = 200 - sampleTests.length;
  const keep = new Set(), bySize = [...hidden].sort((a, b) => size(b) - size(a));
  for (const t of bySize) { if (keep.size >= 2 || slots <= 0) break; if (size(t) <= budget / 2.5) { keep.add(t); budget -= size(t); slots--; } }
  for (const t of [...bySize].reverse()) { if (slots <= 0) break; if (!keep.has(t) && size(t) <= budget) { keep.add(t); budget -= size(t); slots--; } }
  if (!keep.size) return skip('every hidden test is larger than the platform\'s 16 MiB limit');
  const tests = [...sampleTests, ...hidden.filter((t) => keep.has(t))];
  const dropped = hidden.length - keep.size;
  if (dropped) issues.add(`${dropped} of ${hidden.length} hidden tests left out to fit the 16 MiB limit`);
  const bytes = tests.reduce((n, t) => n + size(t), 0);
  if (bytes > options.maxBytes) return skip(`test data is ${(bytes / 1048576).toFixed(1)} MiB (limit ${options.maxBytes / 1048576} MiB)`);

  const accepted = walk(path.join(dir, 'submissions', 'accepted'), '');
  let reference = null;
  for (const [ext, language] of REFERENCE) {
    const file = accepted.find((f) => f.endsWith(ext));
    if (file) {
      const sourceCode = text(file);
      // The judge's CPP is C++17; jury code using C++20 features is judged as CPP20.
      const cpp20 = language === 'CPP' && /ranges::|views::|<=>|\.contains\(|<format>|std::format|consteval|\bconcept\b|\brequires\b|std::span|<bit>|popcount|starts_with|ends_with|std::midpoint|\bssize\(/.test(sourceCode);
      reference = { label: 'Jury solution (' + path.basename(file) + ')', language: cpp20 ? 'CPP20' : language, sourceCode };
      break;
    }
  }
  if (!reference) return skip('no accepted C, C++ or Python solution');

  // Time limit: BAPCtools writes .timelimit, newer packages limits.time_limit, DOMjudge exports domjudge-problem.ini.
  let seconds = 2;
  const tl = find(dir, ['.timelimit', 'timelimit']);
  if (tl) seconds = Number(text(tl).trim()) || seconds;
  else if (meta.limits?.time_limit) seconds = Number(meta.limits.time_limit);
  else if (fs.existsSync(path.join(dir, 'domjudge-problem.ini'))) seconds = Number((text(path.join(dir, 'domjudge-problem.ini')).match(/timelimit\s*=\s*'?([\d.]+)/) ?? [])[1]) || seconds;
  const memory = Math.min(1024, Math.max(256, Number(meta.limits?.memory ?? 256)));

  const credit = [meta.author ? `by ${meta.author}` : '', `from ${options.source}`].filter(Boolean).join(' ');
  const licenseName = String(meta.license).toUpperCase().replace('CC BY-SA', 'CC BY-SA').replace(/^PUBLIC DOMAIN$/, 'public domain');
  const owner = meta.rights_owner && meta.rights_owner !== 'author' ? ` (© ${meta.rights_owner})` : '';
  const attribution = `*Problem ${credit}${owner}, licensed ${licenseName}.*`;
  const slug = `${options.prefix}-${short}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
  const largestOutput = Math.max(...tests.map((t) => Buffer.byteLength(t.expected)));
  return {
    skipped: false, short, issues: [...issues], bytes,
    problem: {
      slug, title: String(meta.name ?? short), difficulty: options.difficulty[short] ?? 'MEDIUM', checker: 'TOKENS',
      timeLimitMs: Math.round(Math.min(10, Math.max(1, seconds)) * 1000), memoryLimitMb: memory, outputLimitKb: Math.max(1024, Math.ceil(largestOutput / 1024) + 64),
      languages: ['C', 'CPP', 'CPP20', 'JAVA', 'PYTHON', 'PYPY'],
      statement: statement + '\n\n' + attribution, inputFormat: input, outputFormat: output, constraints: '', explanation: '',
      setterNotes: [`Source: ${options.source}, problem "${short}". License: ${meta.license}.`, meta.source_url ? `Original: ${meta.source_url}` : '',
        issues.size ? 'Converter notes: ' + [...issues].join('; ') + '. Read the statement before publishing.' : ''].filter(Boolean).join('\n'),
      tests, reference,
    },
  };
}

/** Problem package folders below root: every folder holding a problem.yaml (or a statement and data/). */
export function packages(root) {
  const found = [];
  const visit = (dir, depth) => {
    if (fs.existsSync(path.join(dir, 'problem.yaml')) || (fs.existsSync(path.join(dir, 'data', 'secret')) && find(dir, ['problem_statement', 'statement']))) { found.push(dir); return; }
    if (depth > 4) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.')) visit(path.join(dir, e.name), depth + 1);
  };
  visit(root, 0);
  return found.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const root = args[0];
  if (!root || !fs.existsSync(root)) { console.error('Usage: node scripts/import-kattis-packages.mjs <folder> --source "Name Year" --prefix short [--out file] [--only a,b] [--difficulty a=EASY,b=MEDIUM] [--max-mb 60]'); process.exit(2); }
  const source = option('--source', path.basename(root)), prefix = option('--prefix', path.basename(root));
  const only = option('--only', '')?.split(',').filter(Boolean);
  const difficulty = Object.fromEntries((option('--difficulty', '') ?? '').split(',').filter(Boolean).map((p) => p.split('=')));
  const maxBytes = Number(option('--max-mb', '60')) * 1048576, allowFigures = args.includes('--allow-figures');
  const out = path.resolve(option('--out', path.join('draft', 'warmup', prefix + '.json')));
  const converted = [], report = [];
  for (const dir of packages(root)) {
    if (only?.length && !only.includes(path.basename(dir))) continue;
    let r;
    try { r = convert(dir, { source, prefix, difficulty, maxBytes, allowFigures, suiteBytes: Math.floor(15.5 * 1048576) }); }
    catch (e) { r = { skipped: true, short: path.basename(dir), reason: 'error: ' + e.message }; }
    report.push(r.skipped ? `- SKIP ${r.short}: ${r.reason}` : `- OK   ${r.short} → ${r.problem.slug} (${r.problem.tests.length} tests, ${(r.bytes / 1048576).toFixed(1)} MiB, ${r.problem.reference.language})${r.issues.length ? ' — review: ' + r.issues.join('; ') : ''}`);
    if (!r.skipped) converted.push(r.problem);
  }
  console.log(`${source}: ${converted.length} converted, ${report.length - converted.length} skipped\n` + report.join('\n'));
  // Banks stay under the importer's 64 MiB limit: problems are split over as many files as needed.
  const banks = []; let current = [], size = 0;
  for (const p of converted) {
    const b = p.tests.reduce((n, t) => n + t.input.length + t.expected.length, 0) + 20000;
    if (current.length && size + b > maxBytes) { banks.push(current); current = []; size = 0; }
    current.push(p); size += b;
  }
  if (current.length) banks.push(current);
  banks.forEach((problems, i) => {
    const file = banks.length === 1 ? out : out.replace(/\.json$/, `-${i + 1}.json`);
    const sizes = writeProblemBank({ format: 'infom4th.problem-bank', version: 1, problems }, file);
    console.log(`Bank: ${file} (${problems.length} problems, ${(sizes.compressedBytes / 1048576).toFixed(1)} MiB compressed)`);
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out.replace(/\.json$/, '.report.md'), `# ${source}\n\n${report.join('\n')}\n`);
}

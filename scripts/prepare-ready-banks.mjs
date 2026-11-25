// Enriches all example & warmup problem banks with curated LeetCode-style topic tags,
// all 15 platform languages, and contest flags, then writes both updated source banks
// and consolidated ready-to-import .json.gz files under draft/ready-to-import/.
import fs from 'node:fs';
import path from 'node:path';
import { writeProblemBank } from './package-problem-bank.mjs';

const ALL_LANGUAGES = [
  'CPP', 'CPP20', 'C', 'JAVA', 'PYTHON', 'PYPY', 'JAVASCRIPT',
  'GO', 'RUST', 'KOTLIN', 'CSHARP', 'RUBY', 'PHP', 'ZIG', 'BRAINFUCK',
];

const CURATED_TAGS = {
  // 21 InfoM4th Classics
  'anagram-check': ['string', 'hash map'],
  'balanced-brackets': ['string', 'stack'],
  'count-distinct': ['array', 'hash map', 'sorting'],
  'count-set-bits': ['bit manipulation', 'math'],
  'even-sum': ['array', 'math', 'implementation'],
  'fibonacci-modulo': ['math', 'dp', 'number theory'],
  'first-occurrence': ['array', 'binary search'],
  'greatest-common-divisor': ['math', 'number theory'],
  'grid-shortest-path': ['graphs', 'matrix'],
  'longest-distinct-substring': ['string', 'sliding window', 'hash map'],
  'maximum-element': ['array', 'implementation'],
  'maximum-subarray-sum': ['array', 'dp', 'greedy'],
  'merge-sorted-arrays': ['array', 'two pointers', 'sorting'],
  'missing-number': ['array', 'math'],
  'move-zeroes': ['array', 'two pointers'],
  'palindrome-check': ['string', 'two pointers'],
  'prime-check': ['math', 'number theory'],
  'range-sum-queries': ['array', 'prefix sum'],
  'reverse-array': ['array', 'two pointers'],
  'sum-of-two-numbers': ['math', 'implementation'],
  'two-sum-exists': ['array', 'hash map', 'two pointers'],

  // 12 Warmup Originals
  'warmup-coin-change-ways': ['dp', 'math'],
  'warmup-delivery-routes': ['graphs', 'greedy', 'data structures'],
  'warmup-fewest-coins': ['dp'],
  'warmup-island-groups': ['graphs', 'data structures'],
  'warmup-longest-increasing': ['dp', 'binary search', 'array'],
  'warmup-meeting-room': ['greedy', 'sorting'],
  'warmup-most-frequent-word': ['string', 'hash map', 'sorting'],
  'warmup-power-mod': ['math', 'number theory', 'bit manipulation'],
  'warmup-rectangle-sums': ['matrix', 'prefix sum'],
  'warmup-second-best': ['array', 'implementation'],
  'warmup-spiral': ['matrix', 'implementation'],
  'warmup-task-order': ['graphs', 'data structures'],

  // FPC 2022-2025 & BAPC 2024 Prelims (Warmup + Bonus)
  'bapc24p-awkwardauction': ['dp', 'math'],
  'bapc24p-chaoticcables': ['graphs', 'trees', 'data structures'],
  'bapc24p-expectederror': ['math', 'implementation'],
  'bapc24p-humanpyramid': ['math', 'binary search'],
  'fpc22-cakepromise': ['array', 'sorting', 'implementation'],
  'fpc22-dalenchip': ['math', 'greedy'],
  'fpc22-eurovision': ['sorting', 'hash map', 'implementation'],
  'fpc22-glassreflection': ['string', 'implementation'],
  'fpc22-highwaysofthefuture': ['graphs', 'dp'],
  'fpc22-inspiringprofessors': ['greedy', 'sorting', 'data structures'],
  'fpc23-felinefriendship': ['graphs', 'math'],
  'fpc23-huntingthemavericks': ['graphs', 'dp'],
  'fpc23-industryimprovements': ['binary search', 'greedy', 'array'],
  'fpc24-annoyingalliterations': ['string', 'hash map', 'dp'],
  'fpc24-curiousjury': ['array', 'sorting', 'math'],
  'fpc24-draggedoutduel': ['string', 'implementation'],
  'fpc24-europeanelection': ['graphs', 'array', 'brute force'],
  'fpc24-intelligenceepxloration': ['graphs', 'implementation'],
  'fpc24-jailbreak': ['graphs', 'matrix'],
  'fpc25-arrayannihilation': ['array', 'data structures', 'greedy'],
  'fpc25-characterithmetic': ['string', 'math', 'brute force'],
  'fpc25-gamblersdilemma': ['math', 'brute force'],
  'fpc25-hopelesslyhungover': ['dp', 'greedy', 'array'],
  'fpc25-interestingmountains': ['array', 'stack', 'math'],
  'fpc25-jumbledkeys': ['string', 'hash map', 'implementation'],
};

function enrichProblem(p, defaultFlag) {
  const tags = CURATED_TAGS[p.slug];
  if (!tags) throw new Error('Missing curated tags for slug: ' + p.slug);
  return {
    ...p,
    languages: ALL_LANGUAGES,
    tags,
    contestFlag: defaultFlag,
  };
}

function writeChunked(problems, baseName, outDir) {
  const MAX_CHUNK = 54 * 1024 * 1024;
  const groups = [[]];
  let size = 0;
  for (const p of problems) {
    const bytes = Buffer.byteLength(JSON.stringify(p), 'utf8');
    if (groups.at(-1).length && size + bytes > MAX_CHUNK) {
      groups.push([]);
      size = 0;
    }
    groups.at(-1).push(p);
    size += bytes;
  }
  const written = [];
  groups.forEach((group, i) => {
    const suffix = groups.length > 1 ? `-part${i + 1}` : '';
    const file = path.join(outDir, `${baseName}${suffix}.json`);
    const stats = writeProblemBank({ format: 'infom4th.problem-bank', version: 1, problems: group }, file);
    written.push({ file: file + '.gz', count: group.length, mb: (stats.compressedBytes / 1048576).toFixed(2) });
  });
  return written;
}

const outDir = path.resolve('draft/ready-to-import');
fs.mkdirSync(outDir, { recursive: true });
for (const old of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, old), { force: true });

// 1. Update examples/problem-bank.import.json + .gz (21 classics)
const classicsFile = path.resolve('examples/problem-bank.import.json');
const classicsBank = JSON.parse(fs.readFileSync(classicsFile, 'utf8'));
classicsBank.problems = classicsBank.problems.map((p) => enrichProblem(p, p.difficulty === 'EASY' ? 'BASIC' : 'WARMUP'));
writeProblemBank(classicsBank, classicsFile);

const summary = [];
summary.push(...writeChunked(classicsBank.problems, '1-classics-21', outDir));

// 2. Update all draft/warmup/banks/*.json + .gz and build consolidated ready-to-import banks
const warmupDir = path.resolve('draft/warmup/banks');
const originals = [];
const fpcBapcWarmup = [];
const bonusHard = [];

if (fs.existsSync(warmupDir)) {
  for (const name of fs.readdirSync(warmupDir).filter((f) => f.endsWith('.json')).sort()) {
    const full = path.join(warmupDir, name);
    const bank = JSON.parse(fs.readFileSync(full, 'utf8'));
    const flag = name.includes('bonus') ? 'STANDARD' : 'WARMUP';
    bank.problems = bank.problems.map((p) => enrichProblem(p, flag));
    writeProblemBank(bank, full);
    if (name.startsWith('originals-')) originals.push(...bank.problems);
    else if (name.includes('bonus')) bonusHard.push(...bank.problems);
    else fpcBapcWarmup.push(...bank.problems);
  }
}

if (originals.length) summary.push(...writeChunked(originals, `2-warmup-originals-${originals.length}`, outDir));
if (fpcBapcWarmup.length) summary.push(...writeChunked(fpcBapcWarmup, `3-warmup-fpc-bapc-${fpcBapcWarmup.length}`, outDir));
if (bonusHard.length) summary.push(...writeChunked(bonusHard, `4-bonus-hard-${bonusHard.length}`, outDir));

console.log('Prepared ready-to-import banks:');
for (const s of summary) console.log(`  - ${path.relative(process.cwd(), s.file)} (${s.count} problems, ${s.mb} MiB gz)`);
console.log(`Total problems enriched: ${classicsBank.problems.length + originals.length + fpcBapcWarmup.length + bonusHard.length}`);

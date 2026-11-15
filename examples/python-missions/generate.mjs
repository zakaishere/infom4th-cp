// Python formation, mission "Python TP2" (Info1 25-26): the 9 exercises of the TP as judged problems, in English.
// Programs read stdin with input() and print only the answer (no prompts). Every expected output comes
// from the oracles below, written apart from the Python reference (solution.py).
//   node examples/python-missions/generate.mjs
//   node scripts/package-problem-bank.mjs examples/python-missions examples/python-missions/problem-bank.import.json
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
let seed = 20261114;
const random = (lo, hi) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return lo + seed % (hi - lo + 1); };
const MISSION = { slug: 'python-tp2', title: 'Python TP2', description: 'The 9 exercises of TP2: variables, conditions and loops. Read input with input() and print only the result (no input prompts). Score: the points of each exercise times the share of tests passed by your best submission.' };
// Two-decimal rendering that never lands on a rounding tie, so Python and JavaScript always agree.
const f2 = (x) => { const s = x * 100; assert.ok(Math.abs(s - Math.floor(s) - 0.5) > 1e-6, 'rounding tie ' + x); return x.toFixed(2); };
const problems = [];
function add(p, cases, oracle) {
  assert.equal(cases.length, 10, p.slug);
  problems.push({ ...p, cases: cases.map((input) => ({ input, expected: oracle(input).trimEnd() + '\n' })) });
}
const nums = (input) => input.trim().split(/\s+/).map(Number);

// ---- Exercise 1 (a): operations
{
  const pairs = [[12, 5], [20, 4], [7, 3], [1, 3], [100, 7], [0, 5], [-9, 4], [15, 6], [999, 10], [-20, 3]];
  add({
    slug: 'tp2-1a-basic-operations', title: 'Ex 1a · Basic operations', weight: 5,
    statement: 'Read two integers **a** and **b** (b ≠ 0), then print their sum, difference, product, integer quotient (`//`) and real quotient (`/`).',
    inputFormat: 'Two lines: a, then b.',
    outputFormat: 'Five lines: `Sum: ...`, `Difference: ...`, `Product: ...`, `Integer quotient: ...`, `Real quotient: ...`. The real quotient has exactly 2 decimals, for example `f"{a/b:.2f}"`.',
    constraints: '-1000 ≤ a, b ≤ 1000, b ≠ 0.',
    solution: 'a = int(input())\nb = int(input())\nprint("Sum:", a + b)\nprint("Difference:", a - b)\nprint("Product:", a * b)\nprint("Integer quotient:", a // b)\nprint("Real quotient:", f"{a / b:.2f}")\n',
  }, pairs.map(([a, b]) => `${a}\n${b}\n`),
  (input) => { const [a, b] = nums(input); return `Sum: ${a + b}\nDifference: ${a - b}\nProduct: ${a * b}\nInteger quotient: ${Math.floor(a / b)}\nReal quotient: ${f2(a / b)}`; });
}
// ---- Exercise 1 (b): circle
add({
  slug: 'tp2-1b-circle-area', title: 'Ex 1b · Area of a circle', weight: 5,
  statement: 'Read a **radius** (a real number) and print the area of the circle: area = π × radius². Use `math.pi`.',
  inputFormat: 'One line: the radius.', outputFormat: 'One line: the area with exactly 2 decimals.', constraints: '0 ≤ radius ≤ 1000.',
  solution: 'import math\n\nradius = float(input())\nprint(f"{math.pi * radius ** 2:.2f}")\n',
}, ['1\n', '2.5\n', '0\n', '10\n', '3.2\n', '7\n', '100\n', '0.5\n', '12.75\n', '1000\n'],
(input) => f2(Math.PI * Number(input) ** 2));
// ---- Exercise 2: average
{
  const half = () => random(0, 40) / 2;
  const cases = ['12\n15\n9\n', '10\n10\n10\n', '0\n0\n0\n', '20\n20\n19\n'];
  while (cases.length < 10) cases.push(`${half()}\n${half()}\n${half()}\n`);
  add({
    slug: 'tp2-2-average-grade', title: 'Ex 2 · Average of three grades', weight: 8,
    statement: 'Read three grades (real numbers), one per line. Print the three grades, then their average.',
    inputFormat: 'Three lines: the grades.',
    outputFormat: 'Four lines: `Grade 1: ...`, `Grade 2: ...`, `Grade 3: ...`, `Average: ...`. Every value is written with exactly 2 decimals.',
    constraints: '0 ≤ grade ≤ 20, in steps of 0.5.',
    solution: 'g1 = float(input())\ng2 = float(input())\ng3 = float(input())\naverage = (g1 + g2 + g3) / 3\nprint(f"Grade 1: {g1:.2f}")\nprint(f"Grade 2: {g2:.2f}")\nprint(f"Grade 3: {g3:.2f}")\nprint(f"Average: {average:.2f}")\n',
  }, cases, (input) => { const [a, b, c] = nums(input); return `Grade 1: ${f2(a)}\nGrade 2: ${f2(b)}\nGrade 3: ${f2(c)}\nAverage: ${f2((a + b + c) / 3)}`; });
}
// ---- Exercise 3: even / odd
add({
  slug: 'tp2-3-even-or-odd', title: 'Ex 3 · Even or odd', weight: 8,
  statement: 'Read an integer and print `even` or `odd`.', inputFormat: 'One line: an integer.', outputFormat: 'The word `even` or the word `odd`.', constraints: '-10^9 ≤ n ≤ 10^9. Zero is even.',
  solution: 'n = int(input())\nif n % 2 == 0:\n    print("even")\nelse:\n    print("odd")\n',
}, ['4\n', '7\n', '0\n', '-3\n', '-8\n', '1000000000\n', '999999999\n', '1\n', '2\n', '-1000000000\n'],
(input) => (Number(input) % 2 === 0 ? 'even' : 'odd'));
// ---- Exercise 4: seconds
add({
  slug: 'tp2-4-convert-duration', title: 'Ex 4 · Convert a duration', weight: 10,
  statement: 'Read a duration in seconds and convert it to hours, minutes and remaining seconds.\n\nExample: for 3725 seconds, print `Hours: 1`, `Minutes: 2`, `Seconds: 5`.',
  inputFormat: 'One line: the number of seconds.', outputFormat: 'Three lines: `Hours: ...`, `Minutes: ...`, `Seconds: ...`.', constraints: '0 ≤ seconds ≤ 10^7.',
  solution: 'total = int(input())\nhours = total // 3600\nminutes = (total % 3600) // 60\nseconds = total % 60\nprint("Hours:", hours)\nprint("Minutes:", minutes)\nprint("Seconds:", seconds)\n',
}, ['3725\n', '0\n', '59\n', '60\n', '3600\n', '3599\n', '86399\n', '86400\n', '10000000\n', '7261\n'],
(input) => { const t = Number(input); return `Hours: ${Math.floor(t / 3600)}\nMinutes: ${Math.floor((t % 3600) / 60)}\nSeconds: ${t % 60}`; });
// ---- Exercise 5: largest of three
add({
  slug: 'tp2-5-largest-of-three', title: 'Ex 5 · Largest of three numbers', weight: 10,
  statement: 'Read three integers a, b and c, and print the largest one. Do not use the `max` function.',
  inputFormat: 'Three lines: a, b, c.', outputFormat: 'One line: the largest of the three.', constraints: '-10^9 ≤ a, b, c ≤ 10^9. Some values may be equal.',
  solution: 'a = int(input())\nb = int(input())\nc = int(input())\nlargest = a\nif b > largest:\n    largest = b\nif c > largest:\n    largest = c\nprint(largest)\n',
}, ['1\n2\n3\n', '3\n2\n1\n', '2\n3\n1\n', '5\n5\n5\n', '-1\n-2\n-3\n', '0\n-5\n0\n', '1000000000\n-1000000000\n7\n', '4\n9\n9\n', '-7\n-7\n-9\n', '100\n250\n250\n'],
(input) => String(Math.max(...nums(input))));
// ---- Exercise 6: discounts
add({
  slug: 'tp2-6-purchase-discount', title: 'Ex 6 · Purchase discount', weight: 14,
  statement: 'A computer store applies these discounts depending on the purchase amount:\n\n- 5% if the amount is between 1000 DH and 2999 DH;\n- 10% if the amount is between 3000 DH and 4999 DH;\n- 15% if the amount is greater than or equal to 5000 DH;\n- no discount if the amount is below 1000 DH.\n\nRead the amount, find the discount rate, compute the discount and print the final amount to pay.',
  inputFormat: 'One line: the amount (an integer, in DH).',
  outputFormat: 'Three lines: `Rate: ...%` (the integer rate: 0, 5, 10 or 15), `Discount: ...` and `Final amount: ...`. Both amounts have exactly 2 decimals.',
  constraints: '0 ≤ amount ≤ 10^6.',
  solution: 'amount = int(input())\nif amount >= 5000:\n    rate = 15\nelif amount >= 3000:\n    rate = 10\nelif amount >= 1000:\n    rate = 5\nelse:\n    rate = 0\ndiscount = amount * rate / 100\nprint(f"Rate: {rate}%")\nprint(f"Discount: {discount:.2f}")\nprint(f"Final amount: {amount - discount:.2f}")\n',
}, [500, 999, 1000, 2999, 3000, 4999, 5000, 12500, 1234, 3500].map((a) => `${a}\n`),
(input) => { const m = Number(input), t = m >= 5000 ? 15 : m >= 3000 ? 10 : m >= 1000 ? 5 : 0, r = (m * t) / 100; return `Rate: ${t}%\nDiscount: ${f2(r)}\nFinal amount: ${f2(m - r)}`; });
// ---- Exercise 7: leap year
add({
  slug: 'tp2-7-leap-year', title: 'Ex 7 · Leap year', weight: 12,
  statement: 'Read a year. It is a leap year if it is divisible by 400, or if it is divisible by 4 but not by 100. Print `leap year` or `not a leap year`.',
  inputFormat: 'One line: the year.', outputFormat: '`leap year` or `not a leap year`.', constraints: '1 ≤ year ≤ 9999.',
  solution: 'year = int(input())\nif year % 400 == 0 or (year % 4 == 0 and year % 100 != 0):\n    print("leap year")\nelse:\n    print("not a leap year")\n',
}, ['2024\n', '2023\n', '1900\n', '2000\n', '2100\n', '1996\n', '2025\n', '400\n', '1\n', '9996\n'],
(input) => { const y = Number(input); return y % 400 === 0 || (y % 4 === 0 && y % 100 !== 0) ? 'leap year' : 'not a leap year'; });
// ---- Exercise 8: countdown
add({
  slug: 'tp2-8-countdown', title: 'Ex 8 · Countdown', weight: 14,
  statement: 'Read a positive integer **n**. Print the numbers from n down to 1, one per line, then the message `Countdown finished!`.\n\nExample for n = 5: 5, 4, 3, 2, 1, then the message.',
  inputFormat: 'One line: n.', outputFormat: 'n lines (from n to 1), then `Countdown finished!`.', constraints: '1 ≤ n ≤ 1000.',
  solution: 'n = int(input())\nwhile n >= 1:\n    print(n)\n    n -= 1\nprint("Countdown finished!")\n',
}, ['5\n', '1\n', '2\n', '10\n', '3\n', '20\n', '100\n', '7\n', '1000\n', '15\n'],
(input) => { const n = Number(input); return Array.from({ length: n }, (_, i) => n - i).join('\n') + '\nCountdown finished!'; });
// ---- Exercise 9: secret number
add({
  slug: 'tp2-9-secret-number', title: 'Ex 9 · Guess the secret number', weight: 14,
  statement: 'The secret number is **15**. Read guesses, one per line, until 15 is found:\n\n- if the guess is greater than 15, print `Too high!`;\n- if it is lower than 15, print `Too low!`;\n- if it equals 15, print `Well done! You found it!` and stop.',
  inputFormat: 'Integers, one per line. The last one is always 15.', outputFormat: 'One message per guess, in order.', constraints: 'At most 100 guesses, between -1000 and 1000.',
  solution: 'secret = 15\nwhile True:\n    guess = int(input())\n    if guess > secret:\n        print("Too high!")\n    elif guess < secret:\n        print("Too low!")\n    else:\n        print("Well done! You found it!")\n        break\n',
}, ['15\n', '10\n20\n15\n', '1\n2\n3\n4\n15\n', '100\n50\n25\n15\n', '16\n14\n15\n', '-5\n0\n15\n', '1000\n-1000\n15\n', '14\n16\n13\n17\n15\n', '20\n19\n18\n17\n16\n15\n', '5\n10\n12\n14\n15\n'],
(input) => { const out = []; for (const n of nums(input)) { if (n > 15) out.push('Too high!'); else if (n < 15) out.push('Too low!'); else { out.push('Well done! You found it!'); break; } } return out.join('\n'); });

// Remove the folders of earlier versions of this bank (French slugs) so they are not packaged by mistake.
for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory() && /^(py-tp2-|tp2-)/.test(entry.name)) fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
problems.forEach((p, i) => {
  const dir = path.join(root, p.slug);
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'solution.py'), p.solution);
  const tests = p.cases.map((c, k) => {
    const n = String(k + 1).padStart(2, '0');
    fs.writeFileSync(path.join(dir, 'tests', n + '.in'), c.input);
    fs.writeFileSync(path.join(dir, 'tests', n + '.out'), c.expected);
    return { input: `tests/${n}.in`, expected: `tests/${n}.out`, sample: k < 2 };
  });
  fs.writeFileSync(path.join(dir, 'problem.json'), JSON.stringify({
    slug: p.slug, title: p.title, difficulty: i < 5 ? 'EASY' : 'MEDIUM', checker: 'TOKENS', timeLimitMs: 1000, memoryLimitMb: 256, languages: ['PYTHON'],
    referenceLanguage: 'PYTHON', referenceFile: 'solution.py', statement: p.statement, inputFormat: p.inputFormat, outputFormat: p.outputFormat, constraints: p.constraints,
    explanation: '', source: 'Python training, TP2 Info1 25-26', tags: ['python', 'tp2'], mission: { ...MISSION, position: i + 1, weight: p.weight }, tests,
  }, null, 2));
});
fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(problems.map((p) => ({ slug: p.slug, title: p.title, weight: p.weight })), null, 2));
console.log(`${problems.length} problems, total weight ${problems.reduce((n, p) => n + p.weight, 0)}`);

// Python formation, mission "Python TP2" (Info1 25-26): the 9 exercises of the TP as judged problems.
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
const MISSION = { slug: 'python-tp2', title: 'Python — TP2', description: 'Les 9 exercices du TP2 : variables, conditions et boucles. Lisez avec input(), affichez uniquement le résultat (sans message de saisie). Score : points de chaque exercice × part des tests réussis (meilleur envoi).' };
// Two-decimal rendering that never lands on a rounding tie, so Python and JavaScript always agree.
const f2 = (x) => { const s = x * 100; assert.ok(Math.abs(s - Math.floor(s) - 0.5) > 1e-6, 'rounding tie ' + x); return x.toFixed(2); };
const problems = [];
function add(p, cases, oracle) {
  assert.equal(cases.length, 10, p.slug);
  problems.push({ ...p, cases: cases.map((input) => ({ input, expected: oracle(input).trimEnd() + '\n' })) });
}
const nums = (input) => input.trim().split(/\s+/).map(Number);

// ---- Exercice 1 (a): opérations
{
  const pairs = [[12, 5], [20, 4], [7, 3], [1, 3], [100, 7], [0, 5], [-9, 4], [15, 6], [999, 10], [-20, 3]];
  add({
    slug: 'py-tp2-1a-operations', title: 'Ex 1a · Opérations de base', weight: 5,
    statement: 'Lisez deux entiers **a** et **b** (b ≠ 0), puis affichez la somme, la différence, le produit, le quotient entier (`//`) et le quotient réel (`/`).',
    inputFormat: 'Deux lignes : a puis b.',
    outputFormat: 'Cinq lignes : `Somme : ...`, `Difference : ...`, `Produit : ...`, `Quotient entier : ...`, `Quotient reel : ...` (le quotient réel avec exactement 2 décimales, par exemple `f"{a/b:.2f}"`).',
    constraints: '-1000 ≤ a, b ≤ 1000, b ≠ 0.',
    solution: 'a = int(input())\nb = int(input())\nprint("Somme :", a + b)\nprint("Difference :", a - b)\nprint("Produit :", a * b)\nprint("Quotient entier :", a // b)\nprint("Quotient reel :", f"{a / b:.2f}")\n',
  }, pairs.map(([a, b]) => `${a}\n${b}\n`),
  (input) => { const [a, b] = nums(input); return `Somme : ${a + b}\nDifference : ${a - b}\nProduit : ${a * b}\nQuotient entier : ${Math.floor(a / b)}\nQuotient reel : ${f2(a / b)}`; });
}
// ---- Exercice 1 (b): cercle
add({
  slug: 'py-tp2-1b-cercle', title: "Ex 1b · Surface d'un cercle", weight: 5,
  statement: 'Lisez un **rayon** (nombre réel) et affichez la surface du cercle : surface = π × rayon². Utilisez `math.pi`.',
  inputFormat: 'Une ligne : le rayon.', outputFormat: 'Une ligne : la surface avec exactement 2 décimales.', constraints: '0 ≤ rayon ≤ 1000.',
  solution: 'import math\n\nrayon = float(input())\nprint(f"{math.pi * rayon ** 2:.2f}")\n',
}, ['1\n', '2.5\n', '0\n', '10\n', '3.2\n', '7\n', '100\n', '0.5\n', '12.75\n', '1000\n'],
(input) => f2(Math.PI * Number(input) ** 2));
// ---- Exercice 2: moyenne
{
  const half = () => random(0, 40) / 2;
  const cases = ['12\n15\n9\n', '10\n10\n10\n', '0\n0\n0\n', '20\n20\n19\n'];
  while (cases.length < 10) cases.push(`${half()}\n${half()}\n${half()}\n`);
  add({
    slug: 'py-tp2-2-moyenne', title: 'Ex 2 · Moyenne de trois notes', weight: 8,
    statement: 'Lisez trois notes (nombres réels), une par ligne. Affichez les trois notes puis leur moyenne.',
    inputFormat: 'Trois lignes : les notes.',
    outputFormat: 'Quatre lignes : `Note 1 : ...`, `Note 2 : ...`, `Note 3 : ...`, `Moyenne : ...`. Chaque valeur est écrite avec exactement 2 décimales.',
    constraints: '0 ≤ note ≤ 20, par pas de 0,5.',
    solution: 'n1 = float(input())\nn2 = float(input())\nn3 = float(input())\nmoyenne = (n1 + n2 + n3) / 3\nprint(f"Note 1 : {n1:.2f}")\nprint(f"Note 2 : {n2:.2f}")\nprint(f"Note 3 : {n3:.2f}")\nprint(f"Moyenne : {moyenne:.2f}")\n',
  }, cases, (input) => { const [a, b, c] = nums(input); return `Note 1 : ${f2(a)}\nNote 2 : ${f2(b)}\nNote 3 : ${f2(c)}\nMoyenne : ${f2((a + b + c) / 3)}`; });
}
// ---- Exercice 3: pair / impair
add({
  slug: 'py-tp2-3-pair-impair', title: 'Ex 3 · Pair ou impair', weight: 8,
  statement: 'Lisez un entier et affichez `pair` ou `impair`.', inputFormat: 'Une ligne : un entier.', outputFormat: 'Le mot `pair` ou le mot `impair`.', constraints: '-10^9 ≤ n ≤ 10^9. Zéro est pair.',
  solution: 'n = int(input())\nif n % 2 == 0:\n    print("pair")\nelse:\n    print("impair")\n',
}, ['4\n', '7\n', '0\n', '-3\n', '-8\n', '1000000000\n', '999999999\n', '1\n', '2\n', '-1000000000\n'],
(input) => (Number(input) % 2 === 0 ? 'pair' : 'impair'));
// ---- Exercice 4: secondes
add({
  slug: 'py-tp2-4-duree', title: 'Ex 4 · Convertir une durée', weight: 10,
  statement: 'Lisez une durée en secondes et convertissez-la en heures, minutes et secondes restantes.\n\nExemple : pour 3725 secondes, on affiche `Heures : 1`, `Minutes : 2`, `Secondes : 5`.',
  inputFormat: 'Une ligne : le nombre de secondes.', outputFormat: 'Trois lignes : `Heures : ...`, `Minutes : ...`, `Secondes : ...`.', constraints: '0 ≤ secondes ≤ 10^7.',
  solution: 'total = int(input())\nheures = total // 3600\nminutes = (total % 3600) // 60\nsecondes = total % 60\nprint("Heures :", heures)\nprint("Minutes :", minutes)\nprint("Secondes :", secondes)\n',
}, ['3725\n', '0\n', '59\n', '60\n', '3600\n', '3599\n', '86399\n', '86400\n', '10000000\n', '7261\n'],
(input) => { const t = Number(input); return `Heures : ${Math.floor(t / 3600)}\nMinutes : ${Math.floor((t % 3600) / 60)}\nSecondes : ${t % 60}`; });
// ---- Exercice 5: plus grand de trois
add({
  slug: 'py-tp2-5-maximum', title: 'Ex 5 · Le plus grand de trois nombres', weight: 10,
  statement: "Lisez trois entiers a, b et c, et affichez le plus grand. N'utilisez pas la fonction `max`.",
  inputFormat: 'Trois lignes : a, b, c.', outputFormat: 'Une ligne : le plus grand des trois.', constraints: '-10^9 ≤ a, b, c ≤ 10^9. Des valeurs peuvent être égales.',
  solution: 'a = int(input())\nb = int(input())\nc = int(input())\nplus_grand = a\nif b > plus_grand:\n    plus_grand = b\nif c > plus_grand:\n    plus_grand = c\nprint(plus_grand)\n',
}, ['1\n2\n3\n', '3\n2\n1\n', '2\n3\n1\n', '5\n5\n5\n', '-1\n-2\n-3\n', '0\n-5\n0\n', '1000000000\n-1000000000\n7\n', '4\n9\n9\n', '-7\n-7\n-9\n', '100\n250\n250\n'],
(input) => String(Math.max(...nums(input))));
// ---- Exercice 6: réductions
add({
  slug: 'py-tp2-6-reduction', title: 'Ex 6 · Réduction sur les achats', weight: 14,
  statement: 'Une entreprise applique les réductions suivantes selon le montant des achats :\n\n- 5 % si le montant est compris entre 1000 DH et 2999 DH ;\n- 10 % si le montant est compris entre 3000 DH et 4999 DH ;\n- 15 % si le montant est supérieur ou égal à 5000 DH ;\n- aucune réduction si le montant est inférieur à 1000 DH.\n\nLisez le montant, déterminez le taux, calculez la réduction et affichez le montant final à payer.',
  inputFormat: 'Une ligne : le montant (entier, en DH).',
  outputFormat: 'Trois lignes : `Taux : ...%` (le taux entier : 0, 5, 10 ou 15), `Reduction : ...` et `Montant final : ...`, les deux montants avec exactement 2 décimales.',
  constraints: '0 ≤ montant ≤ 10^6.',
  solution: 'montant = int(input())\nif montant >= 5000:\n    taux = 15\nelif montant >= 3000:\n    taux = 10\nelif montant >= 1000:\n    taux = 5\nelse:\n    taux = 0\nreduction = montant * taux / 100\nprint(f"Taux : {taux}%")\nprint(f"Reduction : {reduction:.2f}")\nprint(f"Montant final : {montant - reduction:.2f}")\n',
}, [500, 999, 1000, 2999, 3000, 4999, 5000, 12500, 1234, 3500].map((a) => `${a}\n`),
(input) => { const m = Number(input), t = m >= 5000 ? 15 : m >= 3000 ? 10 : m >= 1000 ? 5 : 0, r = (m * t) / 100; return `Taux : ${t}%\nReduction : ${f2(r)}\nMontant final : ${f2(m - r)}`; });
// ---- Exercice 7: année bissextile
add({
  slug: 'py-tp2-7-bissextile', title: 'Ex 7 · Année bissextile', weight: 12,
  statement: 'Lisez une année. Elle est bissextile si elle est divisible par 400, ou si elle est divisible par 4 sans être divisible par 100. Affichez `bissextile` ou `non bissextile`.',
  inputFormat: "Une ligne : l'année.", outputFormat: '`bissextile` ou `non bissextile`.', constraints: '1 ≤ année ≤ 9999.',
  solution: 'annee = int(input())\nif annee % 400 == 0 or (annee % 4 == 0 and annee % 100 != 0):\n    print("bissextile")\nelse:\n    print("non bissextile")\n',
}, ['2024\n', '2023\n', '1900\n', '2000\n', '2100\n', '1996\n', '2025\n', '400\n', '1\n', '9996\n'],
(input) => { const y = Number(input); return y % 400 === 0 || (y % 4 === 0 && y % 100 !== 0) ? 'bissextile' : 'non bissextile'; });
// ---- Exercice 8: compte à rebours
add({
  slug: 'py-tp2-8-compte-a-rebours', title: 'Ex 8 · Compte à rebours', weight: 14,
  statement: "Lisez un entier positif **n**. Affichez les nombres de n jusqu'à 1, un par ligne, puis le message `Fin du compte à rebours !`.\n\nExemple pour n = 5 : 5, 4, 3, 2, 1, puis le message.",
  inputFormat: 'Une ligne : n.', outputFormat: 'n lignes (de n à 1), puis `Fin du compte à rebours !`.', constraints: '1 ≤ n ≤ 1000.',
  solution: 'n = int(input())\nwhile n >= 1:\n    print(n)\n    n -= 1\nprint("Fin du compte à rebours !")\n',
}, ['5\n', '1\n', '2\n', '10\n', '3\n', '20\n', '100\n', '7\n', '1000\n', '15\n'],
(input) => { const n = Number(input); return Array.from({ length: n }, (_, i) => n - i).join('\n') + '\nFin du compte à rebours !'; });
// ---- Exercice 9: nombre secret
add({
  slug: 'py-tp2-9-nombre-secret', title: 'Ex 9 · Deviner le nombre secret', weight: 14,
  statement: "Le nombre secret est **15**. Lisez des propositions, une par ligne, jusqu'à ce que 15 soit trouvé :\n\n- si la proposition est supérieure à 15, affichez `Trop grand !` ;\n- si elle est inférieure à 15, affichez `Trop petit !` ;\n- si elle est égale à 15, affichez `Bravo ! Vous avez trouvé !` et arrêtez-vous.",
  inputFormat: 'Des entiers, un par ligne. Le dernier est toujours 15.', outputFormat: "Un message par proposition, dans l'ordre.", constraints: 'Au plus 100 propositions, entre -1000 et 1000.',
  solution: 'secret = 15\nwhile True:\n    nombre = int(input())\n    if nombre > secret:\n        print("Trop grand !")\n    elif nombre < secret:\n        print("Trop petit !")\n    else:\n        print("Bravo ! Vous avez trouvé !")\n        break\n',
}, ['15\n', '10\n20\n15\n', '1\n2\n3\n4\n15\n', '100\n50\n25\n15\n', '16\n14\n15\n', '-5\n0\n15\n', '1000\n-1000\n15\n', '14\n16\n13\n17\n15\n', '20\n19\n18\n17\n16\n15\n', '5\n10\n12\n14\n15\n'],
(input) => { const out = []; for (const n of nums(input)) { if (n > 15) out.push('Trop grand !'); else if (n < 15) out.push('Trop petit !'); else { out.push('Bravo ! Vous avez trouvé !'); break; } } return out.join('\n'); });

problems.forEach((p, i) => {
  const dir = path.join(root, p.slug);
  fs.rmSync(dir, { recursive: true, force: true });
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
    explanation: '', source: 'Formation Python, TP2 Info1 25-26', tags: ['python', 'tp2'], mission: { ...MISSION, position: i + 1, weight: p.weight }, tests,
  }, null, 2));
});
fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(problems.map((p) => ({ slug: p.slug, title: p.title, weight: p.weight })), null, 2));
console.log(`${problems.length} problems, total weight ${problems.reduce((n, p) => n + p.weight, 0)}`);

# Duel problem bank

12 short problems for duels, 144 tests: 2 examples and 10 hidden tests each, so verdicts come back fast.
Reference solutions are Java (`Main.java`), with an independent Node.js check (`solution.js`).

| Problem | Level | Topics | Task |
| --- | --- | --- | --- |
| Digit Sum | EASY | math, strings | Print the sum of the decimal digits of a non-negative integer n.. |
| Reverse the Words | EASY | strings | A sentence is a list of words separated by single spaces. |
| Second Largest Value | EASY | arrays | Find the second largest different value in an array: the largest value that is strictly smaller than the maximum. |
| Longest Run | EASY | arrays, implementation | A run is a block of consecutive positions that all hold the same value. |
| Rotate Right | EASY | arrays, math | Rotate an array k steps to the right: each step moves the last element to the front. |
| Collatz Steps | EASY | math, simulation | Start from n and repeat: if the number is even, halve it; if it is odd, replace it by 3 times the number plus 1. |
| To Binary | EASY | math, bit-manipulation | Write the non-negative integer n in base 2, without leading zeros. |
| Run-Length Encoding | EASY | strings | Compress a string by replacing every block of equal consecutive letters with the letter followed by the block length. |
| Best Single Trade | MEDIUM | arrays, greedy | You know the price of a coin on each of n days. |
| Count the Primes | MEDIUM | math, number-theory, sieve | Count the prime numbers that are less than or equal to n. |
| First Missing Positive | MEDIUM | arrays, hashing | Find the smallest positive integer (1, 2, 3, ...) that does not appear in the array. |
| Count Pair Sums | MEDIUM | arrays, hashing, counting | Count the pairs of positions i < j with a[i] + a[j] = target. |

## Regenerate, verify, package

Run from the repository root:

```text
node examples/duel-problems/generate.mjs
node examples/duel-problems/verify.mjs
node scripts/package-problem-bank.mjs examples/duel-problems backend/src/main/resources/seed/duel-problems.json
```

The backend bundles `seed/duel-problems.json.gz` (only the `.gz` is committed) and installs every problem
by itself: import, validate the reference on the judge, approve, add to the duel pool. It retries every
20 seconds until a judge for every language (C, C++, Java, Python) is online, and never imports a short
name twice. Problems added here reach a running server with its next deployment. Set
`CP_SEED_DUEL_PROBLEMS=false` to turn this off.

To install the bank by hand instead, package it to `examples/duel-problems/problem-bank.import.json` and use
**Control room -> Duel problems -> Bulk import duel problems** ("Validate, approve and add to Duels").

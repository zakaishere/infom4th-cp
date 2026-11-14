# Python missions (formation)

Mission **Python — TP2** (TP2 Info1 25-26): 10 judged problems from the 9 exercises (exercise 1 is split in two), 100 tests,
100 points in total. Python only. Statements are in French; programs read `input()` and print only the answer.

```text
node examples/python-missions/generate.mjs
node scripts/package-problem-bank.mjs examples/python-missions examples/python-missions/problem-bank.import.json
```

Load `problem-bank.import.json.gz` through **Problem lab -> Bulk import** with "Validate, approve and publish to Practice".
The mission is created by the first import and the problems join it with their points; they do not appear in Practice.
Players open **Missions** in the menu. Folders and the bank file are not committed (git ignores them).
For the next TP, copy `generate.mjs`, change the problems and the mission `slug`/`title`.

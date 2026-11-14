# TD problem bank (academic)

29 judged problems made from the C exercises of TD1 to TD6 ("Correction des TD"), 348 tests:
2 examples and 10 hidden tests each. Statements are in French, like the TDs. Reference solutions are C
(`solution.c`, adapted from the corrections: no prompts, fgets instead of gets); expected outputs come from
independent oracles in `generate.mjs`.

The file exercises of TD6 read the "file" from standard input. TD6 exercise 2 (copy a file) has no
judged version: with stdin it is only an echo.

| TD | Problem | Level | Checker |
| --- | --- | --- | --- |
| TD1 | Pré et post-incrémentation | EASY | TOKENS |
| TD1 | Signe du produit | EASY | TOKENS |
| TD1 | Calculatrice | EASY | TOKENS |
| TD1 | Pair ou impair | EASY | TOKENS |
| TD1 | Lecture d'une date | EASY | TOKENS |
| TD2 | Série harmonique | EASY | TOKENS |
| TD2 | Case marquée dans un carré | EASY | TOKENS |
| TD2 | Triangle de nombres | EASY | TRIMMED_LINES |
| TD2 | Table de multiplication | EASY | TRIMMED_LINES |
| TD2 | Triangle isocèle d'étoiles | EASY | TRIMMED_LINES |
| TD3 | Trier puis supprimer une valeur | MEDIUM | TRIMMED_LINES |
| TD3 | Copier les éléments positifs | EASY | TOKENS |
| TD3 | Mettre la diagonale à zéro | EASY | TRIMMED_LINES |
| TD3 | Produit de deux matrices | MEDIUM | TRIMMED_LINES |
| TD3 | Voisins de même signe | EASY | TOKENS |
| TD3 | Valeurs distinctes | EASY | TRIMMED_LINES |
| TD4 | Longueur d'une chaîne | EASY | TOKENS |
| TD4 | Inverser des chaînes | EASY | TRIMMED_LINES |
| TD4 | Supprimer les espaces | EASY | TRIMMED_LINES |
| TD4 | Insérer une chaîne | EASY | TRIMMED_LINES |
| TD4 | Supprimer une sous-chaîne | EASY | TRIMMED_LINES |
| TD5 | Suivre un pointeur | EASY | TOKENS |
| TD5 | Tableaux égaux | EASY | TOKENS |
| TD5 | Le mot le plus long | EASY | TOKENS |
| TD5 | Trier les mots | MEDIUM | TOKENS |
| TD5 | Commence par | EASY | TOKENS |
| TD5 | Position d'une sous-chaîne | EASY | TOKENS |
| TD6 | Enregistrer des mots jusqu'à « fin » | EASY | TOKENS |
| TD6 | Caractères, mots ou lignes | MEDIUM | TOKENS |

## Regenerate, verify, package

Run from the repository root:

```text
node examples/td-problems/generate.mjs
node examples/td-problems/verify.mjs --cc gcc
node scripts/package-problem-bank.mjs examples/td-problems backend/src/main/resources/seed/td-problems.json
```

The problem folders and the generated bank are **not committed** (git ignores them). Load the bank on any
server through the website: **Problem lab -> Bulk import**, choose `examples/td-problems/problem-bank.import.json.gz`
(0.1 MB), pick **Validate, approve and publish to Practice**, and Import. Each problem carries its TD number,
position and topics, so it lands in the **TD** section instead of Practice. Existing slugs are skipped.

Optional automatic install: copy the packaged file to `backend/src/main/resources/seed/td-problems.json.gz` before
building the backend (that path is git-ignored too); the backend then installs it at start-up.
`CP_SEED_TD_PROBLEMS=false` turns this off.

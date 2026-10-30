# Bulk problem import

1. Deploy the updated backend and frontend (no database migration is needed).
2. Generate the bank from the repository root:

   ```sh
   node scripts/package-problem-bank.mjs
   ```

3. Sign in as a problem setter or administrator. Open **Problem lab → Bulk import** (`#/admin/problems/import`).
4. Choose `examples/problem-bank.import.json.gz` (the smaller compressed file) or `examples/problem-bank.import.json`. Both contain the same 20 generated problems plus the original Even Sum: **21 problems and 420 tests**. Select the actual file rather than copying its preview. Review the selected rows.
5. Choose what to do after import, then click **Import**:

   - **Save drafts only** requires no online judge.
   - **Validate reference solutions** seals each imported draft and runs the reference against every test.
   - **Validate and approve for contests** also approves passing versions (administrators only).
   - **Validate, approve and publish to Practice** also makes passing problems visible to participants (administrators only).

Keep the tab open. The importer processes one problem at a time. Existing slugs are skipped, including Even Sum if you already created it; nothing is overwritten. Select individual rows to import a smaller batch.

Each problem draft is saved in one database transaction, with its statement, limits, tests, sample flags and accepted reference solution. Bad data rolls back that problem without leaving an empty draft. An error on one row does not discard other successful imports. Stop prevents further steps, but a request or judge job already in progress may finish. Retry on the same page resumes a saved version without creating another problem. After reopening the page, previously imported slugs are skipped; open them from the lab to continue validation or review.

Validation uses the existing internal judge, runtime checks and approval gates. Every allowed language must have an enabled, verified online internal worker. Failures remain available for inspection; failed validation cannot be approved or published. Leaving or refreshing the page stops the browser queue, not work already accepted by the server. **Open** links display individual versions in a new tab.

The package contains private test data and reference solutions. It is deliberately not placed in the frontend public directory. Algorithm explanations from the generated manifests are saved in private setter notes, not public statement notes. The status polling endpoint returns no tests or source code.

## Format and limits

The file is JSON with `format: "infom4th.problem-bank"`, `version: 1`, and a `problems` array (1–100 items). Each problem has the normal wizard fields, inline `tests: [{input, expected, sample}]`, and `reference: {label, language, sourceCode}`. See `scripts/package-problem-bank.mjs` for the conversion from file manifests. Paths in manifests are resolved only within their problem folder; the exporter never executes solutions.

Banks are limited to 64 MiB in the browser. Each problem is sent separately under the existing 20 MiB API request limit. Test suites are bounded at **16 MiB per problem** (raised from 4 MiB because several supplied suites are larger). The packager sets a sufficient output limit for each problem's largest expected output, with a small margin. Exact test whitespace is preserved; samples and hidden tests remain separate flags.

Regenerate the files after adding or changing problems. The packager verifies both the JSON file and its gzip copy after writing. The importer detects gzip from its header, accepts UTF-8 BOMs, and enforces the 64 MiB limit on decompressed data too. It reports incomplete JSON, damaged gzip, and invalid UTF-8 separately. If a preview will not open the large JSON, use the smaller `.json.gz` file directly in Bulk import; manual decompression is unnecessary with the updated frontend.

The example folders and generated banks are local files ignored by git; keep or transfer the bank separately when deploying from another machine. The implementation, packager and this guide are tracked source files.

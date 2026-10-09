# Zoho Workload Report QA — complete bundle (08-10-2026)

| Folder | What it is |
| --- | --- |
| `workload-playwright/` | Playwright suite (147 tests). Open this folder in VS Code; `CLAUDE.md` gives a new Claude session the full context. |
| `spreadsheets/` | `workload_full_coverage_import.xlsx` (111 tasks; Tasks sheet only — import this one) · `workload_full_coverage_expected.xlsx` (expected daily/weekly/monthly values, formulas, verification vs the report) · `workload_api_run_results.xlsx` (API run on NI-8: step log, 249 cases, findings) |
| `skill/` | `zoho-workload-report-qa.skill` (installable, updated today) and its `source/` |
| `data-tools/` | Python scripts that build the import/expected workbooks and the case data: `build.py <original.xlsx> <expected.xlsx> <import.xlsx>`, `add_verification.py`, `check.py`, `gen_cases.py`, `build_results.py`, plus `runner_compact.js` (in-browser case runner) |
| `reports/` | Skill eval review page and the eval workspace |
| `playbook/` | The Claude Docs playbook exported as Markdown, Word and PDF (41 pages). Live version: https://claude.ai/code/artifact/6b0f71ff-afd7-4113-9a01-90e784d56d16 |

`workload-playwright/` now also contains a pre-filled `.env` (portal customworkload, CP profile, NI-2; no secrets) and `node_modules` (installed with Node 22 / npm 10; pure JavaScript, works on macOS/Windows/Linux). After unzipping run `npx playwright install chromium` once — browsers are not bundled.

Saved logins are NOT included: `auth/` is empty except a README. Create them on your machine with `npm run auth` (you sign in yourself).

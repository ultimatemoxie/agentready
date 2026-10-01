# Milestone 4 — persistent report lifecycle

Date: 2026-10-01. **Result: PASS.** Milestones 1–3 scoring and detector behavior remain unchanged. No authentication, billing, LLM work, MCP execution, analytics dashboard, public deployment or scheduled rescans were added.

## Files changed

| Area | Files |
| --- | --- |
| Durable model and versions | `src/lib/types.ts`, `src/lib/versions.ts` |
| Storage boundary and validation | `src/lib/persistence/sqlite-repository.ts`, `src/lib/persistence/validation.ts` |
| Run orchestration | `src/lib/analysis/run-service.ts`, narrow run-ID injection in `src/lib/analysis/index.ts` and `src/lib/analysis/score.ts` |
| API | `src/app/api/analyze/route.ts`, `src/app/api/reports/[id]/route.ts`, `src/app/api/reports/route.ts` |
| UI | `src/app/page.tsx`, `src/app/report/[id]/page.tsx`, `src/app/report/[id]/not-found.tsx`, `src/app/reports/page.tsx`, `src/components/PendingRun.tsx`, small additions to `src/app/globals.css`, `src/lib/client/submission-gate.ts` |
| Tests and smoke scripts | `tests/persistence.test.ts`, `scripts/smoke-lifecycle.ts`, updated `scripts/smoke-public.ts`, `package.json` |
| Local setup | `.gitignore`, `README.md`, this report and `docs/milestone-4-*.txt` verification logs |

## Database and schema

Node 24's built-in `node:sqlite` provides a local durable SQLite file at `data/agentready.sqlite` by default. No new npm dependency, account or required environment variable was introduced. `AGENTREADY_DB_PATH` optionally selects another absolute local file. The repository enables WAL and a five-second busy timeout. `data/` is ignored by Git.

Database schema version **1** is applied transactionally on first open with `PRAGMA user_version`. The single `analysis_runs` table has:

- identity and input: `id`, `input_url`, `normalized_url`;
- lifecycle: `status`, `created_at`, `started_at`, `completed_at`, `failed_at`;
- reproducibility: `analysis_version`, `scoring_version`, `detector_version`, `schema_version`;
- summary: `overall_score`, `raw_score`, `coverage`, `coverage_status`;
- failure: `error_code`, `error_message`;
- structured snapshots: `request_metadata_json`, `crawl_summary_json`, `report_data_json`.

An index orders recent runs by creation time and ID. `report_data_json` stores the full report snapshot, including visited and failed/skipped resources, evidence records, detected signals, rule states, category/raw/normalized scores, coverage, recommendations, unknown checks, limitations and timestamps. Request metadata contains only a `source` enum; no IP, cookies, authorization headers or request headers are retained. Failure messages come from a fixed safe-code mapping, never from arbitrary exception text or stack traces.

`AnalysisRepository` defines async `createRun`, `markRunning`, `saveResult`, `saveFailure`, `getById` and `listRecent`. The analyzer knows no SQLite types. Version constants are explicitly set to analysis **1.0.0**, scoring **1.0.0**, detector **1.0.0** and report schema **1**. They are independent of the package version and stored per run. Historical report reads validate and render saved JSON; they do not invoke the current analyzer, detector or scorer. Future database changes need numbered migrations and future report formats need retained version-specific readers. An unsupported schema or corrupt record fails safely.

## Lifecycle and API

After bounded JSON request validation, `POST /api/analyze` inserts a `QUEUED` row and assigns a UUID **before** URL-policy validation or network work. A valid normalized public URL moves the row to `RUNNING`. The existing analyzer receives the pre-created run ID; its finished report is atomically stored as `COMPLETE` or `PARTIAL` from `analysisStatus`, independent of the numeric readiness band. Exceptions become `FAILED` rows with a safe error code/message. Unsafe URLs are retrievable failures with `normalizedUrl: null`. An unhandled process exit leaves the existing row; a read after two minutes marks a stale queued/running row `FAILED / INTERRUPTED`. This is local lazy recovery, not a background queue.

The API contract is:

| Endpoint | Behavior |
| --- | --- |
| `POST /api/analyze` | HTTP 201 after bounded analysis; `{ id, status, reportUrl, errorCode, errorMessage }` and `Location: /report/[id]`. Body validation errors return 400/413 before creating a run. |
| `GET /api/reports/[id]` | `{ run }`, including full report or safe failed state; unknown ID 404; corrupt record controlled 500. |
| `GET /api/reports` | Latest 20 local run summaries. |
| `/report/[id]` | Server-renders stored report, running or failed state; no crawl on refresh. |
| `/reports` | Minimal local recent-run list. |

The homepage has a submission gate and disabled button during a request. It navigates to the returned report URL after POST. One submission action cannot start multiple POSTs through double clicks or re-renders; deliberate repeat analyses create distinct IDs. Pending report pages poll saved status and refresh when the run finishes. No browser automation or background worker was added.

## Validation and tests

Stored report validation runs both before write and after read. It checks required report fields, seven category maxima, category and overall raw/evaluated/coverage/normalized math, rule states, unique evidence IDs, eligible references for earned points, research rule-state agreement and recommendation state. Row summaries are checked against the JSON snapshot. Invalid JSON, missing fields or mismatched references yield `CORRUPT_RECORD`; the API exposes a safe message rather than internal data.

`npm test`: **87/87 PASS**, retaining all 78 Milestones 1–3 tests and adding nine lifecycle tests. New tests cover creation visible as `RUNNING` before the injected analyzer resolves, complete retrieval, restart persistence with no rerun or score drift, partial report and unknown checks, safe analysis/unsafe-URL failures, stale-run recovery, same-URL distinct IDs and explicit versions, missing/corrupt records, invalid evidence/category math, and the single-submission gate. The automated suite uses deterministic fixtures and temp SQLite files; it does not need the public internet.

`npm run typecheck`: **PASS** (strict TypeScript). `npm run lint`: **PASS** (37 TypeScript files; repository's existing AST lint). `npm run build`: **PASS**, including `/report/[id]`, `/reports` and both report APIs. Next.js worker execution needed the previously approved sandbox escalation after `spawn EPERM` in the restricted environment. No source or test assertion from Milestones 1–3 was weakened.

## Compiled production smoke and restart

The compiled local server on `http://127.0.0.1:3007` analyzed [example.com](https://example.com) through the real `POST /api/analyze` route. It returned run `9d214f13-3663-4224-a526-5e09dd2ed6e0`, `/report/9d214f13-3663-4224-a526-5e09dd2ed6e0`, `PARTIAL`, score **7**, coverage **86%**, and all four version fields. This partial status reflects five unknown offering checks even though weighted coverage is above the normal score-display threshold. The saved report contained three evidence records. Repeated API GETs were byte-equivalent after JSON parsing, and the HTML report route returned 200 with the stored ID and business name.

The server was stopped and restarted. The same ID, status, score, coverage, version fields and report fingerprint were retrieved without submitting or crawling again. The SHA-256 fingerprint of saved report JSON remained `37ba6c86d9b2c9ecc8bb58926c4945b5518743bf2cd3b38e5e18e6cc7d4c8203`. After the final validator change and a fresh production build, the same fingerprint was verified again.

Other compiled API checks passed:

- `http://127.0.0.1/` produced a saved `FAILED / UNSAFE_URL` run (`b8773e65-849e-4c21-b218-2c6aeb62d218`) and an inspectable failure page, without connecting to the blocked address.
- A missing UUID returned **404** from both the API and page route.
- A second example.com submission produced a different saved run ID (`42a74cd9-4089-4a9e-8aec-247f18feb41e`). The recent-run API and page displayed these local runs.

Detailed outputs are in `docs/milestone-4-submit-smoke.txt`, `docs/milestone-4-restart-smoke.txt`, `docs/milestone-4-final-rebuild-smoke.txt`, `docs/milestone-4-api-smoke.txt` and `docs/milestone-4-tests.txt`. The local smoke database remains at `data/agentready.sqlite` for inspection; it is Git-ignored. Nothing was deployed.

## Known limitations

- SQLite is intended for a single local installation. This design has no cross-host coordination, public access control, retention policy, backup automation or distributed idempotency. If the client retries a POST after a lost response, it can create another run; deliberate same-URL submissions always create distinct runs.
- The API waits for the bounded analysis before returning its ID. The row exists first, but the browser sees the link only after the request resolves. A future queue could return immediately; none was added here.
- Process death cannot execute a catch block. Stale queued/running rows are recovered lazily on later read after two minutes. If no later read occurs, the row remains inspectable in its prior lifecycle state.
- The saved JSON snapshot preserves evidence and score output, not the exact historical renderer code or the source site's HTML. Historical presentation can change if UI code changes, though data is never rescored on read.
- Validator version 1 accepts only the current report schema. Future releases must retain a version-1 reader for older snapshots and add migrations for database schema changes.
- The unauthenticated report routes are suitable only for local development. Public deployment needs authorization, abuse limits, privacy/retention decisions and durable operational storage before exposure.

**Milestone 4 objectively passes the requested acceptance gates. Stop here pending approval for further work.**

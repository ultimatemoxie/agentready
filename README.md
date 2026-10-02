# AgentReady by Myric — Research Preview

An experimental public website diagnostic for the question: **Can AI agents understand and interact with this business?** AgentReady checks public identity, offerings, discovery, trust, contact, action and transaction signals. Every positive score rule points to source evidence; analysis coverage shows which checks could actually be completed.

**AgentReady is an experimental research tool. It does not define an industry standard and does not guarantee ranking, discovery, recommendation, compatibility, or performance inside ChatGPT, Google, Claude, Meta, Muse, or any other AI platform.**

## Run locally

Requires Node.js 24 or newer and npm. From this directory:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. There are **no required environment variables for local development**. The local SQLite database is created automatically at `data/agentready.sqlite` on the first analysis; `data/` is Git-ignored. The app makes outbound requests only when a user submits a public URL.

Development-only fixture reports are available at `/dev/fixture/ecommerce`, `/dev/fixture/service`, `/dev/fixture/nigerian-sme`, and `/dev/fixture/ambiguous`. They are labeled fixture data and return 404 in production. Their HTML lives in `tests/fixtures`.

Verification:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run start
```

`lint` is a small zero-dependency TypeScript AST check for parse errors, `debugger`, and `eval`; `typecheck` performs strict compiler validation. The portable `package-lock.json` pins the installation used for deployment.

## Production deployment

Production on Vercel requires a **dedicated AgentReady Supabase/Postgres project**. The existing `AnalysisRepository` interface selects the server-only Supabase Data API adapter when both `AGENTREADY_SUPABASE_URL` and `AGENTREADY_SUPABASE_SECRET_KEY` are set. Vercel without those values fails closed and never writes to its ephemeral filesystem. Local development continues to use SQLite unless both variables are set. Do not reuse an unrelated database project.

1. Create/select the AgentReady Supabase project and apply `supabase/migrations/20261001000000_agentready_analysis_runs.sql` through the Supabase SQL editor or migration tooling. Review the migration first. Ensure the project's Data API exposes the `public` schema. The migration enables RLS, grants table access only to the `service_role`, and blocks updates to terminal historical runs.
2. Set `AGENTREADY_SUPABASE_URL` and `AGENTREADY_SUPABASE_SECRET_KEY` as **server-only** Vercel environment variables. Use a dedicated Supabase `sb_secret_...` key. Never add them to `NEXT_PUBLIC_*`, source control, or browser code. See `.env.example` for placeholders.
3. Connect the GitHub `main` branch to a Next.js Vercel project, select Node.js 24, then deploy. The `/api/analyze` route allows 90 seconds so its existing 60-second crawler budget can persist a terminal result.
4. Verify submit → `/report/[id]` → refresh → new deployment → same stored report. Repeated analyses intentionally create distinct IDs. `/api/reports/[id]` reads the same durable record by ID.

The migration is reproducible SQL, but this repository does not automatically run migrations during `next build`; apply it before the first production request. The Data API is reached only by server code over HTTPS, with the secret on the `apikey` header. A failed storage request returns a generic error without the database response body or credentials. Public analysis remains unauthenticated and consumes outbound crawl work, so configure hosting-level abuse controls and monitor usage before sharing the preview widely. Supabase secret keys bypass RLS and must be rotated if exposed. See the [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys) and [Data API security guidance](https://supabase.com/docs/guides/api/securing-your-api).

Current limits: JavaScript-rendered content and authenticated actions are not analyzed; price and action signals are observational, not proof that checkout or booking works. A saved report is a historical snapshot and is never recomputed on read. Direct report URLs are accessible to anyone who has the link; there is no public report directory. Do not submit a URL whose public evidence you would not want visible in a report.

## Architecture

- `src/app/(home)/page.tsx` and `src/components/ReportView.tsx`: accessible responsive submission and report interface.
- `src/app/api/analyze/route.ts`: bounded request parsing and JSON response.
- `src/lib/analysis/url.ts`: URL policy and public DNS validation.
- `src/lib/analysis/iana-address-policy.ts`: checked-in IANA special-purpose/global-unicast policy snapshot.
- `src/lib/analysis/budget.ts`: shared deadline, cancellation and response-byte accounting.
- `src/lib/analysis/fetch.ts`: pinned-address HTTP(S) request, redirect validation, time and size limits.
- `src/lib/analysis/crawl.ts`: robots, sitemap and llms checks, homepage and up to four linked relevant pages.
- `src/lib/analysis/extract.ts`: HTML, metadata, links, forms, JSON-LD and direct contact extraction.
- `src/lib/analysis/classify.ts`: objective signals, cautious inferences and typed business profile.
- `src/lib/analysis/scoring-context.ts`: evidence eligibility and inspected-resource context for each scoring rule.
- `src/lib/analysis/score.ts`: explicit point rules, coverage-aware score math, status bands and recommendations.
- `src/lib/analysis/run-service.ts`: create-before-analysis lifecycle and safe failure handling.
- `src/lib/persistence/sqlite-repository.ts`, `supabase-repository.ts`, `repository.ts` and `validation.ts`: local and production persistence behind one repository interface, report validation and retrieval.
- `src/app/report/[id]` and `src/app/api/reports/[id]`: stored report views retrievable by ID. The repository retains `listRecent` for internal research; no public listing route exposes it.
- `src/lib/types.ts`: report, evidence, research flag and future repository interfaces.

No external database account or LLM is required **locally**. Production requires the dedicated database above. `AnalysisRepository` isolates persistence from the crawler and scorer. Full reports and failures survive browser refresh and server restarts. `AnalysisRun.researchRuleStates` preserves each rule's four-state outcome for later aggregate research; legacy `researchSignals` booleans remain for compatibility and should not be used to infer absence.

## Scoring rules

Every rule has a deterministic public-signal condition, an evidence-backed state and an explicit point weight. Points are awarded only for `DETECTED` with eligible high/medium-confidence evidence. `NOT_DETECTED` earns zero only after relevant content was inspected. `UNKNOWN` and `NOT_APPLICABLE` earn no numeric points and are excluded from the evaluated denominator. No LLM judgment affects the score. The wording, rationale and recommended action for every rule are in `src/lib/analysis/score.ts`; inspected-context logic is in `src/lib/analysis/scoring-context.ts`.

| Category | Max | Rules and points |
| --- | ---: | --- |
| Identity | 15 | Name 3; description 2; contact 2; location 2; identity schema 3; canonical 3 |
| Offering | 15 | Named offerings 4; descriptions 3; categories 2; prices 3; identifiers/availability 3 |
| Discovery | 15 | Metadata 3; canonical 3; sitemap 3; JSON-LD 3; robots 2; llms.txt 1 |
| Trust | 15 | HTTPS 3; privacy 3; terms 3; return/cancellation 3; support 3 |
| Communication | 10 | Email 3; phone 2; WhatsApp 2; contact flow 2; social 1 |
| Actionability | 20 | Booking/quote/order 5; purposeful form 3; action CTA 3; search 2; contact/support 3; API docs 2; account 2 |
| Transaction | 10 | Price 3; cart/checkout 3; payment indicator 2; purchase CTA 2 |

Status bands: 0–29 Low readiness, 30–49 Early, 50–69 Developing, 70–84 Strong foundation, 85–100 Highly actionable. The fixed rubric is deliberately simple. `NOT_APPLICABLE` is supported in the calculator, but production does not yet infer it from business type because the current classifier cannot establish applicability reliably.

### Milestone 3 scoring and coverage contract

Each of the 38 rule results includes its stable `ruleId`, name, category, maximum points, state, nullable `pointsEarned`, eligible evidence IDs, inspected source URLs and a reason. A positive result without high/medium-confidence source evidence becomes `UNKNOWN`. Failed, skipped or unparseable relevant checks remain `UNKNOWN`; they do not become deficiencies. A successful scoped inspection with no qualifying signal becomes `NOT_DETECTED`. `NOT_APPLICABLE` is reserved for unquestionably established context and is not assigned automatically in this release.

The score uses the existing 100-point rule weights. The formulas use unrounded values internally:

```text
applicable weight = sum of max points for rules other than NOT_APPLICABLE
evaluated weight  = sum of max points for DETECTED + NOT_DETECTED rules
earned raw points = sum of max points for DETECTED rules with eligible evidence
analysis coverage = evaluated weight / applicable weight × 100
normalized score  = earned raw points / evaluated weight × 100
```

The headline readiness score is the normalized score rounded to a whole number when coverage is at least 50%. It is `null` below 50%, and the report says that coverage is insufficient for a reliable overall score. A zero evaluated denominator also yields no headline score. The unrounded normalized score, raw score, evaluated/applicable weight and per-rule decisions remain in the report data for audit; the low-coverage UI does not present the internal normalized value as a readiness conclusion. Coverage counts also show all 38 rule states and successfully analyzed, failed and skipped HTML pages. The score is conditional on checks performed; coverage must always be read alongside it.

For each category, raw earned points and evaluated/applicable points remain available. Category coverage is evaluated/applicable × 100. The category normalized value is raw/evaluated × its original category maximum. **Category normalized values are diagnostic and should not be summed**: the overall normalized score uses total raw/evaluated weights across all seven categories. The seven maxima remain 15, 15, 15, 15, 10, 20 and 10.

Coverage bands use weighted rule points so an unknown five-point action rule matters more than an unknown one-point optional llms.txt check. At **75% or higher**, the standard readiness band is displayed; this leaves at most one quarter of rubric weight unobserved. At **50–74%**, the numeric score is labeled a provisional partial analysis. Below **50%**, unknown weight exceeds evaluated weight, so the headline score is suppressed. These are transparent product thresholds, not calibrated statistical confidence levels. `AnalysisRun.status` retains the bounded crawler's legacy completion status; `analysisStatus`, `coverage`, `analysisLimitations` and the visible score label describe report completeness. A bounded crawl can finish normally while many relevant pages remain unchecked.

Recommendations are generated only from `NOT_DETECTED` rules. Each recommendation carries the related rule IDs, inspected source URLs and absence reason. `UNKNOWN` appears under analysis limitations instead; a sitemap timeout, for example, cannot recommend publishing a sitemap. The report UI shows coverage, rule states, category math and limitations without changing the underlying category weights. This keeps a technical failure separate from a business deficiency.

## Milestone 4 — saved analysis lifecycle

The homepage submits once and navigates to `/report/[id]`. Each request gets a new UUID before URL-policy validation, DNS, or crawling. The local repository transitions `QUEUED` → `RUNNING` → `COMPLETE` or `PARTIAL`; failures become `FAILED` with a safe code and message. A report is `PARTIAL` when its analysis status reports incomplete coverage or checks, independent of the score band. A failed public-URL policy check is also retained as a failed run. Runs interrupted by a process exit remain inspectable; after two minutes, a read marks an unfinished run `FAILED / INTERRUPTED`. The analysis itself remains synchronous within the existing 60-second budget; no job queue or scheduled worker was added.

`POST /api/analyze` accepts `{ "url": "https://example.com" }` and, after the bounded analysis, returns HTTP 201 with `{ id, status, reportUrl, errorCode, errorMessage }`. Once a run exists, failures also return an ID and report URL. Malformed/oversized request bodies return 400/413 before run creation. `GET /api/reports/[id]` returns `{ run }`, including the persisted full report or safe failure; unknown IDs return 404 and corrupt records a controlled 500. The public `/reports` and `GET /api/reports` listing routes are absent. Report reads use `no-store`; refreshing `/report/[id]` loads saved JSON and does not re-crawl or re-score. Repeating the same URL deliberately creates a new run.

The SQLite file defaults to `data/agentready.sqlite`. Set optional `AGENTREADY_DB_PATH` to an absolute local path if you need a separate development database. Node.js 24's built-in `node:sqlite` is used; no new npm dependency or cloud setup is required. The repository enables WAL and a five-second busy timeout. On first open it transactionally applies database schema version 1 using `PRAGMA user_version`. The `analysis_runs` table stores ID, input/normalized URL, lifecycle status/timestamps, explicit versions, score/coverage summaries, safe error fields, minimal request metadata (`source` only), crawl summary and complete report JSON. Future schema changes require numbered migrations; a database from a newer schema version is refused rather than rewritten.

Explicit `ANALYSIS_VERSION`, `SCORING_VERSION`, `DETECTOR_VERSION` and `REPORT_SCHEMA_VERSION` constants are saved on every run. They are independent of the package version and must be bumped deliberately when output semantics change. Historical reports are validated and rendered from their saved snapshot; retrieval never invokes the analyzer or current scoring rules. Version 1 validation checks required fields, category and coverage math, eligible evidence references, research rule states and recommendation states. Unsupported or corrupt snapshots return controlled errors.

To reset **local development data**, stop the server and remove `data/agentready.sqlite`, `data/agentready.sqlite-wal` and `data/agentready.sqlite-shm` (or the corresponding files at your configured path). The next start creates a fresh version-1 database. This deletes saved local reports, so copy the database first if you need them. No cookies, authorization headers, secrets or stack traces are persisted. The unauthenticated routes and local SQLite file are intended for development and evaluation, not public deployment or multi-host storage.

Lifecycle verification against a compiled local server:

```bash
npm run build
npm run start -- -p 3007
npm run smoke:lifecycle -- submit http://127.0.0.1:3007 https://example.com
# Stop and restart the server, then use the printed ID and SHA-256 fingerprint:
npm run smoke:lifecycle -- verify http://127.0.0.1:3007 RUN_ID SHA256
```

## Fetch safety and limits

- HTTP/HTTPS only, standard web ports, no embedded credentials. URL normalization removes fragments and trailing hostname dots and uses the URL parser's canonical host/port representation.
- Public-address classification uses the IANA IPv4/IPv6 special-purpose registries with longest-prefix matching. Special-purpose ranges require an explicit `Globally Reachable = True`; false, blank and indeterminate entries are blocked. IPv4 multicast/reserved space is blocked. IPv4-mapped IPv6 inherits the underlying IPv4 policy. IPv6 must additionally belong to an IANA allocated global-unicast prefix. NAT64, Teredo, 6to4 and unallocated IPv6 space are conservatively excluded.
- Sources: [IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry/), [IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/), [IPv6 allocations](https://www.iana.org/assignments/ipv6-unicast-address-assignments/). The snapshot includes its retrieval time and source URLs. `ipaddr.js` is used for parsing, not its incomplete `unicast` classification.
- Every DNS answer must pass the policy before connection; a mixed public/blocked answer set is rejected entirely. Validated addresses are pinned into Node's lookup callback, supporting both single-address and `all: true` shapes. A fresh connection is used for each request. Every redirect URL and DNS answer set is revalidated.
- Homepage redirects may establish a new public origin, including apex-to-www and HTTP-to-HTTPS. Robots rules are checked for each homepage origin before its page is loaded. Secondary HTML, discovery files and their redirects remain within their allowed origin. External secondary redirects are stopped before connection and recorded in warnings. A public HTTPS-to-HTTP homepage redirect is currently permitted and remains visible in the final URL; no TLS verification is disabled.
- Homepage plus at most four relevant pages; no recursive crawl. Normalized URLs and visited redirect destinations are deduplicated. Known mutation/logout/action URLs are skipped before DNS/connection. No forms are submitted and no action flows are tested.

| Budget | Default |
| --- | ---: |
| Absolute request deadline, including DNS/TCP/TLS/body | 10 seconds per redirect hop |
| DNS lookup deadline | 3 seconds |
| Total analysis/crawl deadline | 60 seconds |
| Redirects | 3 per resource |
| Response payload | 1,000,000 bytes |
| Aggregate response payload across the run | 6,000,000 bytes |
| HTML pages | 5, including homepage |
| Response headers | 16,384 bytes per response |
| Inbound API body | 4,096 bytes / 5 seconds |

The total budget includes discovery resources, redirect attempts and failed responses. Redirect bodies are discarded immediately rather than downloaded. Discovery checks add at most one robots resource per homepage redirect origin plus sitemap/llms checks. Streaming data cannot extend deadlines. Deadline/aggregate-limit failures after a usable homepage return a partial report; failure before usable HTML returns a controlled error. Caller cancellation aborts analysis and active HTTP requests. The API passes `Request.signal` and starts the total budget before reading the body; its hosting duration allowance is 65 seconds to leave response overhead after the 60-second budget.

### Integration and manual smoke tests

`npm test` runs the existing tests plus `tests/fetch-crawl.test.ts`, using the production URL policy, DNS validation, pinned lookup, native HTTP response handling, crawler and analysis entry point. Only DNS records and connection routing are substituted: validated public addresses are routed to an ephemeral loopback fixture server. There is no environment flag or HTTP parameter that disables SSRF checks. Node's test isolation is disabled so the suite also runs in environments that restrict child-process spawning. Automated tests never require the public internet.

Optional real-network checks:

```bash
npm run smoke:public -- https://example.com https://basecamp.com
# Against a running local production server:
npm run start -- -p 3001
npm run smoke:public -- --api http://127.0.0.1:3001 https://example.com https://basecamp.com
```

Refresh the standards snapshot deliberately, review the generated diff, and rerun security tests before accepting it:

```bash
npm run security:update-ip-policy
npm test
```

### Milestone 1 verification — 2026-09-28

Verified on Node 24.18.0 / Next.js 16.2.10:

| Check | Result |
| --- | --- |
| Automated tests | 36 passed: 9 existing + 27 security/fetch/crawl tests |
| Strict typecheck / custom lint | Passed / passed (17 TypeScript files) |
| Production build | Passed; restricted-shell attempt hit `spawn EPERM`, then approved build-worker execution succeeded |
| Compiled `POST /api/analyze`: `https://example.com` | Complete report, homepage HTTP 200, no warnings, 4,532 ms |
| Compiled `POST /api/analyze`: `https://basecamp.com` | Complete report, 5 HTML pages plus robots/sitemap, no warnings, 5,393 ms |
| Compiled API: private/benchmark/discard-only IPs and file scheme | HTTP 400 `UNSAFE_URL` |
| Compiled API: slowly streamed inbound body | HTTP 408 `TIMEOUT`, 5,021 ms |

The optional direct-entry smoke also completed Basecamp in 17,797 ms. An initial example.com attempt produced a valid partial report when its sitemap timed out; the later compiled-API attempt completed. `https://www.monzo.com` failed with a controlled request `TIMEOUT` after 18,224 ms rather than returning a report. Live network timings vary; these results establish the Milestone 1 path, not universal website compatibility or detector accuracy. No deployment or Milestone 2 work was performed.

## Known limits

- JavaScript-rendered content is not executed. Websites that require browser rendering can appear sparse.
- Detection is intentionally conservative but still heuristic for names, scoped offering cards, action paths and form purpose. Provider indicators require recognized resource URLs rather than bare mentions. A payment provider reference does not prove checkout works.
- robots.txt parsing covers common user-agent, allow and disallow rules. It does not implement the full wildcard and URL matching specification.
- Analysis is anonymous and saved in a single local SQLite file. Stable local report URLs and a recent list exist; access control, cloud sharing, accounts, scheduled checks and aggregate dashboards do not.
- The API has no distributed rate limit, which should be added before public deployment.
- IANA classifications are a reviewed snapshot, not a live routing guarantee. New assignments require a snapshot update. Conservative IPv6 filtering can reject some globally classified transition/translation destinations. Deployment egress routing/firewall policy remains outside this application-level check.
- OS DNS lookups cannot be forcibly interrupted by `dns.lookup`; deadlines detach waiting and prevent subsequent connections. Active HTTP sockets are destroyed. Request-disconnect cancellation depends on the hosting runtime delivering `Request.signal`.
- Deadlines interrupt asynchronous network work; synchronous extraction/scoring cannot be preempted within the same Node event loop. Their input is bounded by page and byte limits. Compressed responses are still rejected rather than decompressed.
- Mutation detection covers obvious URL conventions, not every site's possible GET side effect. Robots matching remains the MVP implementation; detector evidence rules are documented below.
- The report does not submit forms, book services, place orders or test APIs/MCP/A2A functionality.

## Suggested v0.2 work

1. Add hosted rate limiting, concurrency budgets and observability for public rollout.
2. Add authenticated organizations, retention controls and an intentional sharing policy before publishing saved report URLs.
3. Add industry-specific scoring applicability and sample-based validation across African and global business sites.
4. Improve catalog and pricing extraction, including structured feeds and JavaScript-rendered pages under a safe browser budget.
5. Add opt-in, non-transactional action-path tests and explicit API/MCP/A2A capability validation.

## Milestone 2 — evidence correctness

### Model and provenance

Every observation is a Zod-validated `EvidenceRecord`: `id`, `type`, `value`, `sourceUrl`, `sourceType`, `rawEvidence`, `detector`, `confidence`, and optional typed details. IDs hash the normalized record including its source. Identical values on separate pages keep separate records. Snippets are capped at 500 characters and values at 1,000; full HTML is not returned. Structured snippets use vocabulary-expanded property names and the actual extracted values. Forms expose purpose, public action, method and control names/types, not submitted or hidden field values.

`BusinessProfile.evidence`, `AnalysisRun.detectedSignals` and `TechnicalEvidence.records` preserve those records. Every earned report rule contains supporting `evidenceIds` and a human-readable source/snippet. The expandable Technical Evidence section shows values, sources, snippets, detector and confidence. Score weights remain unchanged.

Confidence is deterministic:

| Confidence | Meaning | Scoring |
| --- | --- | --- |
| High | Explicit validated structured property, recognized official contact/provider URL, metadata value or resource format | Eligible |
| Medium | Strong contextual HTML association, explicit form purpose, action/policy path or semantic anchor | Eligible |
| Low | Unassociated currency amount, editorial contact mention or unvalidated JSON-LD type observation | Ineligible |

High confidence describes the **observed declaration/reference**, not operational testing, ownership, accuracy, freshness or successful checkout. Homepage-title identity is medium confidence. The report does not execute actions or fetch third-party booking/payment endpoints.

### Detector contracts

- Actions use parsed path segments, explicit intent and a limited booking-provider allowlist. Facebook is never matched by the word “book”. Booking, reservation, appointment, quote, cart, checkout, purchase, search, account, contact and support remain separate evidence types.
- WhatsApp requires an official wa.me telephone/message action, official whatsapp.com send endpoint with a valid-length telephone number, or a supported whatsapp://send action. Query text, lookalike domains and ordinary WhatsApp article links do not qualify.
- Policies use complete path names, semantic anchor labels or inspected policy headings. “Return home” does not qualify. A policy link is a linked reference, not a verified policy document.
- Payment/chat/platform indicators require recognized resource hosts and paths. A bare Paystack/Stripe/Shopify mention cannot earn points. Paystack payment links remain independent of WhatsApp, offerings and cart/checkout.
- API documentation, OpenAPI, MCP references, Agent Card references and typed catalog/feed references are distinct. MCP/A2A references do not establish working protocol support. API/OpenAPI references retain the existing API-doc score; MCP/feed references do not receive that score.
- JSON-LD type IRIs must expand into the Schema.org vocabulary and appear in the checked-in official hierarchy (938 types). Root contexts, explicit @vocab, safe compact prefixes, simple term/keyword aliases and absolute IRIs are supported. Custom contexts/type overrides do not become Schema.org Organization. Exact subtype names are retained; Organization/LocalBusiness ancestry comes from the official hierarchy.
- Offerings use structured Product/Service/MenuItem/itemOffered declarations, explicit semantic cards, scoped offering lists/sections, or dedicated detail headings consistent with the page title and adjacent descriptive text. General pricing-page feature lists and promotional headings do not become products. Scoped named pricing-plan cards retain their associated amounts.
- Prices preserve amount, explicit ISO currency, offering and source. Unassociated amounts remain low confidence. ₦/€/₵ map to NGN/EUR/GHS; ambiguous $/£ retain the symbol without guessing an ISO currency. Structured graph references associate offers within the same page. SKU/GTIN/MPN/product IDs, explicit variant values and recognized availability declarations are kept separately.
- Locations use structured address fields, address elements or explicit address labels; hours require structured day/time declarations or a labeled weekday/time range. Arbitrary place mentions, article numbers, years and unlabeled telephone-like digits are insufficient.

The hierarchy is derived from the [official Schema.org vocabulary](https://schema.org/version/latest/schemaorg-current-https.jsonld). Refresh with `npm run schema:update-types`, review the generated diff and rerun tests. No remote JSON-LD context is fetched during analysis; this is a bounded supported subset, not a general JSON-LD processor.

### Coverage and unknown values

`TechnicalEvidence.resourceChecks` records INSPECTED, NOT_FOUND, UNKNOWN or NOT_CHECKED for each attempted/skipped HTML/discovery resource, with URL, status and reason. `checks` records DETECTED, NOT_DETECTED, UNKNOWN or NOT_CHECKED, plus source/evidence IDs. Page-level absence is scoped to successfully parsed pages. Failed contact/pricing pages, invalid JSON-LD and crawl-budget exclusions do not become absence claims. HTML fallback discovery pages do not earn robots/sitemap/llms points.

Aggregation is deliberately conservative: an incomplete page or parser check can leave otherwise missing fields unknown. Positive evidence survives partial failures. Legacy boolean research flags and fixed scoring/recommendations remain for compatibility; **Milestone 3 must consult coverage checks before treating false flags as business deficiencies**. No unknown-aware score normalization or recommendation overhaul was implemented here.

### Regression fixtures

All fixtures are development/test data:

| Fixture | Result |
| --- | --- |
| ecommerce.html | Woven Basket; 12500 NGN with Offer/Product provenance; identifiers/availability; cart/checkout |
| service.html + services/contact/pricing.html | Architectural design / Project consultation; booking and appointment; secondary contact and GBP price provenance |
| nigerian-sme.html | Family jollof tray; ₦18,000 associated with NGN; independent WhatsApp and Paystack; labeled Abuja address/hours |
| noisy.html | Facebook social reference only; no booking/WhatsApp/policy/schema identity or article-price scoring false positives |
| partial.html | Homepage findings survive; failed contact/pricing evidence checks UNKNOWN |
| pricing-noise.html | Studio plan with $59 association; feature descriptions and footer headings excluded |

`tests/evidence.test.ts` covers false positives, vocabulary/context handling, subtype inheritance, secondary-page sources, graph-linked Product/Offer, currencies, identifiers/variants, hours/locations, distinct endpoints, low-confidence exclusion and unknown coverage. The native HTTP integration in `tests/fetch-crawl.test.ts` also verifies provenance and failed-page checks through the real DNS/fetch/crawl/analysis path. Public internet is optional and never required by `npm test`.

### Remaining limits specific to evidence

- A declared URL/form/schema value may be stale, misleading or malicious. Ownership, capability execution, policy contents and price freshness are not validated.
- Unfamiliar markup, JavaScript-rendered content, unsupported remote/scoped JSON-LD contexts, cross-page graph IDs, unassociated prices and many natural-language addresses/hours will be missed intentionally.
- Path/anchor/form/card heuristics still need evaluation against a labeled business corpus. Medium confidence does not imply statistical calibration.
- Sitemaps are checked for a recognized root/namespace, not full XML/feed validation. MCP, Agent Cards and feeds are references only. Linked secondary pages remain bounded by Milestone 1 safety limits.
- This milestone adds evidence coverage without changing score applicability, unknown-aware scoring or recommendation behavior. Persistence, authentication, LLMs, integrations, public reports and deployment remain out of scope.

### Milestone 2 verification — 2026-09-28

Node 24.18.0 / Next.js 16.2.10. Final results:

| Command/check | Result |
| --- | --- |
| npm test | PASS: 59 tests (36 existing + 22 evidence regressions + 1 native HTTP provenance integration) |
| npm run typecheck | PASS: strict TypeScript |
| npm run lint | PASS: 23 TypeScript files; existing custom AST lint, not ESLint |
| npm run build | PASS: production compile, TypeScript and static generation; worker execution required approved sandbox escalation after initial spawn EPERM |
| npm run schema:update-types | PASS: 938 official Schema.org types recorded |
| Compiled POST /api/analyze — example.com | Complete; 1 HTML page; 3 evidence records; 1,980 ms; no warnings |
| Compiled POST /api/analyze — Basecamp | Complete; 5 HTML pages; 92 evidence records; 6,310 ms; five named plans and associated paid-plan amounts; no warnings |
| Compiled POST /api/analyze — Porkbun | Complete; 5 HTML pages; 176 evidence records; 30,330 ms; unfamiliar offerings/amount associations omitted; no warnings |

The compiled API checks ran on `http://127.0.0.1:3003` using `npm run smoke:public -- --api http://127.0.0.1:3003 https://example.com https://basecamp.com https://porkbun.com`. Every returned record passed evidence validation, had a successful source response, and every earned rule referenced non-low evidence. Full CLI output is in `docs/milestone-2-smoke-results.txt`. An earlier Porkbun run produced a controlled partial report when two secondary pages timed out; these failures remained unknown. Direct-entry smoke checks also completed all three sites.

**Milestone 2: PASS against the requested acceptance gates.** No deployment or Milestone 3 work. Passing regression/smoke checks does not establish zero detector errors on arbitrary websites.

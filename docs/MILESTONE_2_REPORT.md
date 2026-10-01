# AgentReady — Milestone 2 delivery

**Status: PASS.** Scope: extraction, classification, provenance and evidence quality only. No deployment or Milestone 3 work.

## 1. Files changed

Modified:

- src/lib/types.ts — normalized evidence, confidence and coverage models.
- src/lib/analysis/extract.ts — page-local deterministic extraction.
- src/lib/analysis/classify.ts — evidence-backed facts, distinct actions and unknown coverage.
- src/lib/analysis/crawl.ts — resource evidence, format confirmation and failed/skipped-page coverage.
- src/lib/analysis/score.ts — supporting source/snippet/ID wiring; existing weights and recommendation algorithm retained.
- src/components/ReportView.tsx — existing Technical Evidence section populated with provenance/confidence/checks.
- scripts/smoke-public.ts — source integrity and scoring-reference checks.
- tests/fetch-crawl.test.ts — native HTTP provenance/partial-check integration.
- tests/fixtures/service.html and nigerian-sme.html — explicit test offerings.
- package.json — evidence test and hierarchy maintenance commands.
- README.md — detector contracts, confidence, limitations and verification.

Created:

- src/lib/analysis/evidence.ts — Zod validation and stable source-sensitive IDs.
- src/lib/analysis/link-detectors.ts — exact link/resource classification.
- src/lib/analysis/schema.ts — supported JSON-LD context/vocabulary expansion.
- src/lib/analysis/schema-types.ts — official hierarchy snapshot.
- src/lib/analysis/structured-evidence.ts — structured property extraction and associations.
- scripts/update-schema-types.mjs — reviewed vocabulary maintenance.
- tests/evidence.test.ts — 22 regression tests.
- tests/fixtures/contact.html, services.html, pricing.html, noisy.html, partial.html, pricing-noise.html.
- docs/milestone-2-smoke-results.txt and this delivery report.

## 2. Evidence model

`EvidenceRecord`: id, type, value, sourceUrl, sourceType, rawEvidence, detector, confidence and optional amount/currency/offering/identifier/format details. All records are schema-validated. Page-local records are combined by source-sensitive IDs, preserving separate provenance for identical values. Every earned report rule references its eligible records.

HIGH = explicit validated declaration/reference; MEDIUM = strong contextual HTML association; LOW = ambiguous observation, excluded from scoring. Confidence applies to the observed reference, not verification of a working business capability. Snippets are bounded and full HTML is not returned.

`EvidenceCheck` distinguishes DETECTED / NOT_DETECTED / UNKNOWN / NOT_CHECKED. `ResourceCheck` retains inspection/failure/omission reasons. Partial findings survive; failed pages are not recorded as absent evidence.

## 3. Detectors corrected

Facebook is social, never booking. Return home is not a policy. WhatsApp requires official host/action evidence. Custom Organization vocabularies and disabled/overridden context terms are not Schema.org identity. Booking, reservation, appointment, quote, cart, checkout and other actions are separate. Payment/provider mentions alone are insufficient. API/OpenAPI, MCP, Agent Card and feeds remain separate references.

Live smoke testing found pricing feature lists/promotional headings being misclassified as offerings. The rule was tightened and pricing-noise.html now guards this case. Catalog detail URLs such as /products/book also do not become booking paths without action intent.

## 4. New extraction capabilities

Validated Schema.org inheritance (938 types), Product/Service/MenuItem offerings, in-page graph-linked Offer prices/currencies, named HTML cards/plans/lists, offering descriptions, identifiers, explicit variants/availability, structured/labeled locations and hours. Price records keep product/service association and actual source URL. Ambiguous dollar/pound symbols are preserved without inventing an ISO currency.

## 5. Regression tests

22 evidence tests cover all confirmed false positives, vocabulary/context cases, inheritance, secondary sources, duplicate-value provenance, graph associations, prices/currencies, low-confidence exclusion, location/hours, distinct endpoints/providers, malformed inputs, fixtures, pricing noise and unknown coverage. One added native HTTP integration exercises the production DNS/fetch/crawl/analysis boundary with secondary contact/Product evidence and a failed pricing page. All 36 existing tests remain green.

## 6. Fixture results

- Ecommerce: Woven Basket; 12500 NGN Offer price; identifiers/availability; cart/checkout.
- Service: Architectural design / Project consultation; booking/appointment; separate contact and GBP pricing sources.
- Nigerian SME: Family jollof tray; 18000 NGN; independent WhatsApp/Paystack; labeled Abuja location/hours; no fabricated checkout/schema identity.
- Noisy: no booking, WhatsApp, policy, Schema.org identity, article-price or unlabeled-phone scoring positives.
- Partial: valid homepage retained; failed contact/pricing checks UNKNOWN.
- Pricing noise: Studio plan and $59 association; features/footer slogans omitted.

## 7. Public smoke results

Final compiled POST /api/analyze checks on 127.0.0.1:3003:

| Site | Result | Duration | HTML pages | Evidence records |
| --- | --- | ---: | ---: | ---: |
| https://example.com | Complete, no warnings | 1,980 ms | 1 | 3 |
| https://basecamp.com | Complete, no warnings | 6,310 ms | 5 | 92 |
| https://porkbun.com | Complete, no warnings | 30,330 ms | 5 | 176 |

All evidence had successful source responses; earned rules had valid non-low evidence IDs. Basecamp's five plans and paid prices cite /pricing; its booking reference is the explicit Calendly personal demo. Porkbun's unfamiliar offering/price associations are conservatively omitted. Unselected relevant pages remain NOT_CHECKED because crawling is bounded. An earlier Porkbun run was partial after secondary timeouts, correctly represented as unknown. Full output: milestone-2-smoke-results.txt.

## 8. Quality commands

- npm test: PASS, 59/59.
- npm run typecheck: PASS, strict TypeScript.
- npm run lint: PASS, existing custom AST lint, 23 files.
- npm run build: PASS, production build. Initial restricted attempt failed spawn EPERM; approved worker execution succeeded.
- npm run schema:update-types: PASS, 938 types.
- npm run smoke:public -- --api http://127.0.0.1:3003 https://example.com https://basecamp.com https://porkbun.com: PASS.

## 9. Remaining false-positive risks

Path/anchor/card/form heuristics can still encounter misleading declarations. Website-authored schema can be stale or inaccurate. Linked social/contact identities are not ownership-verified. A linked policy, booking/provider endpoint or protocol reference does not prove its contents or functionality. Confidence has deterministic rules, not statistical calibration.

## 10. Remaining false-negative risks

JavaScript content, unusual markup, remote/scoped JSON-LD contexts, cross-page graph references, natural-language locations/hours and unassociated amounts are intentionally missed. Porkbun demonstrates an unfamiliar catalog missed by the tightened rules. Provider and booking allowlists are limited.

## 11. Known limitations

Bounded static HTML only; no actions executed. Unknown coverage is available, but legacy boolean research flags and fixed score/recommendation logic are not yet unknown-aware. Full JSON-LD expansion, feed/XML validation, operational API/MCP/A2A tests and score applicability are outside this milestone. Existing custom lint is not ESLint. Milestone 1 safety budgets remain in effect.

Run locally: npm run dev, then http://localhost:3000. No required environment variables. Production smoke: npm run build; npm run start -- -p 3003; use the smoke command above.

## 12. Acceptance

**PASS:** existing/security tests, false-positive and provenance regressions, vocabulary-aware schema, distinct precise link signals, preserved price/currency/source, fixture offerings, unknown partial coverage, strict typecheck, lint, build and three public production-path checks passed. No data was invented to fill missing values. No prohibited milestone work was started.

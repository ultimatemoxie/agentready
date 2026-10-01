# Milestone 3 — evidence-aware scoring and coverage

Date: 2026-10-01. Scope: scoring, recommendation state, coverage and the minimum report display changes needed to explain them. No persistence, authentication, LLM/MCP execution, analytics, public report pages, deployment or major visual redesign.

## Files changed

- `src/lib/types.ts` — four-state scoring model; auditable rule, category, coverage, limitation, recommendation and research fields.
- `src/lib/analysis/scoring-context.ts` — new rule-to-evidence and inspected-resource assessment layer.
- `src/lib/analysis/score.ts` — unchanged category/rule weights; evidence gate, coverage math, normalized score, thresholds and state-based recommendations.
- `src/lib/analysis/classify.ts` — page parser diagnostics included in technical evidence.
- `src/lib/analysis/crawl.ts` — relevant discovered pages left unvisited by the total deadline are explicitly marked `NOT_CHECKED`.
- `src/components/ReportView.tsx` and `src/app/globals.css` — compact coverage, rule-state and limitation presentation within the existing report design.
- `scripts/smoke-public.ts` — manual real-path assertions for evidence, score math, state and recommendations, plus optional one-page bounded-crawl scenario.
- `tests/scoring.test.ts` — new scoring and report regressions.
- `tests/fetch-crawl.test.ts` — native HTTP sitemap-timeout and discovery-budget coverage cases; prior integration assertion adapted to a nullable headline score.
- `package.json` — include scoring tests in `npm test`.
- `README.md` — scoring and coverage contract.
- `docs/milestone-3-tests.txt`, `docs/milestone-3-public-smoke.txt`, `docs/milestone-3-partial-smoke.txt` — verification records.

## Scoring state and formulas

Every existing rule has a stable category-qualified ID, name, category, maximum points, state, nullable earned points, evidence IDs, source URLs and an assessment reason. `DETECTED` requires an eligible high/medium-confidence record and earns its full rule weight. `NOT_DETECTED` means relevant checked content was successfully inspected with no eligible signal and earns zero. `UNKNOWN` covers failed, skipped, timed-out, unparseable or otherwise insufficient context; its points are `null`. `NOT_APPLICABLE` is represented and excluded from denominators, but no production classifier assigns it automatically yet.

```text
applicable = sum(rule maximum) for every rule except NOT_APPLICABLE
evaluated  = sum(rule maximum) for DETECTED and NOT_DETECTED rules
raw earned = sum(rule maximum) for DETECTED rules with eligible evidence
coverage   = evaluated / applicable × 100
normalized = raw earned / evaluated × 100
```

Zero denominators produce no numeric normalized/headline score. The headline is `round(normalized)` only at 50% or greater coverage. The raw and unrounded normalized values remain separately auditable in the report data. Per-category raw, evaluated, applicable, fixed maximum, coverage and scaled category normalized value are also retained. Category normalized values are **not** summed to calculate the overall score. The fixed category maxima remain Identity 15, Offering 15, Discovery 15, Trust 15, Communication 10, Actionability 20 and Transaction 10: total 100.

Weighted coverage is the primary confidence measure. It counts a five-point unknown action check more heavily than a one-point llms.txt check. At **75%+**, the regular readiness band may be displayed because at most a quarter of weighted checks are unresolved. At **50–74%**, the number is explicitly provisional and labeled a partial analysis. Below **50%**, unresolved weight can exceed evaluated weight, so the headline score is suppressed with “Insufficient coverage for a reliable overall score.” These are transparent heuristic thresholds, not statistically calibrated confidence claims. Raw `run.status` continues to describe bounded crawl execution for compatibility; `run.analysisStatus` and `coverage` describe the report's completeness. A bounded crawl may finish while page-budget exclusions leave scoring checks unknown.

## Rule and recommendation behavior

The assessment layer uses the existing rule evidence mapping and successfully inspected page/resource checks. A claimed positive without eligible source evidence becomes `UNKNOWN`, not points. Discovery resource failures such as sitemap timeout remain `UNKNOWN`; a confirmed 404 becomes `NOT_DETECTED`. Failed/skipped relevant contact, policy, catalog or pricing pages keep affected missing rules `UNKNOWN`. Independent homepage checks can still be evaluated. Malformed JSON-LD affects structured-capable rules without hiding unrelated metadata/link results. A low-confidence observation cannot earn points or become a confident absence claim.

Recommendations use only `NOT_DETECTED`. They include related rule IDs, inspected sources and the reason for absence; duplicate suggestions retain all related IDs. `UNKNOWN` appears as an analysis limitation, not a deficiency recommendation. Positive evidence remains credited even when another relevant page fails. `researchRuleStates` and state counts preserve the distinction for later aggregate work; legacy boolean `researchSignals` should not be interpreted as true absence when false.

The report adds Analysis Coverage (weighted percent, 38-rule state counts and HTML page outcomes), category raw/evaluated/max math, per-rule state and reason, unknown limitations, and inspected-source context for recommendations. A low-coverage report does not show a headline score or a high-readiness label. No scoring weights or homepage design changed.

## Regression and verification results

`npm test`: **PASS, 78/78**. This retains Milestones 1 and 2 tests and adds 17 scoring/report tests plus two native HTTP integration cases. The new cases include complete math, timeout/unknown sitemap without deficiency recommendation, failed pricing/contact pages, positive evidence surviving failure, inspected policy absence, ineligible low-confidence evidence, missing offering context, malformed JSON-LD, evidence IDs, all seven category maxima, explicit not-applicable math, 75/50/49 threshold boundaries, zero denominator, deduped state-based recommendations, research counts, and rendered coverage/low-score UI. The true-absence policy case includes an actually parsed secondary HTML page. Native HTTP tests cover a slow sitemap and a total-budget expiry during discovery.

`npm run typecheck`: **PASS** under strict TypeScript. `npm run lint`: **PASS**, 25 TypeScript files parsed, no unsafe `eval` or `debugger` (the repository's existing custom AST lint). `npm run build`: **PASS**, production compile, TypeScript and static generation. This environment required approved worker-process execution for Next.js after the sandboxed build produced `spawn EPERM`; the production build itself succeeded. The compiled server was started locally for smoke checks, then stopped. Nothing was deployed.

The optional public smoke script exercised the compiled production `POST /api/analyze` on `http://127.0.0.1:3005`. It validated that every earned rule has eligible source evidence, returned source URLs correspond to successful responses, state-to-point math and normalization match, unknown rules do not create deficiency recommendations, and low coverage has no headline score. Public internet is **not** needed for `npm test`.

| Public target | Outcome | Analyzed HTML | Coverage | Raw / evaluated | Headline | Report status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| example.com | PASS, 6.1 s | 1 | 86% | 6 / 86 | 7 | Normal band, some offering checks unknown |
| Basecamp | PASS, 19.0 s | 5 | 91% | 62 / 91 | 68 | Normal band; two relevant pages skipped by bound |
| Porkbun | PASS, 54.1 s | 4 | 69% | 67 / 69 | 97 | **Partial analysis — provisional score** |

Porkbun's `/products/domains` request timed out; that page was marked `UNKNOWN`, 24 discovered relevant pages were skipped by the bounded crawl, and affected offering/contact/policy checks did not become deficiency recommendations. One evaluated absence generated a recommendation; unknown checks did not. The 97 is explicitly conditional on the 69% evaluated weight and must not be read as a certification or full-site assessment.

The deliberately bounded direct production-path check, `npm run smoke:public -- --max-pages 1 https://basecamp.com`, also **PASSed** in 8.6 s. Its homepage was analyzed and six relevant pages marked skipped. Raw earned 36 / evaluated 39 yielded 39% coverage and an internal normalized value of 92.31, but **no headline score**. It returned 13 detected, 2 not-detected and 23 unknown checks, with unknown checks excluded from deficiency recommendations. This proves that a high conditional ratio cannot masquerade as a confident score below the threshold.

Report examples from deterministic fixtures and real requests:

- **Complete:** structured ecommerce fixture, 78 raw / 100 evaluated, 100% coverage, 78 headline, “Strong foundation.”
- **Partial:** Porkbun public compiled-API request, 67 raw / 69 evaluated, 69% coverage, provisional 97; failed/skipped sources are visibly listed. The deterministic sitemap-timeout fixture also shows 97% coverage with a single unknown rule and no sitemap deficiency recommendation.
- **Low coverage:** Basecamp one-page bounded request, 36 raw / 39 evaluated, 39% coverage; headline suppressed and 23 checks unknown.

## Remaining limitations and risks

- Site-wide absence cannot be proven by a five-page crawl. `NOT_DETECTED` is scoped to inspected relevant content; the UI says so. Relevance depends on path heuristics and extracted homepage links. If an important page is neither discovered nor inspected, a check may still be considered evaluated from the homepage. This is a residual false-negative and recommendation risk.
- Coverage is rubric-weighted observability, not a calibrated probability or guarantee of accuracy. An analyzed page can contain stale or misleading declarations. Conditional normalization can make a partial score high, as the Porkbun case demonstrates; the provisional label and visible denominator are essential.
- All 38 fixed rules currently remain applicable in production. Business-type inference is not reliable enough to auto-exclude booking, phone, physical location, checkout and similar checks. An informational or fully online business may therefore receive irrelevant recommendations; a validated applicability model belongs in later work.
- Detectors remain conservative heuristics and cannot execute JavaScript or verify bookings, payments, APIs, MCP or external customer flows. Incorrect medium-confidence classifications remain possible; unfamiliar site markup and cross-origin content can be missed.
- The legacy `run.status` may say `complete` when the bounded crawl ended cleanly but the score has unknown checks. Consumers should use `analysisStatus` and `coverage` for report confidence. The report UI does so.
- Native IP policy is a reviewed snapshot and DNS/network safety limitations remain as documented in the README. No rate limiting or persistence was added.

**Milestone 3: PASS** against the requested acceptance gates. Stop here pending approval for any later milestone.

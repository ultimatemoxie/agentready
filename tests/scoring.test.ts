import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { createRequire } from 'node:module';
import { extractPage } from '../src/lib/analysis/extract.ts';
import { classify } from '../src/lib/analysis/classify.ts';
import { buildReport, calculateScores, recommendationsFor, SCORE_SPEC } from '../src/lib/analysis/score.ts';
import { assessRule, RULE_SIGNAL_TYPES } from '../src/lib/analysis/scoring-context.ts';
import { makeEvidence } from '../src/lib/analysis/evidence.ts';
import type { RuleAssessment, ScoringState, ResourceCheck, AnalysisReport } from '../src/lib/types.ts';

const base = 'https://meridian.example/';
const require = createRequire(import.meta.url);
// The workspace's existing runtime has these modules but incomplete declaration
// bundles. Keep the test adapter narrowly typed; no application-wide any shim.
const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup: (node: ReactNode) => string };
const ts = require('typescript') as { transpileModule: (source: string, options: { compilerOptions: { jsx: number; module: number; target: number } }) => { outputText: string }; JsxEmit: { ReactJSX: number }; ModuleKind: { ESNext: number }; ScriptTarget: { ES2022: number } };
// Node's native TS runner cannot load TSX. Compile the actual component with the
// already-installed compiler for server-rendered UI checks; no browser/extra loader.
const componentSource = readFileSync('src/components/ReportView.tsx', 'utf8');
const componentJs = ts.transpileModule(componentSource, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')));
const { ReportView } = await import(`data:text/javascript;base64,${Buffer.from(componentJs).toString('base64')}`) as { ReportView: (props: { report: AnalysisReport }) => ReturnType<typeof createElement> };
const fixture = (name: string) => readFileSync(`tests/fixtures/${name}.html`, 'utf8');
const absentResources: ResourceCheck[] = [
  { resource: 'robots', sourceUrl: base + 'robots.txt', status: 'NOT_FOUND', httpStatus: 404 },
  { resource: 'sitemap', sourceUrl: base + 'sitemap.xml', status: 'NOT_FOUND', httpStatus: 404 },
  { resource: 'llms_txt', sourceUrl: base + 'llms.txt', status: 'NOT_FOUND', httpStatus: 404 },
];
function classified(html = fixture('ecommerce'), checks: ResourceCheck[] = [], url = base) {
  const page = extractPage(html, url);
  return classify({ pages: [page], responses: [{ url, status: 200, contentType: 'text/html' }], warnings: [], robots: 'Not detected', sitemap: 'Not detected', llms: 'Not detected',
    resourceChecks: [{ resource: 'html', sourceUrl: url, status: 'INSPECTED', httpStatus: 200 }, ...absentResources, ...checks] });
}
const reportOf = (classification = classified()) => buildReport(base, base, classification);
const ruleOf = (report: AnalysisReport, ruleId: string) => report.run.categoryScores.flatMap(category => category.rules).find(rule => rule.ruleId === ruleId)!;

// Calculator fixtures only: explicitly tagged synthetic evidence never enters the app.
function mathFixture(state: ScoringState = 'NOT_DETECTED') {
  const records = SCORE_SPEC.flatMap(category => category.rules.map(rule => makeEvidence({ type: RULE_SIGNAL_TYPES[rule.id][0], value: `Synthetic ${category.key}.${rule.id}`, sourceUrl: base, sourceType: 'html_text', rawEvidence: `Test-only ${rule.id} evidence`, detector: 'test-only-score-fixture', confidence: 'high' })));
  const assessments: Record<string, RuleAssessment> = {};
  let index = 0;
  for (const category of SCORE_SPEC) for (const rule of category.rules) assessments[`${category.key}.${rule.id}`] = { state, reason: 'Explicit test-only rule context.', sourceUrls: [base], evidenceIds: state === 'DETECTED' ? [records[index++].id] : (index++, []) };
  return { records, assessments };
}
function evaluatedWeight(weight: number) {
  const data = mathFixture('UNKNOWN');
  let remaining = weight;
  const rules = SCORE_SPEC.flatMap(category => category.rules.map(rule => ({ ...rule, ruleId: `${category.key}.${rule.id}` }))).sort((a, b) => b.points - a.points);
  for (const rule of rules) if (rule.points <= remaining) { const record = data.records.find(item => item.value.endsWith(rule.ruleId))!; data.assessments[rule.ruleId] = { ...data.assessments[rule.ruleId], state: 'DETECTED', evidenceIds: [record.id] }; remaining -= rule.points; }
  assert.equal(remaining, 0); return calculateScores(data.assessments, data.records);
}

test('complete ecommerce report preserves original raw math, 100% coverage and readiness band', () => {
  const report = reportOf();
  assert.equal(report.run.rawScore, 78); assert.equal(report.run.normalizedScore, 78); assert.equal(report.run.overallScore, 78);
  assert.equal(report.run.coverage.percent, 100); assert.equal(report.run.analysisStatus, 'complete');
  assert.equal(report.statusLabel, 'Strong foundation'); assert.equal(report.run.coverage.unknown, 0);
  assert.deepEqual(report.run.categoryScores.map(category => category.earnedPoints), [15, 13, 9, 15, 5, 11, 10]);
});
test('failed sitemap is unknown with null points and never recommends publishing a sitemap', () => {
  const c = classified();
  c.evidence.resourceChecks = c.evidence.resourceChecks.filter(check => check.resource !== 'sitemap');
  c.evidence.resourceChecks.push({ resource: 'sitemap', sourceUrl: base + 'sitemap.xml', status: 'UNKNOWN', reason: 'Request timed out' });
  const report = reportOf(c), rule = ruleOf(report, 'discovery.sitemap');
  assert.equal(rule.state, 'UNKNOWN'); assert.equal(rule.pointsEarned, null); assert.match(rule.reason, /timed out/);
  assert.equal(report.run.coverage.percent, 97); assert.equal(report.run.coverage.evaluatedPoints, 97);
  assert.equal(report.run.normalizedScore, 78 / 97 * 100); assert.equal(report.run.overallScore, 80);
  assert.ok(!report.run.recommendations.some(item => item.relatedRuleIds.includes(rule.ruleId)));
  assert.ok(report.run.analysisLimitations.some(item => item.ruleId === rule.ruleId)); assert.equal(report.run.analysisStatus, 'partial');
});
test('failed pricing/contact pages make affected missing rules unknown while homepage metadata stays evaluable', () => {
  const report = reportOf(classified(fixture('partial'), [
    { resource: 'html', sourceUrl: base + 'contact', status: 'UNKNOWN', httpStatus: 503, reason: 'HTTP 503' },
    { resource: 'html', sourceUrl: base + 'pricing', status: 'UNKNOWN', reason: 'Request timed out' },
  ]));
  for (const id of ['communication.email', 'communication.phone', 'offering.prices', 'transaction.prices']) assert.equal(ruleOf(report, id).state, 'UNKNOWN', id);
  assert.equal(ruleOf(report, 'discovery.metadata').state, 'NOT_DETECTED');
  assert.equal(ruleOf(report, 'identity.canonical').state, 'NOT_DETECTED');
  assert.equal(report.run.analysisStatus, 'low_coverage'); assert.ok(report.run.coverage.percent < 50); assert.equal(report.run.overallScore, null); assert.equal(report.run.coverage.pagesFailed, 2);
  assert.ok(!report.run.recommendations.some(item => item.relatedRuleIds.includes('offering.prices') || item.relatedRuleIds.includes('communication.email')));
});
test('eligible positive evidence survives failed secondary pages', () => {
  const report = reportOf(classified(fixture('ecommerce'), [{ resource: 'html', sourceUrl: base + 'pricing', status: 'UNKNOWN', reason: 'Timeout' }]));
  assert.equal(ruleOf(report, 'offering.prices').state, 'DETECTED'); assert.equal(ruleOf(report, 'offering.prices').pointsEarned, 3);
  assert.ok(ruleOf(report, 'offering.prices').evidenceIds.length);
});
test('true absence on successfully inspected policy context permits a scoped recommendation', () => {
  const html = '<title>Business</title><a href="/contact">Contact</a>';
  const policyUrl = base + 'policies';
  const report = reportOf(classify({
    pages: [extractPage(html, base), extractPage('<title>Business information</title><p>Our company information.</p>', policyUrl)],
    responses: [{ url: base, status: 200, contentType: 'text/html' }, { url: policyUrl, status: 200, contentType: 'text/html' }],
    warnings: [], robots: 'Not detected', sitemap: 'Not detected', llms: 'Not detected',
    resourceChecks: [{ resource: 'html', sourceUrl: base, status: 'INSPECTED', httpStatus: 200 },
      { resource: 'html', sourceUrl: policyUrl, status: 'INSPECTED', httpStatus: 200 }, ...absentResources],
  }));
  const rule = ruleOf(report, 'trust.privacy');
  assert.equal(rule.state, 'NOT_DETECTED'); assert.equal(rule.pointsEarned, 0);
  const recommendation = report.run.recommendations.find(item => item.ruleId === rule.ruleId)!;
  assert.equal(recommendation.context.state, 'NOT_DETECTED'); assert.ok(recommendation.context.sourceUrls.includes(policyUrl)); assert.ok(recommendation.reason);
});
test('low-confidence price evidence does not earn points or become a confident deficiency', () => {
  const report = reportOf(classified('<title>Business</title><p>USD 99</p>'));
  for (const id of ['offering.prices', 'transaction.prices']) { const rule = ruleOf(report, id); assert.equal(rule.state, 'UNKNOWN'); assert.equal(rule.pointsEarned, null); assert.deepEqual(rule.evidenceIds, []); }
  assert.ok(!report.run.recommendations.some(item => item.relatedRuleIds.includes('offering.prices')));
});
test('missing offering context leaves dependent checks unknown, without inventing applicability', () => {
  const report = reportOf(classified('<title>Example Domain</title><p>A simple informational page.</p>'));
  for (const id of ['offering.prices', 'offering.categories', 'offering.identifiers', 'offering.offeringDescriptions']) assert.equal(ruleOf(report, id).state, 'UNKNOWN');
  assert.equal(report.run.coverage.notApplicable, 0); assert.equal(ruleOf(report, 'offering.offerings').state, 'NOT_DETECTED');
});
test('malformed JSON-LD is unknown for structured checks but does not hide absent homepage metadata', () => {
  const report = reportOf(classified('<title>Business</title><script type="application/ld+json">{broken}</script>'));
  assert.equal(ruleOf(report, 'discovery.schema').state, 'UNKNOWN'); assert.equal(ruleOf(report, 'identity.identitySchema').state, 'UNKNOWN');
  assert.equal(ruleOf(report, 'discovery.metadata').state, 'NOT_DETECTED'); assert.equal(ruleOf(report, 'identity.canonical').state, 'NOT_DETECTED');
});
test('detected rules require eligible source records; missing and low evidence are downgraded', () => {
  const data = mathFixture('DETECTED');
  const record = data.records[0]; record.confidence = 'low';
  data.assessments['identity.description'].evidenceIds = ['nonexistent'];
  const result = calculateScores(data.assessments, data.records);
  assert.equal(result.categoryScores[0].rules[0].state, 'UNKNOWN'); assert.equal(result.categoryScores[0].rules[1].state, 'UNKNOWN');
  for (const rule of result.categoryScores.flatMap(category => category.rules).filter(rule => rule.state === 'DETECTED')) {
    assert.equal(rule.pointsEarned, rule.maxPoints); assert.ok(rule.evidenceIds.length); assert.ok(rule.sourceUrls.includes(base)); assert.ok(rule.evidence);
  }
  const c = classified(); c.facts.phone = true; assert.equal(assessRule('phone', c).state, 'UNKNOWN');
});
test('fixed category maxima remain 15/15/15/15/10/20/10 and unknown weight is not evaluated', () => {
  const data = mathFixture('DETECTED'), result = calculateScores(data.assessments, data.records);
  assert.deepEqual(result.categoryScores.map(category => category.max), [15, 15, 15, 15, 10, 20, 10]);
  assert.equal(result.coverage.maximumPoints, 100); assert.equal(result.overallScore, 100); assert.equal(result.coverage.percent, 100);
  data.assessments['actionability.actionFlow'].state = 'UNKNOWN';
  const partial = calculateScores(data.assessments, data.records), category = partial.categoryScores.find(category => category.key === 'actionability')!;
  assert.equal(category.earnedPoints, 15); assert.equal(category.evaluatedPoints, 15); assert.equal(category.max, 20); assert.equal(category.coverage, 75); assert.equal(category.normalizedScore, 20);
  assert.equal(partial.rawScore, 95); assert.equal(partial.normalizedScore, 100); assert.equal(partial.coverage.percent, 95);
});
test('not-applicable state is supported explicitly, excluded from denominators and never recommends', () => {
  const data = mathFixture('DETECTED'); data.assessments['identity.location'] = { state: 'NOT_APPLICABLE', reason: 'Explicit test-only analysis context excludes this rule; no production inference.', sourceUrls: [], evidenceIds: [] };
  const result = calculateScores(data.assessments, data.records), rule = result.categoryScores[0].rules.find(rule => rule.id === 'location')!;
  assert.equal(rule.state, 'NOT_APPLICABLE'); assert.equal(rule.pointsEarned, null); assert.equal(result.coverage.notApplicable, 1);
  assert.equal(result.coverage.applicablePoints, 98); assert.equal(result.coverage.evaluatedPoints, 98); assert.equal(result.coverage.percent, 100); assert.equal(result.overallScore, 100);
  assert.equal(result.categoryScores[0].max, 15); assert.equal(recommendationsFor(result.categoryScores).length, 0);
});
test('coverage thresholds use exact weights: 75 normal, 50 provisional, below 50 score suppressed', () => {
  for (const [weight, level, score] of [[75, 'normal', 100], [74, 'partial', 100], [50, 'partial', 100], [49, 'low', null]] as const) {
    const result = evaluatedWeight(weight); assert.equal(result.coverage.percent, weight); assert.equal(result.coverage.level, level); assert.equal(result.overallScore, score);
  }
});
test('zero evaluated weight and all-not-applicable input do not fabricate a numeric score', () => {
  for (const state of ['UNKNOWN', 'NOT_APPLICABLE'] as const) { const data = mathFixture(state), result = calculateScores(data.assessments, data.records); assert.equal(result.overallScore, null); assert.equal(result.normalizedScore, null); assert.equal(result.coverage.level, 'low'); }
});
test('recommendations use only not-detected states, retain related IDs and exclude unknown/N/A', () => {
  const data = mathFixture('UNKNOWN'); data.assessments['discovery.sitemap'].state = 'NOT_APPLICABLE'; data.assessments['identity.canonical'].state = 'NOT_DETECTED'; data.assessments['discovery.canonical'].state = 'NOT_DETECTED';
  const result = calculateScores(data.assessments, data.records), recommendations = recommendationsFor(result.categoryScores);
  assert.equal(recommendations.length, 1); assert.deepEqual(recommendations[0].relatedRuleIds, ['identity.canonical', 'discovery.canonical']); assert.equal(recommendations[0].context.state, 'NOT_DETECTED');
});
test('report rule IDs and research state counts are consistent with auditable scoring math', () => {
  const report = reportOf(), rules = report.run.categoryScores.flatMap(category => category.rules);
  assert.equal(new Set(rules.map(rule => rule.ruleId)).size, rules.length);
  assert.equal(rules.reduce((sum, rule) => sum + (rule.pointsEarned ?? 0), 0), report.run.rawScore);
  const coverage = report.run.coverage; assert.equal(coverage.detected + coverage.notDetected + coverage.unknown + coverage.notApplicable, coverage.totalChecks);
  assert.equal(Object.keys(report.run.researchRuleStates).length, rules.length);
  for (const recommendation of report.run.recommendations) for (const id of recommendation.relatedRuleIds) assert.equal(ruleOf(report, id).state, 'NOT_DETECTED');
});
test('static report UI visibly separates evaluated absence, unknown limitations and coverage', () => {
  const c = classified(fixture('partial'), [{ resource: 'html', sourceUrl: base + 'contact', status: 'UNKNOWN', reason: 'Contact timed out' }, { resource: 'html', sourceUrl: base + 'pricing', status: 'UNKNOWN', reason: 'Pricing timed out' }]);
  const html = renderToStaticMarkup(createElement(ReportView, { report: reportOf(c) }));
  assert.match(html, /Analysis Coverage/); assert.match(html, /Unknown/); assert.match(html, /Pricing timed out/); assert.match(html, /should not all be interpreted as business deficiencies/); assert.ok(!html.includes('Missing signals</strong>'));
});
test('low-coverage report suppresses the headline score and never displays Highly actionable', () => {
  const c = classified('<title>Business</title>');
  c.evidence.resourceChecks.forEach(check => { check.status = 'UNKNOWN'; check.reason = 'Unsupported inspection context'; });
  const report = reportOf(c); assert.equal(report.run.overallScore, null); assert.equal(report.run.analysisStatus, 'low_coverage'); assert.match(report.statusLabel, /Insufficient coverage/);
  const html = renderToStaticMarkup(createElement(ReportView, { report })); assert.match(html, /Insufficient coverage/); assert.ok(!html.includes('Highly actionable')); assert.ok(!html.includes('<div class="score-number">100'));
});

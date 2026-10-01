// Optional manual test. Uses exactly the production analysis entry point and defaults.
import { analyzeWebsite } from '../src/lib/analysis/index.ts';
import { evidenceSchema } from '../src/lib/analysis/evidence.ts';

const args = process.argv.slice(2);
let api: string | undefined, maxPages: number | undefined;
while (args[0]?.startsWith('--')) {
  const option = args.shift(), value = args.shift();
  if (option === '--api' && value) api = value;
  else if (option === '--max-pages' && value && /^[1-5]$/.test(value)) maxPages = Number(value);
  else { console.error('Invalid smoke option.'); process.exit(1); }
}
const urls = args;
if (!urls.length || api && maxPages !== undefined) { console.error('Usage: npm run smoke:public -- [--api http://127.0.0.1:3001 | --max-pages 1] https://example.com https://a-business.com'); process.exit(1); }
for (const url of urls) {
  const started = performance.now();
  try {
    let report;
    if (api) {
      const response = await fetch(new URL('/api/analyze', api), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }), signal: AbortSignal.timeout(70_000) });
      const payload = await response.json();
      if (!response.ok) throw Object.assign(new Error(payload.error || 'API analysis failed'), { code: payload.code });
      if (!payload.id || !/^\/report\/[0-9a-f-]{36}$/i.test(payload.reportUrl)) throw new Error('API did not return a stable report ID and URL');
      const savedResponse = await fetch(new URL(`/api/reports/${payload.id}`, api), { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const saved = await savedResponse.json();
      if (!savedResponse.ok || saved.run?.id !== payload.id || saved.run?.status === 'FAILED') throw new Error(saved.run?.errorMessage || saved.error || 'Saved analysis failed');
      report = saved.run.reportData as Awaited<ReturnType<typeof analyzeWebsite>>;
      if (!report.run || !report.profile || !Array.isArray(report.run.technicalEvidence?.analyzedUrls)) throw new Error('API returned an invalid report');
    } else report = await analyzeWebsite(url, maxPages === undefined ? {} : { limits: { maxPages } });
    const evidence = report.run.technicalEvidence;
    const records = new Map(evidence.records.map(record => [record.id, evidenceSchema.parse(record)]));
    for (const record of records.values()) if (!evidence.analyzedUrls.some(page => page.url === record.sourceUrl && page.status >= 200 && page.status < 300)) throw new Error(`Evidence has no successful source response: ${record.sourceUrl}`);
    for (const rule of report.run.categoryScores.flatMap(category => category.rules).filter(rule => rule.earned)) {
      if (!rule.evidence || !rule.evidenceIds?.length) throw new Error(`Earned rule has no evidence: ${rule.id}`);
      for (const id of rule.evidenceIds) if (!records.has(id) || records.get(id)!.confidence === 'low') throw new Error(`Earned rule references invalid or low-confidence evidence: ${rule.id}`);
    }
    const rules = report.run.categoryScores.flatMap(category => category.rules);
    for (const rule of rules) {
      const expected = rule.state === 'DETECTED' ? rule.maxPoints : rule.state === 'NOT_DETECTED' ? 0 : null;
      if (rule.pointsEarned !== expected) throw new Error(`Invalid state/point math: ${rule.ruleId}`);
    }
    for (const recommendation of report.run.recommendations) for (const ruleId of recommendation.relatedRuleIds) if (rules.find(rule => rule.ruleId === ruleId)?.state !== 'NOT_DETECTED') throw new Error(`Recommendation is not based on evaluated absence: ${ruleId}`);
    const evaluated = rules.filter(rule => ['DETECTED', 'NOT_DETECTED'].includes(rule.state)).reduce((sum, rule) => sum + rule.maxPoints, 0);
    const raw = rules.reduce((sum, rule) => sum + (rule.pointsEarned ?? 0), 0);
    if (report.run.rawScore !== raw || report.run.coverage.evaluatedPoints !== evaluated || report.run.normalizedScore !== (evaluated ? raw / evaluated * 100 : null)) throw new Error('Inconsistent score normalization');
    if (report.run.coverage.percent < 50 && report.run.overallScore !== null) throw new Error('Low coverage must suppress headline score');
    console.log(JSON.stringify({ inputUrl: url, outcome: 'PASS', durationMs: Math.round(performance.now() - started),
      businessName: report.profile.name, status: report.run.status, analysisStatus: report.run.analysisStatus, score: report.run.overallScore,
      statusLabel: report.statusLabel, rawScore: raw, normalizedScore: report.run.normalizedScore, coverage: report.run.coverage,
      categoryMath: report.run.categoryScores.map(category => ({ category: category.key, earned: category.earnedPoints, evaluated: category.evaluatedPoints, maximum: category.max, coverage: category.coverage, normalized: category.normalizedScore })),
      analysisLimitations: report.run.analysisLimitations, recommendationRuleIds: report.run.recommendations.map(item => item.relatedRuleIds),
      analyzedUrls: evidence.analyzedUrls, evidenceRecords: evidence.records.length,
      confidenceCounts: Object.fromEntries(['high', 'medium', 'low'].map(confidence => [confidence, evidence.records.filter(record => record.confidence === confidence).length])),
      offerings: report.profile.productsServices, prices: evidence.records.filter(record => record.type === 'price').map(record => ({ value: record.value, sourceUrl: record.sourceUrl, confidence: record.confidence, details: record.details })),
      actionTypes: [...new Set(evidence.records.filter(record => ['booking', 'reservation', 'appointment', 'quote', 'cart', 'checkout', 'contact', 'purchase', 'search', 'support', 'api_documentation', 'openapi_reference', 'mcp_reference', 'agent_card_reference', 'product_feed'].includes(record.type)).map(record => record.type))],
      incompleteResources: evidence.resourceChecks.filter(check => ['UNKNOWN', 'NOT_CHECKED'].includes(check.status)), warnings: evidence.warnings }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ inputUrl: url, outcome: 'FAIL', durationMs: Math.round(performance.now() - started),
      code: error instanceof Error && 'code' in error ? error.code : 'ERROR', message: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { extractPage } from '../src/lib/analysis/extract.ts';
import { classify } from '../src/lib/analysis/classify.ts';
import { buildReport } from '../src/lib/analysis/score.ts';
import { AnalysisRunService } from '../src/lib/analysis/run-service.ts';
import { AnalysisError } from '../src/lib/analysis/url.ts';
import { SqliteAnalysisRepository } from '../src/lib/persistence/sqlite-repository.ts';
import { StoredRecordError } from '../src/lib/persistence/validation.ts';
import { createSubmissionGate } from '../src/lib/client/submission-gate.ts';
import { ANALYSIS_VERSION, SCORING_VERSION, DETECTOR_VERSION, REPORT_SCHEMA_VERSION } from '../src/lib/versions.ts';
import type { AnalysisReport, ResourceCheck, StoredAnalysisRun } from '../src/lib/types.ts';

const url = 'https://example.com/';
const ecommerce = readFileSync('tests/fixtures/ecommerce.html', 'utf8');
const discovery: ResourceCheck[] = [
  { resource: 'robots', sourceUrl: url + 'robots.txt', status: 'NOT_FOUND', httpStatus: 404 },
  { resource: 'sitemap', sourceUrl: url + 'sitemap.xml', status: 'NOT_FOUND', httpStatus: 404 },
  { resource: 'llms_txt', sourceUrl: url + 'llms.txt', status: 'NOT_FOUND', httpStatus: 404 },
];
function fixtureReport(id: string, inputUrl = url, partial = false): AnalysisReport {
  const page = extractPage(ecommerce, url);
  const classification = classify({ pages: [page], responses: [{ url, status: 200, contentType: 'text/html' }], warnings: [],
    robots: 'Not detected', sitemap: 'Not detected', llms: 'Not detected',
    resourceChecks: [{ resource: 'html', sourceUrl: url, status: 'INSPECTED', httpStatus: 200 }, ...discovery,
      ...(partial ? [{ resource: 'html' as const, sourceUrl: url + 'pricing', status: 'UNKNOWN' as const, reason: 'Request timed out' }] : [])] });
  return buildReport(inputUrl, url, classification, id);
}
function localRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'agentready-m4-'));
  const path = join(directory, 'analyses.sqlite');
  const repository = new SqliteAnalysisRepository(path);
  return { repository, path, cleanup() {
    repository.close();
    // Recursive cleanup is restricted to this verified, newly created temp directory.
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe test cleanup path');
    rmSync(directory, { recursive: true, force: true });
  } };
}

test('run is durable and RUNNING before analysis resolves, then saves the complete report', async () => {
  const local = localRepository();
  try {
    let entered!: () => void, release!: () => void;
    const observation: { value: StoredAnalysisRun | null } = { value: null };
    const inAnalyzer = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const service = new AnalysisRunService(local.repository, async (input, options) => {
      observation.value = await local.repository.getById(options.runId);
      entered(); await blocked;
      return fixtureReport(options.runId, input);
    });
    const work = service.execute(url, { source: 'test' });
    await inAnalyzer;
    assert.equal(observation.value?.status, 'RUNNING');
    assert.equal(observation.value?.normalizedUrl, url);
    assert.equal(observation.value?.reportData, null);
    release();
    const saved = await work;
    assert.equal(saved.id, observation.value?.id); assert.equal(saved.status, 'COMPLETE');
    assert.ok(saved.completedAt); assert.equal(saved.failedAt, null); assert.equal(saved.requestMetadata.source, 'test');
    assert.equal(saved.reportData?.run.id, saved.id);
    assert.deepEqual((await local.repository.getById(saved.id))?.reportData, saved.reportData);
  } finally { local.cleanup(); }
});

test('stored complete report survives repository restart without rerunning or score drift', async () => {
  const local = localRepository();
  let reopened: SqliteAnalysisRepository | undefined;
  try {
    let calls = 0;
    const service = new AnalysisRunService(local.repository, async (input, options) => { calls++; return fixtureReport(options.runId, input); });
    const saved = await service.execute(url, { source: 'test' });
    const serialized = JSON.stringify(saved.reportData);
    local.repository.close();
    reopened = new SqliteAnalysisRepository(local.path);
    const again = await reopened.getById(saved.id);
    assert.equal(calls, 1); assert.equal(JSON.stringify(again?.reportData), serialized);
    assert.equal(again?.overallScore, saved.overallScore); assert.equal(again?.rawScore, saved.rawScore);
    assert.equal(again?.coverage, saved.coverage);
    const rules = again!.reportData!.run.categoryScores.flatMap(category => category.rules);
    const ids = new Set(again!.reportData!.run.technicalEvidence.records.map(record => record.id));
    for (const rule of rules.filter(rule => rule.state === 'DETECTED')) assert.ok(rule.evidenceIds.length && rule.evidenceIds.every(id => ids.has(id)));
  } finally {
    reopened?.close();
    // local.cleanup closes the original handle again only when it remains open.
    if (!reopened) local.repository.close();
    const directory = resolve(join(local.path, '..'));
    if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe test cleanup path');
    rmSync(directory, { recursive: true, force: true });
  }
});

test('partial result persists its exact coverage and unknown rules', async () => {
  const local = localRepository();
  try {
    const saved = await new AnalysisRunService(local.repository, async (input, options) => fixtureReport(options.runId, input, true)).execute(url, { source: 'test' });
    assert.equal(saved.status, 'PARTIAL'); assert.ok(saved.reportData);
    assert.equal(saved.coverage, saved.reportData!.run.coverage.percent);
    assert.equal(saved.coverageStatus, saved.reportData!.run.coverage.level);
    assert.ok(saved.reportData!.run.coverage.unknown > 0);
    assert.ok(saved.crawlSummary && saved.crawlSummary.pagesFailed > 0);
    assert.equal((await local.repository.getById(saved.id))?.status, 'PARTIAL');
  } finally { local.cleanup(); }
});

test('analysis failure and unsafe URL policy failure both remain inspectable with safe messages', async () => {
  const local = localRepository();
  try {
    let calls = 0;
    const service = new AnalysisRunService(local.repository, async () => { calls++; throw new AnalysisError('TIMEOUT', 'internal secret from lower layer'); });
    const failed = await service.execute(url, { source: 'test' });
    assert.equal(failed.status, 'FAILED'); assert.equal(failed.errorCode, 'TIMEOUT'); assert.ok(failed.failedAt);
    assert.doesNotMatch(failed.errorMessage!, /internal secret/); assert.equal(failed.reportData, null);
    assert.equal((await local.repository.getById(failed.id))?.errorMessage, failed.errorMessage);
    const unsafe = await service.execute('http://127.0.0.1/', { source: 'test' });
    assert.equal(unsafe.status, 'FAILED'); assert.equal(unsafe.errorCode, 'UNSAFE_URL'); assert.equal(unsafe.startedAt, null);
    assert.equal(calls, 1);
  } finally { local.cleanup(); }
});

test('an interrupted stale run is recovered as an inspectable failure on read', async () => {
  const local = localRepository();
  try {
    const queued = await local.repository.createRun({ inputUrl: url, requestMetadata: { source: 'test' } });
    await local.repository.markRunning(queued.id, url);
    const writer = new DatabaseSync(local.path);
    try { writer.prepare('UPDATE analysis_runs SET started_at=? WHERE id=?').run(new Date(Date.now() - 180_000).toISOString(), queued.id); }
    finally { writer.close(); }
    const recovered = await local.repository.getById(queued.id);
    assert.equal(recovered?.status, 'FAILED'); assert.equal(recovered?.errorCode, 'INTERRUPTED');
    assert.ok(recovered?.failedAt); assert.equal(recovered?.reportData, null);
  } finally { local.cleanup(); }
});

test('two analyses of the same URL produce distinct immutable run IDs and explicit versions', async () => {
  const local = localRepository();
  try {
    const service = new AnalysisRunService(local.repository, async (input, options) => fixtureReport(options.runId, input));
    const first = await service.execute(url, { source: 'test' }), second = await service.execute(url, { source: 'test' });
    assert.notEqual(first.id, second.id); assert.equal(first.inputUrl, second.inputUrl);
    assert.equal((await local.repository.listRecent()).length, 2);
    for (const run of [first, second]) {
      assert.equal(run.analysisVersion, ANALYSIS_VERSION); assert.equal(run.scoringVersion, SCORING_VERSION);
      assert.equal(run.detectorVersion, DETECTOR_VERSION); assert.equal(run.schemaVersion, REPORT_SCHEMA_VERSION);
      assert.equal(run.reportData?.run.id, run.id);
    }
  } finally { local.cleanup(); }
});

test('unknown ID is absent and malformed stored JSON is rejected safely', async () => {
  const local = localRepository();
  try {
    assert.equal(await local.repository.getById(randomUUID()), null);
    assert.equal(await local.repository.getById('not-a-run-id'), null);
    const run = await new AnalysisRunService(local.repository, async (input, options) => fixtureReport(options.runId, input)).execute(url, { source: 'test' });
    const writer = new DatabaseSync(local.path);
    try { writer.prepare('UPDATE analysis_runs SET report_data_json=? WHERE id=?').run('{broken', run.id); } finally { writer.close(); }
    await assert.rejects(local.repository.getById(run.id), StoredRecordError);
  } finally { local.cleanup(); }
});

test('corrupt evidence references are rejected before a result can be persisted', async () => {
  const local = localRepository();
  try {
    const queued = await local.repository.createRun({ inputUrl: url, requestMetadata: { source: 'test' } });
    await local.repository.markRunning(queued.id, url);
    const report = fixtureReport(queued.id);
    const earned = report.run.categoryScores.flatMap(category => category.rules).find(rule => rule.state === 'DETECTED')!;
    earned.evidenceIds = ['missing-evidence-id'];
    await assert.rejects(local.repository.saveResult(queued.id, report), StoredRecordError);
    const wrongMath = fixtureReport(queued.id);
    wrongMath.run.categoryScores[0].earnedPoints += 1;
    await assert.rejects(local.repository.saveResult(queued.id, wrongMath), StoredRecordError);
    assert.equal((await local.repository.getById(queued.id))?.status, 'RUNNING');
  } finally { local.cleanup(); }
});

test('one submission gate permits one request while active and retry after a handled error', () => {
  const gate = createSubmissionGate();
  assert.equal(gate.claim(), true); assert.equal(gate.claim(), false); assert.equal(gate.claim(), false);
  gate.release(); assert.equal(gate.claim(), true);
});

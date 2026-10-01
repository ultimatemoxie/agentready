import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractPage } from '../src/lib/analysis/extract.ts';
import { classify } from '../src/lib/analysis/classify.ts';
import { buildReport } from '../src/lib/analysis/score.ts';
import { AnalysisRunService } from '../src/lib/analysis/run-service.ts';
import { SupabaseAnalysisRepository, SupabaseRepositoryError } from '../src/lib/persistence/supabase-repository.ts';
import { getAnalysisRepository } from '../src/lib/persistence/repository.ts';
import { StoredRecordError } from '../src/lib/persistence/validation.ts';
import type { AnalysisReport, ResourceCheck } from '../src/lib/types.ts';

const site = 'https://example.com/';
const html = readFileSync('tests/fixtures/ecommerce.html', 'utf8');
const checks: ResourceCheck[] = [
  { resource: 'robots', sourceUrl: site + 'robots.txt', status: 'NOT_FOUND', httpStatus: 404 },
  { resource: 'sitemap', sourceUrl: site + 'sitemap.xml', status: 'NOT_FOUND', httpStatus: 404 },
  { resource: 'llms_txt', sourceUrl: site + 'llms.txt', status: 'NOT_FOUND', httpStatus: 404 },
];

function report(id: string, partial = false): AnalysisReport {
  const classified = classify({ pages: [extractPage(html, site)], responses: [{ url: site, status: 200, contentType: 'text/html' }],
    warnings: [], robots: 'Not detected', sitemap: 'Not detected', llms: 'Not detected', resourceChecks: [
      { resource: 'html', sourceUrl: site, status: 'INSPECTED', httpStatus: 200 }, ...checks,
      ...(partial ? [{ resource: 'html' as const, sourceUrl: site + 'contact', status: 'UNKNOWN' as const, reason: 'Request timed out' }] : []),
    ] });
  return buildReport(site, site, classified, id);
}

function mockRest() {
  const rows = new Map<string, { id: string; status: string; created_at: string; record: unknown }>();
  const calls: { method: string; url: string }[] = [];
  let unavailable = false;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = new URL(String(input));
    const method = init?.method || 'GET';
    calls.push({ method, url: requestUrl.href });
    assert.equal(init?.headers && (init.headers as Record<string, string>).apikey, 'sb_secret_test');
    assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, undefined);
    if (unavailable) return Response.json({ message: 'private database detail' }, { status: 503 });
    if (method === 'POST') {
      const row = JSON.parse(String(init?.body)) as { id: string; status: string; created_at: string; record: unknown };
      // PostgREST commonly serializes timestamptz with an explicit offset.
      row.created_at = row.created_at.replace('Z', '+00:00');
      rows.set(row.id, row);
      return Response.json([row], { status: 201 });
    }
    if (method === 'PATCH') {
      const id = requestUrl.searchParams.get('id')?.slice(3) || '';
      const previous = rows.get(id);
      if (!previous || previous.status !== requestUrl.searchParams.get('status')?.slice(3)) return Response.json([]);
      const update = JSON.parse(String(init?.body)) as { status: string; record: unknown };
      const row = { ...previous, ...update };
      rows.set(id, row);
      return Response.json([row]);
    }
    const id = requestUrl.searchParams.get('id')?.slice(3);
    const found = id ? (rows.has(id) ? [rows.get(id)] : []) : [...rows.values()].reverse();
    return Response.json(found);
  }) as typeof fetch;
  return { rows, calls, fetcher, fail() { unavailable = true; } };
}

test('production repository preserves complete and partial reports, versions, evidence and duplicate runs', async () => {
  const rest = mockRest();
  const repository = new SupabaseAnalysisRepository('https://sample.supabase.co', 'sb_secret_test', rest.fetcher);
  const first = await new AnalysisRunService(repository, async (_url, options) => report(options.runId)).execute(site, { source: 'test' });
  const second = await new AnalysisRunService(repository, async (_url, options) => report(options.runId, true)).execute(site, { source: 'test' });
  assert.equal(first.status, 'COMPLETE'); assert.equal(second.status, 'PARTIAL'); assert.notEqual(first.id, second.id);
  assert.equal(rest.calls[0].method, 'POST');
  assert.equal((await repository.getById(first.id))?.reportData?.run.rawScore, first.reportData?.run.rawScore);
  assert.deepEqual((await repository.getById(second.id))?.reportData, second.reportData);
  assert.equal((await repository.listRecent()).length, 2);
  assert.ok(first.analysisVersion && first.scoringVersion && first.detectorVersion && first.schemaVersion);
  const storedIds = new Set(first.reportData!.run.technicalEvidence.records.map(item => item.id));
  for (const rule of first.reportData!.run.categoryScores.flatMap(item => item.rules).filter(item => item.state === 'DETECTED'))
    assert.ok(rule.evidenceIds.every(id => storedIds.has(id)));
});

test('production repository persists safe failures and rejects corrupt records', async () => {
  const rest = mockRest();
  const repository = new SupabaseAnalysisRepository('https://sample.supabase.co', 'sb_secret_test', rest.fetcher);
  const failed = await new AnalysisRunService(repository, async () => { throw new Error('internal database secret'); }).execute(site, { source: 'test' });
  assert.equal(failed.status, 'FAILED'); assert.doesNotMatch(failed.errorMessage!, /secret/);
  assert.equal((await repository.getById(failed.id))?.errorCode, 'ANALYSIS_ERROR');
  const row = rest.rows.get(failed.id)!;
  row.record = { id: failed.id, status: 'COMPLETE' };
  await assert.rejects(repository.getById(failed.id), StoredRecordError);
});

test('production repository fails closed on invalid configuration and sanitized storage errors', async () => {
  assert.throws(() => new SupabaseAnalysisRepository('http://127.0.0.1', 'sb_secret_test'));
  assert.throws(() => new SupabaseAnalysisRepository('https://sample.supabase.co', 'not-a-secret'));
  const rest = mockRest();
  rest.fail();
  const repository = new SupabaseAnalysisRepository('https://sample.supabase.co', 'sb_secret_test', rest.fetcher);
  await assert.rejects(repository.getById('00000000-0000-4000-8000-000000000000'), error =>
    error instanceof SupabaseRepositoryError && !error.message.includes('private database detail'));
});

test('Vercel runtime never falls back to ephemeral SQLite', () => {
  const oldVercel = process.env.VERCEL, oldUrl = process.env.AGENTREADY_SUPABASE_URL, oldSecret = process.env.AGENTREADY_SUPABASE_SECRET_KEY;
  try {
    process.env.VERCEL = '1';
    delete process.env.AGENTREADY_SUPABASE_URL;
    delete process.env.AGENTREADY_SUPABASE_SECRET_KEY;
    assert.throws(() => getAnalysisRepository(), /not configured/);
  } finally {
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
    if (oldUrl === undefined) delete process.env.AGENTREADY_SUPABASE_URL; else process.env.AGENTREADY_SUPABASE_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.AGENTREADY_SUPABASE_SECRET_KEY; else process.env.AGENTREADY_SUPABASE_SECRET_KEY = oldSecret;
  }
});

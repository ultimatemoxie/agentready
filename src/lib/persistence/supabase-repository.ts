import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AnalysisRepository, AnalysisReport, CrawlSummary, RecentAnalysisRun, StoredAnalysisRun } from '../types.ts';
import { ANALYSIS_VERSION, DETECTOR_VERSION, REPORT_SCHEMA_VERSION, SCORING_VERSION } from '../versions.ts';
import { StoredRecordError, validateStoredReport, validateStoredRun } from './validation.ts';

const responseRow = z.object({ id: z.uuid(), status: z.enum(['QUEUED', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED']),
  created_at: z.iso.datetime({ offset: true }), record: z.unknown() }).passthrough();

export class SupabaseRepositoryError extends Error {
  constructor() { super('The report store is temporarily unavailable.'); }
}

type Fetcher = typeof fetch;

/** Server-only PostgREST adapter. No secret is ever returned in an error or report. */
export class SupabaseAnalysisRepository implements AnalysisRepository {
  private readonly endpoint: string;
  private readonly secret: string;
  private readonly fetcher: Fetcher;

  constructor(projectUrl: string, secret: string, fetcher: Fetcher = fetch) {
    const url = new URL(projectUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
        url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !secret.startsWith('sb_secret_')) {
      throw new Error('Invalid production report store configuration.');
    }
    this.endpoint = `${url.origin}/rest/v1/agentready_analysis_runs`;
    this.secret = secret;
    this.fetcher = fetcher;
  }

  private async request(method: string, query: string, body?: unknown): Promise<unknown[]> {
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint + query, {
        method,
        headers: { apikey: this.secret, accept: 'application/json',
          'content-type': 'application/json', prefer: 'return=representation' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      });
    } catch { throw new SupabaseRepositoryError(); }
    if (!response.ok) throw new SupabaseRepositoryError();
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new SupabaseRepositoryError(); }
    if (!Array.isArray(payload)) throw new SupabaseRepositoryError();
    return payload;
  }

  private parse(raw: unknown): StoredAnalysisRun {
    const row = responseRow.safeParse(raw);
    if (!row.success) throw new StoredRecordError();
    const run = validateStoredRun(row.data.record, row.data.id);
    if (run.status !== row.data.status || Date.parse(run.createdAt) !== Date.parse(row.data.created_at)) throw new StoredRecordError();
    return run;
  }

  private async transition(id: string, expected: StoredAnalysisRun['status'], next: StoredAnalysisRun): Promise<StoredAnalysisRun> {
    const rows = await this.request('PATCH', `?id=eq.${id}&status=eq.${expected}&select=id,status,created_at,record`,
      { status: next.status, record: next });
    if (rows.length !== 1) throw new Error('Invalid analysis run transition.');
    return this.parse(rows[0]);
  }

  async createRun(input: { inputUrl: string; requestMetadata: StoredAnalysisRun['requestMetadata'] }): Promise<StoredAnalysisRun> {
    if (input.requestMetadata.source !== 'web' && input.requestMetadata.source !== 'test') throw new Error('Invalid request metadata.');
    const run: StoredAnalysisRun = {
      id: randomUUID(), inputUrl: input.inputUrl, normalizedUrl: null, status: 'QUEUED', createdAt: new Date().toISOString(),
      startedAt: null, completedAt: null, failedAt: null,
      analysisVersion: ANALYSIS_VERSION, scoringVersion: SCORING_VERSION, detectorVersion: DETECTOR_VERSION, schemaVersion: REPORT_SCHEMA_VERSION,
      overallScore: null, rawScore: null, coverage: null, coverageStatus: null, errorCode: null, errorMessage: null,
      requestMetadata: input.requestMetadata, crawlSummary: null, reportData: null,
    };
    validateStoredRun(run);
    const rows = await this.request('POST', '?select=id,status,created_at,record',
      { id: run.id, status: run.status, created_at: run.createdAt, record: run });
    if (rows.length !== 1) throw new SupabaseRepositoryError();
    return this.parse(rows[0]);
  }

  async markRunning(id: string, normalizedUrl: string): Promise<StoredAnalysisRun> {
    const previous = await this.getById(id);
    if (!previous || previous.status !== 'QUEUED') throw new Error('Invalid analysis run transition.');
    return this.transition(id, 'QUEUED', { ...previous, status: 'RUNNING', normalizedUrl, startedAt: new Date().toISOString() });
  }

  async saveResult(id: string, report: AnalysisReport): Promise<StoredAnalysisRun> {
    validateStoredReport(report, id);
    const previous = await this.getById(id);
    if (!previous || previous.status !== 'RUNNING') throw new Error('Invalid analysis run transition.');
    const summary: CrawlSummary = { pagesAnalyzed: report.run.coverage.pagesAnalyzed, pagesFailed: report.run.coverage.pagesFailed,
      pagesSkipped: report.run.coverage.pagesSkipped, analyzedUrls: report.run.analyzedUrls, warnings: report.run.technicalEvidence.warnings };
    const next: StoredAnalysisRun = { ...previous, status: report.run.analysisStatus === 'complete' ? 'COMPLETE' : 'PARTIAL',
      normalizedUrl: report.run.normalizedUrl, completedAt: new Date().toISOString(), overallScore: report.run.overallScore,
      rawScore: report.run.rawScore, coverage: report.run.coverage.percent, coverageStatus: report.run.coverage.level,
      crawlSummary: summary, reportData: report };
    validateStoredRun(next, id);
    return this.transition(id, 'RUNNING', next);
  }

  async saveFailure(id: string, failure: { code: string; message: string; normalizedUrl?: string }): Promise<StoredAnalysisRun> {
    if (!/^[A-Z_]{2,40}$/.test(failure.code) || failure.message.length > 200 || /[\r\n]/.test(failure.message)) throw new Error('Invalid safe failure details.');
    const previous = await this.getById(id);
    if (!previous || (previous.status !== 'QUEUED' && previous.status !== 'RUNNING')) throw new Error('Invalid analysis run transition.');
    const next: StoredAnalysisRun = { ...previous, status: 'FAILED', normalizedUrl: failure.normalizedUrl || previous.normalizedUrl,
      failedAt: new Date().toISOString(), errorCode: failure.code, errorMessage: failure.message };
    validateStoredRun(next, id);
    return this.transition(id, previous.status, next);
  }

  private async recoverStale(run: StoredAnalysisRun): Promise<StoredAnalysisRun> {
    if ((run.status === 'QUEUED' || run.status === 'RUNNING') &&
        Date.now() - Date.parse(run.startedAt || run.createdAt) > 120_000) {
      try { return await this.transition(run.id, run.status, { ...run, status: 'FAILED', failedAt: new Date().toISOString(),
        errorCode: 'INTERRUPTED', errorMessage: 'Analysis was interrupted before it could finish.' }); }
      catch { return run; }
    }
    return run;
  }

  async getById(id: string): Promise<StoredAnalysisRun | null> {
    if (!z.uuid().safeParse(id).success) return null;
    const rows = await this.request('GET', `?id=eq.${id}&select=id,status,created_at,record&limit=1`);
    if (!rows.length) return null;
    return this.recoverStale(this.parse(rows[0]));
  }

  async listRecent(limit = 20): Promise<RecentAnalysisRun[]> {
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 20;
    const rows = await this.request('GET', `?select=id,status,created_at,record&order=created_at.desc,id.desc&limit=${bounded}`);
    const runs = await Promise.all(rows.map(row => this.recoverStale(this.parse(row))));
    return runs.map(({ id, inputUrl, normalizedUrl, status, createdAt, overallScore, coverage, coverageStatus }) =>
      ({ id, inputUrl, normalizedUrl, status, createdAt, overallScore, coverage, coverageStatus }));
  }
}

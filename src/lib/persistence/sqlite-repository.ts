import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { AnalysisRepository, AnalysisReport, CrawlSummary, RecentAnalysisRun, StoredAnalysisRun } from '../types.ts';
import { ANALYSIS_VERSION, DATABASE_SCHEMA_VERSION, DETECTOR_VERSION, REPORT_SCHEMA_VERSION, SCORING_VERSION } from '../versions.ts';
import { StoredRecordError, validateStoredReport } from './validation.ts';

const statusSchema = z.enum(['QUEUED', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED']);
const rowSchema = z.object({
  id: z.uuid(), input_url: z.string().min(1), normalized_url: z.string().nullable(), status: statusSchema,
  created_at: z.iso.datetime(), started_at: z.iso.datetime().nullable(), completed_at: z.iso.datetime().nullable(), failed_at: z.iso.datetime().nullable(),
  analysis_version: z.string().min(1), scoring_version: z.string().min(1), detector_version: z.string().min(1), schema_version: z.string().min(1),
  overall_score: z.number().int().min(0).max(100).nullable(), raw_score: z.number().int().min(0).max(100).nullable(),
  coverage: z.number().finite().min(0).max(100).nullable(), coverage_status: z.enum(['normal', 'partial', 'low']).nullable(),
  error_code: z.string().nullable(), error_message: z.string().nullable(),
  request_metadata_json: z.string(), crawl_summary_json: z.string().nullable(), report_data_json: z.string().nullable(),
});
type Row = z.infer<typeof rowSchema>;
const metadataSchema = z.object({ source: z.enum(['web', 'test']) }).strict();
const crawlSummarySchema = z.object({ pagesAnalyzed: z.number().int().nonnegative(), pagesFailed: z.number().int().nonnegative(), pagesSkipped: z.number().int().nonnegative(), analyzedUrls: z.array(z.url()), warnings: z.array(z.string()) }).strict();

function decodeJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { throw new StoredRecordError(); }
}
function parseRow(raw: unknown): StoredAnalysisRun {
  const result = rowSchema.safeParse(raw);
  if (!result.success) throw new StoredRecordError();
  const row: Row = result.data;
  const metadata = metadataSchema.safeParse(decodeJson(row.request_metadata_json));
  const crawl = row.crawl_summary_json === null ? { success: true as const, data: null } : crawlSummarySchema.safeParse(decodeJson(row.crawl_summary_json));
  if (!metadata.success || !crawl.success) throw new StoredRecordError();
  const reportData = row.report_data_json === null ? null : validateStoredReport(decodeJson(row.report_data_json), row.id, row.schema_version);
  if (['COMPLETE', 'PARTIAL'].includes(row.status)) {
    if (!reportData || !row.completed_at || row.overall_score !== reportData.run.overallScore || row.raw_score !== reportData.run.rawScore ||
        row.coverage !== reportData.run.coverage.percent || row.coverage_status !== reportData.run.coverage.level ||
        row.normalized_url !== reportData.run.normalizedUrl || row.input_url !== reportData.run.inputUrl ||
        !crawl.data || crawl.data.pagesAnalyzed !== reportData.run.coverage.pagesAnalyzed ||
        crawl.data.pagesFailed !== reportData.run.coverage.pagesFailed || crawl.data.pagesSkipped !== reportData.run.coverage.pagesSkipped ||
        row.status !== (reportData.run.analysisStatus === 'complete' ? 'COMPLETE' : 'PARTIAL')) throw new StoredRecordError();
  } else if (reportData) throw new StoredRecordError();
  if (row.status === 'FAILED' && (!row.failed_at || !row.error_code || !row.error_message)) throw new StoredRecordError();
  return {
    id: row.id, inputUrl: row.input_url, normalizedUrl: row.normalized_url, status: row.status,
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at, failedAt: row.failed_at,
    analysisVersion: row.analysis_version, scoringVersion: row.scoring_version, detectorVersion: row.detector_version, schemaVersion: row.schema_version,
    overallScore: row.overall_score, rawScore: row.raw_score, coverage: row.coverage, coverageStatus: row.coverage_status,
    errorCode: row.error_code, errorMessage: row.error_message, requestMetadata: metadata.data,
    crawlSummary: crawl.data as CrawlSummary | null, reportData,
  };
}

export class SqliteAnalysisRepository implements AnalysisRepository {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const absolute = resolve(path);
    mkdirSync(dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > DATABASE_SCHEMA_VERSION) throw new Error('The local analysis database was created by a newer app version.');
    if (version === 0) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(`CREATE TABLE IF NOT EXISTS analysis_runs (
          id TEXT PRIMARY KEY,
          input_url TEXT NOT NULL,
          normalized_url TEXT,
          status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETE','PARTIAL','FAILED')),
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          failed_at TEXT,
          analysis_version TEXT NOT NULL,
          scoring_version TEXT NOT NULL,
          detector_version TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          overall_score INTEGER,
          raw_score INTEGER,
          coverage REAL,
          coverage_status TEXT,
          error_code TEXT,
          error_message TEXT,
          request_metadata_json TEXT NOT NULL,
          crawl_summary_json TEXT,
          report_data_json TEXT
        );
        CREATE INDEX IF NOT EXISTS analysis_runs_recent ON analysis_runs(created_at DESC, id DESC);
        PRAGMA user_version = 1;`);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }

  private recoverStaleRuns() {
    // A bounded analysis has a 60-second deadline. Recover interrupted local
    // requests on read after two minutes, without adding a background worker.
    const now = new Date().toISOString(), cutoff = new Date(Date.now() - 120_000).toISOString();
    this.db.prepare(`UPDATE analysis_runs SET status='FAILED', failed_at=?, error_code='INTERRUPTED',
      error_message='Analysis was interrupted before it could finish.'
      WHERE status IN ('QUEUED','RUNNING') AND COALESCE(started_at,created_at) < ?`).run(now, cutoff);
  }

  async createRun(input: { inputUrl: string; requestMetadata: StoredAnalysisRun['requestMetadata'] }): Promise<StoredAnalysisRun> {
    const metadata = metadataSchema.parse(input.requestMetadata);
    const id = randomUUID(), createdAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO analysis_runs (id,input_url,status,created_at,analysis_version,scoring_version,detector_version,schema_version,request_metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, input.inputUrl, 'QUEUED', createdAt, ANALYSIS_VERSION, SCORING_VERSION, DETECTOR_VERSION, REPORT_SCHEMA_VERSION, JSON.stringify(metadata));
    return (await this.getById(id))!;
  }

  async markRunning(id: string, normalizedUrl: string): Promise<StoredAnalysisRun> {
    const result = this.db.prepare(`UPDATE analysis_runs SET status='RUNNING', normalized_url=?, started_at=? WHERE id=? AND status='QUEUED'`).run(normalizedUrl, new Date().toISOString(), id);
    if (result.changes !== 1) throw new Error('Invalid analysis run transition.');
    return (await this.getById(id))!;
  }

  async saveResult(id: string, report: AnalysisReport): Promise<StoredAnalysisRun> {
    validateStoredReport(report, id);
    const status = report.run.analysisStatus === 'complete' ? 'COMPLETE' : 'PARTIAL';
    const summary: CrawlSummary = { pagesAnalyzed: report.run.coverage.pagesAnalyzed, pagesFailed: report.run.coverage.pagesFailed,
      pagesSkipped: report.run.coverage.pagesSkipped, analyzedUrls: report.run.analyzedUrls, warnings: report.run.technicalEvidence.warnings };
    const result = this.db.prepare(`UPDATE analysis_runs SET status=?, normalized_url=?, completed_at=?, overall_score=?, raw_score=?, coverage=?, coverage_status=?, crawl_summary_json=?, report_data_json=?
      WHERE id=? AND status='RUNNING'`).run(status, report.run.normalizedUrl, new Date().toISOString(), report.run.overallScore, report.run.rawScore,
      report.run.coverage.percent, report.run.coverage.level, JSON.stringify(summary), JSON.stringify(report), id);
    if (result.changes !== 1) throw new Error('Invalid analysis run transition.');
    return (await this.getById(id))!;
  }

  async saveFailure(id: string, failure: { code: string; message: string; normalizedUrl?: string }): Promise<StoredAnalysisRun> {
    if (!/^[A-Z_]{2,40}$/.test(failure.code) || failure.message.length > 200 || /[\r\n]/.test(failure.message)) throw new Error('Invalid safe failure details.');
    const result = this.db.prepare(`UPDATE analysis_runs SET status='FAILED', normalized_url=COALESCE(?,normalized_url), failed_at=?, error_code=?, error_message=?
      WHERE id=? AND status IN ('QUEUED','RUNNING')`).run(failure.normalizedUrl || null, new Date().toISOString(), failure.code, failure.message, id);
    if (result.changes !== 1) throw new Error('Invalid analysis run transition.');
    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<StoredAnalysisRun | null> {
    if (!z.uuid().safeParse(id).success) return null;
    this.recoverStaleRuns();
    const raw = this.db.prepare('SELECT * FROM analysis_runs WHERE id=?').get(id);
    return raw ? parseRow(raw) : null;
  }

  async listRecent(limit = 20): Promise<RecentAnalysisRun[]> {
    this.recoverStaleRuns();
    const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
    const rows = this.db.prepare('SELECT * FROM analysis_runs ORDER BY created_at DESC, id DESC LIMIT ?').all(bounded);
    return rows.map(raw => {
      const row = rowSchema.safeParse(raw);
      if (!row.success) throw new StoredRecordError();
      return { id: row.data.id, inputUrl: row.data.input_url, normalizedUrl: row.data.normalized_url, status: row.data.status,
        createdAt: row.data.created_at, overallScore: row.data.overall_score, coverage: row.data.coverage, coverageStatus: row.data.coverage_status };
    });
  }

  close() { this.db.close(); }
}

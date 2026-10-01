import { z } from 'zod';
import { evidenceSchema } from '../analysis/evidence.ts';
import type { AnalysisReport, StoredAnalysisRun } from '../types.ts';
import { REPORT_SCHEMA_VERSION } from '../versions.ts';

export class StoredRecordError extends Error {
  readonly code = 'CORRUPT_RECORD';
  constructor() { super('This saved report could not be read safely.'); }
}

const state = z.enum(['DETECTED', 'NOT_DETECTED', 'UNKNOWN', 'NOT_APPLICABLE']);
const ruleSchema = z.object({
  ruleId: z.string().min(1), category: z.string().min(1), maxPoints: z.number().int().positive(),
  state, pointsEarned: z.number().int().nonnegative().nullable(), evidenceIds: z.array(z.string()),
  sourceUrls: z.array(z.url()), reason: z.string().min(1),
}).passthrough();
const categorySchema = z.object({
  key: z.string().min(1), max: z.number().int().positive(), earnedPoints: z.number().int().nonnegative(),
  evaluatedPoints: z.number().int().nonnegative(), applicablePoints: z.number().int().nonnegative(),
  coverage: z.number().finite().min(0).max(100), normalizedScore: z.number().finite().nullable(),
  rules: z.array(ruleSchema).min(1),
}).passthrough();
const coverageSchema = z.object({
  percent: z.number().finite().min(0).max(100), level: z.enum(['normal', 'partial', 'low']),
  totalChecks: z.number().int().nonnegative(), detected: z.number().int().nonnegative(),
  notDetected: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(), evaluatedPoints: z.number().int().nonnegative(),
  applicablePoints: z.number().int().nonnegative(), maximumPoints: z.number().int().nonnegative(),
  pagesAnalyzed: z.number().int().nonnegative(), pagesFailed: z.number().int().nonnegative(), pagesSkipped: z.number().int().nonnegative(),
}).passthrough();
const reportSchema = z.object({
  run: z.object({
    id: z.uuid(), inputUrl: z.string().min(1), normalizedUrl: z.url(), createdAt: z.iso.datetime(),
    status: z.enum(['complete', 'partial']), analysisStatus: z.enum(['complete', 'partial', 'low_coverage']),
    overallScore: z.number().int().min(0).max(100).nullable(), rawScore: z.number().int().min(0).max(100),
    normalizedScore: z.number().finite().min(0).max(100).nullable(), coverage: coverageSchema,
    categoryScores: z.array(categorySchema).length(7),
    detectedSignals: z.array(z.object({ id: z.string().min(1), sourceUrl: z.url() }).passthrough()),
    researchRuleStates: z.record(z.string(), state),
    recommendations: z.array(z.object({ ruleId: z.string().min(1), relatedRuleIds: z.array(z.string()).min(1) }).passthrough()),
    analysisLimitations: z.array(z.object({ ruleId: z.string().min(1), reason: z.string().min(1) }).passthrough()),
    technicalEvidence: z.object({
      records: z.array(evidenceSchema), analyzedUrls: z.array(z.object({ url: z.url(), status: z.number().int() }).passthrough()),
      resourceChecks: z.array(z.object({ resource: z.string(), sourceUrl: z.url(), status: z.string() }).passthrough()),
      checks: z.array(z.object({ type: z.string(), status: z.string(), sourceUrl: z.url(), evidenceIds: z.array(z.string()) }).passthrough()),
      warnings: z.array(z.string()), checkedAt: z.iso.datetime(),
    }).passthrough(),
    analyzedUrls: z.array(z.url()),
  }).passthrough(),
  profile: z.object({ name: z.string().min(1), evidence: z.array(evidenceSchema), agentView: z.array(z.object({ label: z.string(), status: z.string(), value: z.string() }).passthrough()) }).passthrough(),
  topBlockers: z.array(z.unknown()), positiveSignals: z.array(z.string()), statusLabel: z.string().min(1), disclaimer: z.string().min(1),
}).passthrough();

export function validateStoredReport(value: unknown, expectedId: string, schemaVersion = REPORT_SCHEMA_VERSION): AnalysisReport {
  if (schemaVersion !== REPORT_SCHEMA_VERSION) throw new StoredRecordError();
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) throw new StoredRecordError();
  const report = parsed.data;
  if (report.run.id !== expectedId) throw new StoredRecordError();
  const rules = report.run.categoryScores.flatMap(category => category.rules);
  const records = new Map(report.run.technicalEvidence.records.map(record => [record.id, record]));
  if (records.size !== report.run.technicalEvidence.records.length) throw new StoredRecordError();
  if (report.run.coverage.maximumPoints !== 100 || report.run.coverage.totalChecks !== rules.length ||
      report.run.coverage.detected + report.run.coverage.notDetected + report.run.coverage.unknown + report.run.coverage.notApplicable !== rules.length) throw new StoredRecordError();
  const expectedCategories = [
    ['identity', 15], ['offering', 15], ['discovery', 15], ['trust', 15],
    ['communication', 10], ['actionability', 20], ['transaction', 10],
  ] as const;
  for (const [index, category] of report.run.categoryScores.entries()) {
    if (category.key !== expectedCategories[index][0] || category.max !== expectedCategories[index][1] ||
        category.rules.some(rule => rule.category !== category.key) ||
        category.rules.reduce((sum, rule) => sum + rule.maxPoints, 0) !== category.max) throw new StoredRecordError();
    const earned = category.rules.filter(rule => rule.state === 'DETECTED').reduce((sum, rule) => sum + rule.maxPoints, 0);
    const evaluated = category.rules.filter(rule => ['DETECTED', 'NOT_DETECTED'].includes(rule.state)).reduce((sum, rule) => sum + rule.maxPoints, 0);
    const applicable = category.rules.filter(rule => rule.state !== 'NOT_APPLICABLE').reduce((sum, rule) => sum + rule.maxPoints, 0);
    if (category.earnedPoints !== earned || category.evaluatedPoints !== evaluated || category.applicablePoints !== applicable ||
        Math.abs(category.coverage - (applicable ? evaluated / applicable * 100 : 0)) > 1e-8 ||
        category.normalizedScore !== (evaluated ? earned / evaluated * category.max : null)) throw new StoredRecordError();
  }
  let raw = 0, evaluated = 0, applicable = 0;
  const ruleIds = new Set<string>();
  for (const rule of rules) {
    if (ruleIds.has(rule.ruleId)) throw new StoredRecordError();
    ruleIds.add(rule.ruleId);
    if (rule.state !== 'NOT_APPLICABLE') applicable += rule.maxPoints;
    if (rule.state === 'DETECTED') {
      if (rule.pointsEarned !== rule.maxPoints || !rule.evidenceIds.length ||
          rule.evidenceIds.some(id => !records.has(id) || records.get(id)!.confidence === 'low')) throw new StoredRecordError();
      raw += rule.maxPoints; evaluated += rule.maxPoints;
    } else if (rule.state === 'NOT_DETECTED') {
      if (rule.pointsEarned !== 0 || rule.evidenceIds.length) throw new StoredRecordError();
      evaluated += rule.maxPoints;
    } else if (rule.pointsEarned !== null || rule.evidenceIds.length) throw new StoredRecordError();
    if (report.run.researchRuleStates[rule.ruleId] !== rule.state) throw new StoredRecordError();
  }
  if (raw !== report.run.rawScore || evaluated !== report.run.coverage.evaluatedPoints || applicable !== report.run.coverage.applicablePoints ||
      Math.abs(report.run.coverage.percent - (applicable ? evaluated / applicable * 100 : 0)) > 1e-8 ||
      report.run.normalizedScore !== (evaluated ? raw / evaluated * 100 : null) ||
      report.run.overallScore !== (report.run.coverage.percent >= 50 && evaluated ? Math.round(raw / evaluated * 100) : null)) throw new StoredRecordError();
  if (report.run.recommendations.some(item => item.relatedRuleIds.some(id => !rules.some(rule => rule.ruleId === id && rule.state === 'NOT_DETECTED')))) throw new StoredRecordError();
  if (report.profile.evidence.some(record => !records.has(record.id)) ||
      report.run.detectedSignals.some(signal => !records.has(signal.id))) throw new StoredRecordError();
  return value as AnalysisReport;
}

const storedRunSchema = z.object({
  id: z.uuid(), inputUrl: z.string().min(1), normalizedUrl: z.url().nullable(),
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED']),
  createdAt: z.iso.datetime(), startedAt: z.iso.datetime().nullable(), completedAt: z.iso.datetime().nullable(), failedAt: z.iso.datetime().nullable(),
  analysisVersion: z.string().min(1), scoringVersion: z.string().min(1), detectorVersion: z.string().min(1), schemaVersion: z.string().min(1),
  overallScore: z.number().int().min(0).max(100).nullable(), rawScore: z.number().int().min(0).max(100).nullable(),
  coverage: z.number().finite().min(0).max(100).nullable(), coverageStatus: z.enum(['normal', 'partial', 'low']).nullable(),
  errorCode: z.string().nullable(), errorMessage: z.string().nullable(),
  requestMetadata: z.object({ source: z.enum(['web', 'test']) }).strict(),
  crawlSummary: z.object({ pagesAnalyzed: z.number().int().nonnegative(), pagesFailed: z.number().int().nonnegative(),
    pagesSkipped: z.number().int().nonnegative(), analyzedUrls: z.array(z.url()), warnings: z.array(z.string()) }).strict().nullable(),
  reportData: z.unknown().nullable(),
}).strict();

export function validateStoredRun(value: unknown, expectedId?: string): StoredAnalysisRun {
  const parsed = storedRunSchema.safeParse(value);
  if (!parsed.success) throw new StoredRecordError();
  const run = parsed.data;
  if (expectedId && run.id !== expectedId) throw new StoredRecordError();
  const report = run.reportData === null ? null : validateStoredReport(run.reportData, run.id, run.schemaVersion);
  if (run.status === 'COMPLETE' || run.status === 'PARTIAL') {
    if (!report || !run.startedAt || !run.completedAt || run.failedAt || run.errorCode || run.errorMessage ||
        run.status !== (report.run.analysisStatus === 'complete' ? 'COMPLETE' : 'PARTIAL') ||
        run.inputUrl !== report.run.inputUrl || run.normalizedUrl !== report.run.normalizedUrl ||
        run.overallScore !== report.run.overallScore || run.rawScore !== report.run.rawScore ||
        run.coverage !== report.run.coverage.percent || run.coverageStatus !== report.run.coverage.level ||
        !run.crawlSummary || run.crawlSummary.pagesAnalyzed !== report.run.coverage.pagesAnalyzed ||
        run.crawlSummary.pagesFailed !== report.run.coverage.pagesFailed || run.crawlSummary.pagesSkipped !== report.run.coverage.pagesSkipped) throw new StoredRecordError();
  } else if (report || run.overallScore !== null || run.rawScore !== null || run.coverage !== null || run.coverageStatus !== null) throw new StoredRecordError();
  if (run.status === 'FAILED' && (!run.failedAt || !run.errorCode || !run.errorMessage)) throw new StoredRecordError();
  if (run.status === 'RUNNING' && (!run.startedAt || !run.normalizedUrl)) throw new StoredRecordError();
  return { ...run, reportData: report } as StoredAnalysisRun;
}

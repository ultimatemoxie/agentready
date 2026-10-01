export type SignalKind = 'detected' | 'inferred';
export type SignalStatus = 'Detected' | 'Partially detected' | 'Not detected' | 'Unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type EvidenceSource = 'html_text' | 'html_link' | 'form' | 'meta' | 'json_ld' | 'schema_org' | 'script' | 'header' | 'robots' | 'sitemap' | 'llms_txt' | 'technology_signature';
export interface EvidenceRecord {
  id: string;
  type: string;
  value: string;
  sourceUrl: string;
  sourceType: EvidenceSource;
  rawEvidence: string;
  detector: string;
  confidence: Confidence;
  details?: { amount?: string; currency?: string; symbol?: string; offering?: string; identifierType?: string; format?: string; iri?: string; declaredType?: string; method?: string };
}
export interface EvidenceCheck {
  type: string;
  status: 'DETECTED' | 'NOT_DETECTED' | 'UNKNOWN' | 'NOT_CHECKED';
  sourceUrl: string;
  evidenceIds: string[];
  reason?: string;
}
export interface ResourceCheck {
  resource: 'html' | 'robots' | 'sitemap' | 'llms_txt';
  sourceUrl: string;
  status: 'INSPECTED' | 'NOT_FOUND' | 'UNKNOWN' | 'NOT_CHECKED';
  httpStatus?: number;
  reason?: string;
}
export type CategoryKey = 'identity' | 'offering' | 'discovery' | 'trust' | 'communication' | 'actionability' | 'transaction';

export interface AnalysisRequest { url: string }
export interface DetectedSignal extends EvidenceRecord {
  key: string;
  label: string;
  kind: SignalKind;
  value: string;
  sourceUrl: string;
}
export interface AgentField { label: string; status: SignalStatus; value: string; sourceUrl?: string; evidenceIds?: string[] }
export interface BusinessProfile {
  name: string;
  category?: string;
  description?: string;
  location?: string;
  serviceArea?: string;
  productsServices: string[];
  priceInformation?: string;
  availability?: string;
  variants?: string;
  openingHours?: string;
  contact: string[];
  whatsapp?: string;
  booking?: string;
  checkout?: string;
  policies: string[];
  structuredData: string[];
  machineEndpoints: string[];
  evidence: EvidenceRecord[];
  agentView: AgentField[];
}
export type ScoringState = 'DETECTED' | 'NOT_DETECTED' | 'UNKNOWN' | 'NOT_APPLICABLE';
export interface RuleAssessment { state: ScoringState; reason: string; evidenceIds: string[]; sourceUrls: string[] }
export interface ScoreRuleResult extends RuleAssessment {
  id: string; ruleId: string; label: string; category: CategoryKey; points: number; maxPoints: number;
  pointsEarned: number | null; earned: boolean; evidence?: string; why: string; action: string; priority: 'P0' | 'P1' | 'P2';
}
export interface CategoryScore {
  key: CategoryKey; label: string; score: number; earnedPoints: number; evaluatedPoints: number; applicablePoints: number;
  max: number; coverage: number; normalizedScore: number | null; why: string; rules: ScoreRuleResult[];
}
export interface AnalysisCoverage {
  percent: number; checkPercent: number; level: 'normal' | 'partial' | 'low';
  totalChecks: number; detected: number; notDetected: number; unknown: number; notApplicable: number;
  evaluatedPoints: number; applicablePoints: number; maximumPoints: number;
  pagesAnalyzed: number; pagesFailed: number; pagesSkipped: number;
}
export interface AnalysisLimitation { ruleId: string; label: string; reason: string; sourceUrls: string[] }
export interface Recommendation {
  priority: 'P0' | 'P1' | 'P2'; title: string; why: string; action: string; category: CategoryKey;
  ruleId: string; relatedRuleIds: string[]; reason: string; evidenceIds: string[];
  context: { state: 'NOT_DETECTED'; sourceUrls: string[]; reason: string };
}
export interface AnalyzedUrl { url: string; status: number; contentType: string; note?: string }
export interface TechnicalEvidence {
  records: EvidenceRecord[];
  checks: EvidenceCheck[];
  resourceChecks: ResourceCheck[];
  pageDiagnostics?: { sourceUrl: string; messages: string[] }[];
  analyzedUrls: AnalyzedUrl[];
  schemaTypes: string[];
  metadata: Record<string, string>;
  forms: { purpose: string; action: string; sourceUrl: string }[];
  contactMethods: string[];
  policyUrls: string[];
  providers: string[];
  chatWidgets: string[];
  mapLinks: string[];
  endpoints: string[];
  robots: string;
  sitemap: string;
  llms: string;
  checkedAt: string;
  warnings: string[];
}
export interface AnalysisRun {
  id: string;
  inputUrl: string;
  normalizedUrl: string;
  businessName: string;
  createdAt: string;
  status: 'complete' | 'partial';
  analysisStatus: 'complete' | 'partial' | 'low_coverage';
  overallScore: number | null;
  rawScore: number;
  normalizedScore: number | null;
  coverage: AnalysisCoverage;
  analysisLimitations: AnalysisLimitation[];
  categoryScores: CategoryScore[];
  detectedSignals: DetectedSignal[];
  researchSignals: Record<string, boolean>;
  researchRuleStates: Record<string, ScoringState>;
  recommendations: Recommendation[];
  technicalEvidence: TechnicalEvidence;
  analyzedUrls: string[];
}
export interface AnalysisReport {
  run: AnalysisRun;
  profile: BusinessProfile;
  topBlockers: Recommendation[];
  positiveSignals: string[];
  statusLabel: string;
  disclaimer: string;
}

export type AnalysisLifecycleStatus = 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
export interface AnalysisVersions {
  analysisVersion: string;
  scoringVersion: string;
  detectorVersion: string;
  schemaVersion: string;
}
export interface CrawlSummary {
  pagesAnalyzed: number;
  pagesFailed: number;
  pagesSkipped: number;
  analyzedUrls: string[];
  warnings: string[];
}
export interface StoredAnalysisRun extends AnalysisVersions {
  id: string;
  inputUrl: string;
  normalizedUrl: string | null;
  status: AnalysisLifecycleStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  overallScore: number | null;
  rawScore: number | null;
  coverage: number | null;
  coverageStatus: AnalysisCoverage['level'] | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestMetadata: { source: 'web' | 'test' };
  crawlSummary: CrawlSummary | null;
  reportData: AnalysisReport | null;
}
export type RecentAnalysisRun = Pick<StoredAnalysisRun, 'id' | 'inputUrl' | 'normalizedUrl' | 'status' | 'createdAt' | 'overallScore' | 'coverage' | 'coverageStatus'>;

// Storage implementations stay outside the crawler and scoring pipeline.
export interface AnalysisRepository {
  createRun(input: { inputUrl: string; requestMetadata: StoredAnalysisRun['requestMetadata'] }): Promise<StoredAnalysisRun>;
  markRunning(id: string, normalizedUrl: string): Promise<StoredAnalysisRun>;
  saveResult(id: string, report: AnalysisReport): Promise<StoredAnalysisRun>;
  saveFailure(id: string, failure: { code: string; message: string; normalizedUrl?: string }): Promise<StoredAnalysisRun>;
  getById(id: string): Promise<StoredAnalysisRun | null>;
  listRecent(limit?: number): Promise<RecentAnalysisRun[]>;
}

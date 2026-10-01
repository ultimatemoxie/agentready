import { analyzeWebsite } from './index.ts';
import { normalizePublicUrl, AnalysisError } from './url.ts';
import type { AnalysisBudget } from './budget.ts';
import type { AnalysisRepository, AnalysisReport, StoredAnalysisRun } from '../types.ts';

type Analyzer = (url: string, options: { runId: string; budget?: AnalysisBudget }) => Promise<AnalysisReport>;
export const reportUrlFor = (id: string) => `/report/${id}`;

const safeMessages: Record<string, string> = {
  INVALID_URL: 'Enter a valid website URL.', UNSAFE_URL: 'This is not a permitted public HTTP or HTTPS destination.',
  TIMEOUT: 'The website did not respond within the request time limit.', ANALYSIS_TIMEOUT: 'The analysis reached its time limit.',
  CRAWL_SIZE_LIMIT: 'The analysis reached its response size limit.', CANCELLED: 'The analysis request was cancelled.',
  UNREACHABLE: 'The website could not be reached.', ROBOTS: 'The website does not permit this public crawl.',
  NON_HTML: 'The website did not provide an HTML homepage.', NON_TEXT: 'The website returned unsupported content.',
  ENCODING: 'The website returned an unsupported encoding.', OVERSIZED: 'The website response exceeded the size limit.',
  REDIRECT_LOOP: 'The website redirected in a loop.', REDIRECT: 'The website exceeded the redirect limit.',
  EXTERNAL_REDIRECT: 'The website redirected outside the allowed public origin.', ACTION_URL: 'This URL appears to perform an action and was not analyzed.',
  DUPLICATE_URL: 'The website redirected to a URL already visited.',
};
export function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof AnalysisError && safeMessages[error.code]) return { code: error.code, message: safeMessages[error.code] };
  return { code: 'ANALYSIS_ERROR', message: 'Analysis could not be completed. Please try again.' };
}

export class AnalysisRunService {
  private readonly repository: AnalysisRepository;
  private readonly analyzer: Analyzer;
  constructor(repository: AnalysisRepository, analyzer: Analyzer = analyzeWebsite) {
    this.repository = repository;
    this.analyzer = analyzer;
  }

  async execute(inputUrl: string, options: { budget?: AnalysisBudget; source?: 'web' | 'test' } = {}): Promise<StoredAnalysisRun> {
    const queued = await this.repository.createRun({ inputUrl, requestMetadata: { source: options.source || 'web' } });
    let normalizedUrl: string | undefined;
    try {
      // The run exists before public-URL policy checks or network work begin.
      normalizedUrl = normalizePublicUrl(inputUrl).href;
      await this.repository.markRunning(queued.id, normalizedUrl);
      const report = await this.analyzer(inputUrl, { runId: queued.id, budget: options.budget });
      return await this.repository.saveResult(queued.id, report);
    } catch (error) {
      return await this.repository.saveFailure(queued.id, { ...safeFailure(error), normalizedUrl });
    }
  }
}

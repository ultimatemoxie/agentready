import { AnalysisError } from './url.ts';

export const ANALYSIS_LIMITS = Object.freeze({
  requestTimeoutMs: 10_000, totalTimeoutMs: 60_000,
  maxRedirects: 3, maxResponseBytes: 1_000_000, maxTotalBytes: 6_000_000, maxPages: 5,
});
export type AnalysisLimits = { [K in keyof typeof ANALYSIS_LIMITS]: number };

export class AnalysisBudget {
  readonly limits: AnalysisLimits;
  readonly signal: AbortSignal;
  readonly deadline: number;
  bytes = 0;
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;
  private readonly parent?: AbortSignal;
  private readonly cancel = () => this.controller.abort(new AnalysisError('CANCELLED', 'Analysis was cancelled.', 499));
  constructor(options: { signal?: AbortSignal; limits?: Partial<AnalysisLimits> } = {}) {
    this.limits = { ...ANALYSIS_LIMITS, ...options.limits };
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid analysis limit');
    this.deadline = performance.now() + this.limits.totalTimeoutMs;
    this.signal = this.controller.signal;
    this.parent = options.signal;
    this.parent?.addEventListener('abort', this.cancel, { once: true });
    this.timer = setTimeout(() => this.expire(), this.limits.totalTimeoutMs);
    if (this.parent?.aborted) this.cancel();
  }
  private expire() { this.controller.abort(new AnalysisError('ANALYSIS_TIMEOUT', 'The analysis reached its total time limit.', 504)); }
  assertActive() {
    if (performance.now() >= this.deadline && !this.signal.aborted) this.expire();
    if (this.signal.aborted) throw this.signal.reason;
  }
  consume(bytes: number) {
    this.assertActive();
    this.bytes += bytes;
    if (this.bytes > this.limits.maxTotalBytes) {
      this.controller.abort(new AnalysisError('CRAWL_SIZE_LIMIT', 'The analysis reached its aggregate response size limit.', 413));
      this.assertActive();
    }
  }
  dispose() { clearTimeout(this.timer); this.parent?.removeEventListener('abort', this.cancel); }
}

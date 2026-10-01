import { crawlSite } from './crawl.ts';
import { classify } from './classify.ts';
import { buildReport } from './score.ts';
import { normalizePublicUrl } from './url.ts';
import { AnalysisBudget, type AnalysisLimits } from './budget.ts';
import type { PublicFetcher } from './fetch.ts';

export async function analyzeWebsite(inputUrl: string, options: { signal?: AbortSignal; budget?: AnalysisBudget; limits?: Partial<AnalysisLimits>; fetcher?: PublicFetcher; runId?: string } = {}) {
  const budget = options.budget || new AnalysisBudget({ signal: options.signal, limits: options.limits });
  try {
    budget.assertActive();
    const normalized = normalizePublicUrl(inputUrl);
    const crawl = await crawlSite(normalized, { budget, fetcher: options.fetcher });
    if (budget.signal.aborted && budget.signal.reason?.code === 'CANCELLED') throw budget.signal.reason;
    return buildReport(inputUrl, normalized.href, classify(crawl), options.runId);
  } finally { if (!options.budget) budget.dispose(); }
}

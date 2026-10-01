import { fetchPublic, type PublicFetcher } from './fetch.ts';
import { AnalysisBudget } from './budget.ts';
import { extractPage, type ParsedPage } from './extract.ts';
import { AnalysisError, isMutationUrl, normalizePublicUrl } from './url.ts';
import type { AnalyzedUrl, EvidenceRecord, ResourceCheck } from '../types.ts';
import { makeEvidence } from './evidence.ts';

export interface CrawlResult {
  pages: ParsedPage[]; responses: AnalyzedUrl[]; warnings: string[];
  robots: string; sitemap: string; llms: string;
  evidenceRecords?: EvidenceRecord[]; resourceChecks?: ResourceCheck[];
}
const RELEVANT = /\b(about|contact|services?|products?|shop|menu|pricing|faq|book(?:ing)?|appointments?|reservations?|polic(?:y|ies)|privacy|terms|shipping|delivery|returns?|refunds?|cancel(?:lation)?|support)\b/i;

export function robotsAllows(content: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: { agents: string[]; rules: { allow: boolean; path: string }[] } = { agents: [], rules: [] };
  const flush = () => { if (current.agents.length) groups.push(current); current = { agents: [], rules: [] }; };
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([^#:]+):\s*([^#]*)/.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') {
      if (current.rules.length) flush();
      current.agents.push(value.toLowerCase());
    } else if (['allow', 'disallow'].includes(key) && current.agents.length && value) {
      current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  flush();
  const specific = groups.filter((group) => group.agents.some((agent) => agent.includes('agentreadybot')));
  const applicable = specific.length ? specific : groups.filter((group) => group.agents.includes('*'));
  let best = { length: -1, allow: true };
  for (const group of applicable) for (const item of group.rules) {
    const prefix = item.path.split('*')[0].replace(/\$$/, '');
    if (prefix && path.startsWith(prefix) && prefix.length >= best.length)
      best = { length: prefix.length, allow: item.allow };
  }
  return best.allow;
}

function terminal(error: unknown): boolean {
  return error instanceof AnalysisError && ['ANALYSIS_TIMEOUT', 'CRAWL_SIZE_LIMIT', 'CANCELLED'].includes(error.code);
}
async function optionalText(url: URL, name: string, responses: AnalyzedUrl[], warnings: string[], fetcher: PublicFetcher, budget: AnalysisBudget, records: EvidenceRecord[], checks: ResourceCheck[]): Promise<{ body: string; status: string }> {
  const resource = name === 'robots.txt' ? 'robots' : name === 'sitemap.xml' ? 'sitemap' : 'llms_txt';
  try {
    const result = await fetcher(url, 'text', { budget, allowedOrigin: url.origin });
    responses.push({ url: result.url, status: result.status, contentType: result.contentType });
    const valid = resource === 'sitemap' ? /<(?:urlset|sitemapindex)\b[^>]*\bxmlns=["']https?:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/i.test(result.body) :
      !/text\/html/i.test(result.contentType) && !/<(?:!doctype|html|body)\b/i.test(result.body) && (resource === 'robots' ? /^\s*User-agent:\s*\S+/im.test(result.body) : /^#\s+\S+/m.test(result.body));
    if (!valid) { checks.push({ resource, sourceUrl: result.url, status: 'UNKNOWN', httpStatus: result.status, reason: 'Response does not match the expected resource format' }); warnings.push(`${name} returned an unconfirmed resource format.`); return { body: '', status: 'Could not confirm resource format' }; }
    checks.push({ resource, sourceUrl: result.url, status: 'INSPECTED', httpStatus: result.status });
    records.push(makeEvidence({ type: resource === 'llms_txt' ? 'llms' : resource, value: result.url, sourceUrl: result.url, sourceType: resource,
      rawEvidence: resource === 'sitemap' ? result.body.match(/<(?:urlset|sitemapindex)\b[^>]*>/i)![0] : result.body.split(/\r?\n/).find(line => resource === 'robots' ? /^\s*User-agent:/i.test(line) : /^#\s/.test(line))!, detector: `${resource}-resource-format`, confidence: 'high' }));
    return { body: result.body, status: `Detected at ${result.url}` };
  } catch (error) {
    const notFound = error instanceof AnalysisError && [404, 410].includes(error.responseStatus || 0);
    checks.push({ resource, sourceUrl: url.href, status: notFound ? 'NOT_FOUND' : 'UNKNOWN', httpStatus: error instanceof AnalysisError ? error.responseStatus : undefined, reason: error instanceof Error ? error.message : 'Resource check failed' });
    if (terminal(error)) throw error;
    if (notFound) return { body: '', status: 'Not detected' };
    warnings.push(`${name} could not be checked: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { body: '', status: 'Could not be checked' };
  }
}

export async function crawlSite(input: URL, options: { budget?: AnalysisBudget; fetcher?: PublicFetcher } = {}): Promise<CrawlResult> {
  const budget = options.budget || new AnalysisBudget(), fetcher = options.fetcher || fetchPublic;
  const responses: AnalyzedUrl[] = [], warnings: string[] = [], pages: ParsedPage[] = [];
  const evidenceRecords: EvidenceRecord[] = [], resourceChecks: ResourceCheck[] = [];
  const addPage = (body: string, url: string, status: number) => { const page = extractPage(body, url); pages.push(page); resourceChecks.push({ resource: 'html', sourceUrl: url, status: 'INSPECTED', httpStatus: status }); for (const diagnostic of page.diagnostics) warnings.push(`${url}: ${diagnostic}`); };
  const robotsByOrigin = new Map<string, Promise<{ body: string; status: string }>>();
  const robotsFor = (origin: string) => {
    if (!robotsByOrigin.has(origin)) robotsByOrigin.set(origin, optionalText(new URL('/robots.txt', origin), 'robots.txt', responses, warnings, fetcher, budget, evidenceRecords, resourceChecks));
    return robotsByOrigin.get(origin)!;
  };
  let robots = 'Could not be checked', sitemap = 'Could not be checked', llms = 'Could not be checked';
  const result = (): CrawlResult => ({ pages, responses, warnings, robots, sitemap, llms, evidenceRecords, resourceChecks });
  const visited = new Set<string>();
  const pending = new Set<string>();
  const guard = async (url: URL) => {
    if (visited.has(url.href)) throw new AnalysisError('DUPLICATE_URL', `Skipped already visited URL ${url.href}`, 400);
    const rules = await robotsFor(url.origin);
    budget.assertActive();
    if (!robotsAllows(rules.body, url.pathname + url.search)) throw new AnalysisError('ROBOTS', `Skipped ${url.href}: disallowed by robots.txt.`, 403);
    visited.add(url.href);
  };
  try {
    const homepage = await fetcher(input, 'html', { budget, beforeRequest: guard });
    responses.push({ url: homepage.url, status: homepage.status, contentType: homepage.contentType });
    budget.assertActive();
    addPage(homepage.body, homepage.url, homepage.status);
    const origin = new URL(homepage.url).origin;
    const robotsResult = await robotsFor(origin);
    robots = robotsResult.status;
    const sitemapLine = /^\s*Sitemap:\s*(\S+)/im.exec(robotsResult.body)?.[1];
    let sitemapUrl = new URL('/sitemap.xml', origin);
    if (sitemapLine) {
      try { const candidate = normalizePublicUrl(sitemapLine); if (candidate.origin === origin) sitemapUrl = candidate; }
      catch { warnings.push('A sitemap URL in robots.txt was unsafe and was skipped.'); }
    }
    const [sitemapResult, llmsResult] = await Promise.all([
      optionalText(sitemapUrl, 'sitemap.xml', responses, warnings, fetcher, budget, evidenceRecords, resourceChecks),
      optionalText(new URL('/llms.txt', origin), 'llms.txt', responses, warnings, fetcher, budget, evidenceRecords, resourceChecks),
    ]);
    sitemap = sitemapResult.status;
    llms = llmsResult.status;
    const candidates = pages[0].links.flatMap((link) => {
      try {
        const linkUrl = normalizePublicUrl(link.url);
        if (linkUrl.origin !== origin || !RELEVANT.test(`${linkUrl.pathname} ${link.text}`) || visited.has(linkUrl.href)) return [];
        if (isMutationUrl(linkUrl)) { warnings.push(`Skipped action/mutation URL ${linkUrl.href}`); return []; }
        return [{ ...link, url: linkUrl.href }];
      } catch { return []; }
    }).sort((a, b) => {
      const rank = (value: string) => /contact|services?|products?|shop|book|pricing/i.test(value) ? 0 : 1;
      return rank(a.url) - rank(b.url);
    });
    const selected = [...new Set(candidates.map((item) => item.url))].slice(0, budget.limits.maxPages - 1);
    for (const url of selected) pending.add(url);
    for (const candidate of [...new Set(candidates.map(item => item.url))].slice(budget.limits.maxPages - 1)) resourceChecks.push({ resource: 'html', sourceUrl: candidate, status: 'NOT_CHECKED', reason: 'Page count budget' });
    for (const url of selected) {
      budget.assertActive();
      pending.delete(url);
      if (visited.has(url)) continue;
      try {
        const response = await fetcher(new URL(url), 'html', { budget, allowedOrigin: origin, beforeRequest: guard });
        responses.push({ url: response.url, status: response.status, contentType: response.contentType });
        budget.assertActive();
        addPage(response.body, response.url, response.status);
      } catch (error) {
        resourceChecks.push({ resource: 'html', sourceUrl: url, status: 'UNKNOWN', httpStatus: error instanceof AnalysisError ? error.responseStatus : undefined, reason: error instanceof Error ? error.message : 'Page inspection failed' });
        warnings.push(`Could not inspect ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        if (terminal(error)) throw error;
      }
    }
    return result();
  } catch (error) {
    if (pages.length && terminal(error) && !(error instanceof AnalysisError && error.code === 'CANCELLED')) {
      // A budget can expire during discovery, before secondary-page selection.
      // Retain those known relevant links as uninspected, rather than implying absence.
      for (const link of pages[0].links) {
        try {
          const url = normalizePublicUrl(link.url);
          if (url.origin === new URL(pages[0].url).origin && RELEVANT.test(`${url.pathname} ${link.text}`) && !isMutationUrl(url) && !visited.has(url.href) && !resourceChecks.some(check => check.sourceUrl === url.href)) resourceChecks.push({ resource: 'html', sourceUrl: url.href, status: 'NOT_CHECKED', reason: 'Crawl budget exhausted before inspection' });
        } catch { /* Unsafe/non-HTTP links are never crawl candidates. */ }
      }
      for (const url of pending) resourceChecks.push({ resource: 'html', sourceUrl: url, status: 'NOT_CHECKED', reason: 'Crawl budget exhausted' });
      for (const resource of ['sitemap', 'llms_txt'] as const) if (!resourceChecks.some(check => check.resource === resource)) resourceChecks.push({ resource, sourceUrl: new URL(resource === 'sitemap' ? '/sitemap.xml' : '/llms.txt', pages[0].url).href, status: 'NOT_CHECKED', reason: 'Crawl budget exhausted' });
      warnings.push(`Crawl stopped: ${error instanceof Error ? error.message : 'Analysis budget reached'}`);
      return result();
    }
    throw error;
  } finally { if (!options.budget) budget.dispose(); }
}

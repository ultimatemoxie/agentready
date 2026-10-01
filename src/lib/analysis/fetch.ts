import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { AnalysisBudget } from './budget.ts';
import { AnalysisError, cancellationError, isMutationUrl, normalizePublicUrl, resolvePublicTarget, type DnsResolver, type PublicAddress } from './url.ts';

export interface PublicResponse { url: string; status: number; contentType: string; body: string; headers: http.IncomingHttpHeaders }
export interface FetchOptions {
  budget?: AnalysisBudget;
  allowedOrigin?: string;
  beforeRequest?: (url: URL) => void | Promise<void>;
}
export type PublicFetcher = (input: URL, accepted?: 'html' | 'text', options?: FetchOptions) => Promise<PublicResponse>;
export type HttpRequester = (url: URL, options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => http.ClientRequest;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const requestNative: HttpRequester = (url, options, callback) => (url.protocol === 'https:' ? https : http).request(url, options, callback);

export function createPinnedLookup(addresses: PublicAddress[]): LookupFunction {
  return (_host, options, callback) => {
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family;
    const selected = addresses.filter((entry) => !family || entry.family === family);
    if (!selected.length) { callback(Object.assign(new Error('No validated address for this family'), { code: 'ENOTFOUND' }), []); return; }
    if (options.all) callback(null, selected.map((entry) => ({ ...entry })));
    else callback(null, selected[0].address, selected[0].family);
  };
}

// Internal testing seam only: public URL and DNS validation cannot be disabled.
export function createPublicFetcher(dependencies: { resolveDns?: DnsResolver; request?: HttpRequester } = {}): PublicFetcher {
  return async (input, accepted = 'html', options = {}) => {
    const budget = options.budget || new AnalysisBudget();
    try {
      let url = normalizePublicUrl(input.href);
      for (let redirects = 0; redirects <= budget.limits.maxRedirects; redirects++) {
        budget.assertActive();
        if (isMutationUrl(url)) throw new AnalysisError('ACTION_URL', 'An action or mutation URL was skipped.', 400);
        if (options.allowedOrigin && url.origin !== options.allowedOrigin)
          throw new AnalysisError('EXTERNAL_REDIRECT', `Skipped external redirect to ${url.href}`, 400);
        await options.beforeRequest?.(url);
        budget.assertActive();
        const controller = new AbortController();
        const signal = AbortSignal.any([budget.signal, controller.signal]);
        // Absolute deadline includes DNS, TCP/TLS, headers and the entire response.
        const timer = setTimeout(() => controller.abort(new AnalysisError('TIMEOUT', 'The website reached the request time limit.', 504)), budget.limits.requestTimeoutMs);
        let response: PublicResponse;
        try {
          const addresses = await resolvePublicTarget(url, { resolveDns: dependencies.resolveDns, signal });
          budget.assertActive();
          response = await requestOnce(url, addresses, budget, signal, dependencies.request || requestNative);
        } finally { clearTimeout(timer); }
        if (REDIRECTS.has(response.status)) {
          const location = response.headers.location;
          if (!location) throw new AnalysisError('REDIRECT', 'The website returned a redirect without a destination.', 502);
          if (redirects === budget.limits.maxRedirects) throw new AnalysisError('REDIRECT_LOOP', 'The website redirected too many times.', 502);
          try { url = normalizePublicUrl(new URL(location, url).href); }
          catch (error) { if (error instanceof AnalysisError) throw error; throw new AnalysisError('REDIRECT', 'The website returned an invalid redirect destination.', 502); }
          continue;
        }
        if (response.status >= 400) {
          const error = new AnalysisError(response.status === 403 ? 'BLOCKED' : 'HTTP_ERROR',
            response.status === 403 ? 'The website blocked public access to this page.' : `The website returned HTTP ${response.status}.`, 502);
          error.responseStatus = response.status;
          throw error;
        }
        if (accepted === 'html' && !/^(text\/html|application\/xhtml\+xml)\b/i.test(response.contentType))
          throw new AnalysisError('NON_HTML', 'This URL does not return an HTML page.', 415);
        if (accepted === 'text' && !/^(text\/|application\/(xml|json|octet-stream))\b/i.test(response.contentType))
          throw new AnalysisError('NON_TEXT', 'This resource is not readable text.', 415);
        return response;
      }
      throw new AnalysisError('REDIRECT_LOOP', 'The website redirected too many times.', 502);
    } finally { if (!options.budget) budget.dispose(); }
  };
}
export const fetchPublic = createPublicFetcher();

function requestOnce(url: URL, addresses: PublicAddress[], budget: AnalysisBudget, signal: AbortSignal, requester: HttpRequester): Promise<PublicResponse> {
  return new Promise((resolve, reject) => {
    let request: http.ClientRequest | undefined, incoming: http.IncomingMessage | undefined;
    let settled = false;
    const finish = (error?: unknown, result?: PublicResponse) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error) { request?.destroy(); incoming?.destroy(); reject(error instanceof AnalysisError ? error : new AnalysisError('UNREACHABLE', 'The website could not be reached securely.', 502)); }
      else resolve(result!);
    };
    const onAbort = () => finish(cancellationError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    try {
      request = requester(url, {
        method: 'GET', lookup: createPinnedLookup(addresses), agent: false, maxHeaderSize: 16_384,
        headers: { 'user-agent': 'AgentReadyBot/0.1 (+public website diagnostic)', accept: 'text/html,text/plain,application/xml;q=0.8', 'accept-encoding': 'identity' },
      }, (response) => {
        incoming = response;
        response.on('error', (error) => finish(error));
        response.on('aborted', () => finish(new AnalysisError('UNREACHABLE', 'The website response was interrupted.', 502)));
        if (settled) { response.destroy(); return; }
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        const result = (body: string): PublicResponse => ({ url: url.href, status: response.statusCode || 0, contentType, body, headers: response.headers });
        if (REDIRECTS.has(response.statusCode || 0)) { finish(undefined, result('')); response.destroy(); return; }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          if (settled) return;
          try {
            budget.consume(chunk.length);
            bytes += chunk.length;
            if (bytes > budget.limits.maxResponseBytes) throw new AnalysisError('OVERSIZED', 'The page exceeds the response size limit.', 413);
            chunks.push(chunk);
          } catch (error) { finish(error); }
        });
        response.on('end', () => {
          if (settled) return;
          try {
            budget.assertActive();
            const encoding = response.headers['content-encoding'];
            if (encoding && encoding !== 'identity') throw new AnalysisError('ENCODING', 'The website used an unsupported response encoding.', 415);
            const charset = /charset=([^;\s]+)/i.exec(contentType)?.[1]?.replace(/["']/g, '') || 'utf-8';
            let body: string;
            try { body = new TextDecoder(charset, { fatal: true }).decode(Buffer.concat(chunks)); }
            catch { throw new AnalysisError('ENCODING', 'The website used an unsupported character encoding.', 415); }
            finish(undefined, result(body));
          } catch (error) { finish(error); }
        });
      });
      request.on('error', (error) => finish(error));
      if (settled) request.destroy(); else request.end();
    } catch (error) { finish(error); }
  });
}

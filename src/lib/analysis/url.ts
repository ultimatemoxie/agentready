import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { IANA_ADDRESS_POLICY } from './iana-address-policy.ts';

export class AnalysisError extends Error {
  code: string;
  status: number;
  responseStatus?: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

const ranges = [...IANA_ADDRESS_POLICY.ipv4, ...IANA_ADDRESS_POLICY.ipv6].map((entry) => {
  const [network, prefix] = ipaddr.parseCIDR(entry.cidr);
  return { ...entry, prefix, bytes: network.toByteArray() };
}).sort((a, b) => b.prefix - a.prefix);
const allocations = IANA_ADDRESS_POLICY.ipv6Allocations.map((cidr) => {
  const [network, prefix] = ipaddr.parseCIDR(cidr);
  return { bytes: network.toByteArray(), prefix };
});
function inRange(bytes: number[], range: { bytes: number[]; prefix: number }): boolean {
  if (bytes.length !== range.bytes.length) return false;
  const whole = Math.floor(range.prefix / 8), remainder = range.prefix % 8;
  return bytes.slice(0, whole).every((byte, index) => byte === range.bytes[index]) &&
    (!remainder || (bytes[whole] >> (8 - remainder)) === (range.bytes[whole] >> (8 - remainder)));
}
export function isPublicAddress(address: string): boolean {
  try {
    if (!isIP(address)) return false;
    // Mapped IPv6 addresses inherit the underlying IPv4 policy.
    const parsed = ipaddr.process(address);
    const bytes = parsed.toByteArray();
    if (bytes.length === 4 && bytes[0] >= 224) return false;
    const special = ranges.find((range) => inRange(bytes, range));
    if (special && !special.globallyReachable) return false;
    // Require allocated IPv6 global-unicast space, conservatively excluding
    // translation mechanisms and future/unallocated prefixes.
    return bytes.length === 4 || allocations.some((range) => inRange(bytes, range));
  } catch { return false; }
}

export function normalizePublicUrl(input: string): URL {
  const raw = input.trim();
  if (!raw || raw.length > 2048) throw new AnalysisError('INVALID_URL', 'Enter a valid public business website URL.');
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) throw new AnalysisError('UNSAFE_URL', 'Only public HTTP and HTTPS websites can be analyzed.');
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { throw new AnalysisError('INVALID_URL', 'Enter a valid website URL, such as https://yourbusiness.com.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host || host.includes('%'))
    throw new AnalysisError('UNSAFE_URL', 'Only public HTTP and HTTPS websites without embedded credentials can be analyzed.');
  if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')))
    throw new AnalysisError('UNSAFE_URL', 'Only standard web ports are supported.');
  if (host === 'localhost' || host.endsWith('.localhost') || /\.(local|internal|test|invalid|example)$/.test(host) || (!host.includes('.') && !isIP(host)))
    throw new AnalysisError('UNSAFE_URL', 'This hostname is not a public internet destination.');
  if (isIP(host) && !isPublicAddress(host)) throw new AnalysisError('UNSAFE_URL', 'Private or reserved network addresses cannot be analyzed.');
  if (isIP(host) !== 6) url.hostname = host;
  url.hash = '';
  return url;
}

export function isMutationUrl(url: URL): boolean {
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return true; }
  if (/(?:^|\/)(?:logout|log-out|signout|sign-out|add-to-cart|remove-from-cart|clear-cart|delete|unsubscribe|place-order|submit-order|pay-now)(?:\/|$)/i.test(path)) return true;
  for (const [key, value] of url.searchParams) {
    if (/^(?:add[-_]to[-_]cart|remove[-_]item|remove[-_]from[-_]cart|delete|logout|wc-ajax|_wpnonce)$/i.test(key)) return true;
    if (/^(?:action|do|cmd)$/i.test(key) && /(?:delete|remove|logout|signout|add.?to.?cart|checkout|purchase|pay|submit|place.?order)/i.test(value)) return true;
  }
  return false;
}
export type DnsResolver = (host: string) => Promise<LookupAddress[]>;
export interface PublicAddress { address: string; family: 4 | 6 }
export function cancellationError(signal: AbortSignal): AnalysisError {
  return signal.reason instanceof AnalysisError ? signal.reason : new AnalysisError('CANCELLED', 'Analysis was cancelled.', 499);
}
export function withCancellation<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancellationError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) onAbort();
  });
}
export async function resolvePublicTarget(url: URL, options: { resolveDns?: DnsResolver; signal?: AbortSignal } = {}): Promise<PublicAddress[]> {
  const safeUrl = normalizePublicUrl(url.href);
  if (options.signal?.aborted) throw cancellationError(options.signal);
  const host = safeUrl.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return [{ address: host, family: isIP(host) as 4 | 6 }];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new AnalysisError('TIMEOUT', 'Domain lookup took too long.', 504)), 3_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let addresses: LookupAddress[];
  try {
    const resolver = options.resolveDns || ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));
    addresses = await withCancellation(resolver(host), signal);
  }
  catch (error) {
    if (error instanceof AnalysisError) throw error;
    throw new AnalysisError('UNREACHABLE', 'The domain could not be resolved.', 502);
  } finally { clearTimeout(timer); }
  if (signal.aborted) throw cancellationError(signal);
  if (!addresses.length || addresses.some(({ address, family }) => ![4, 6].includes(family) || isIP(address) !== family || !isPublicAddress(address)))
    throw new AnalysisError('UNSAFE_URL', 'The domain resolves to a private or reserved network address.');
  return [...new Map(addresses.map((entry) => [entry.address, entry as PublicAddress])).values()];
}

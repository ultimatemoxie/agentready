import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { AnalysisBudget, type AnalysisLimits } from '../src/lib/analysis/budget.ts';
import { createPinnedLookup, createPublicFetcher, type HttpRequester } from '../src/lib/analysis/fetch.ts';
import { AnalysisError, isPublicAddress, normalizePublicUrl, resolvePublicTarget, type DnsResolver } from '../src/lib/analysis/url.ts';
import { analyzeWebsite } from '../src/lib/analysis/index.ts';
import { IANA_ADDRESS_POLICY } from '../src/lib/analysis/iana-address-policy.ts';

const PUBLIC4 = { address: '93.184.216.34', family: 4 as const };
const PUBLIC6 = { address: '2606:4700:4700::1111', family: 6 as const };
const URL_INPUT = 'http://business.public.com/';
const code = (expected: string) => (error: unknown) => error instanceof AnalysisError && error.code === expected;
const html = '<title>Fixture Business</title><meta name="description" content="A deterministic business fixture for the real HTTP integration test."><h1>Fixture Business</h1>';

async function infrastructure(t: TestContext, handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  resolveDns: DnsResolver = async () => [PUBLIC4], singleLookup = false) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const requests: string[] = [], lookupResults: { all: boolean; addresses: LookupAddress[] }[] = [];
  const request: HttpRequester = (url, options, callback) => {
    requests.push(url.href);
    assert.equal(options.agent, false, 'a fresh connection must use this request\'s validated DNS addresses');
    const lookup: LookupFunction = (host, lookupOptions, done) => options.lookup!(host, lookupOptions, (error, pinned, family) => {
      if (error) { done(error, pinned, family); return; }
      if (lookupOptions.all) assert.ok(Array.isArray(pinned), 'Node 24 all:true requires an array');
      else assert.equal(typeof pinned, 'string', 'single lookup requires address + family');
      const addresses = Array.isArray(pinned) ? pinned : [{ address: pinned, family: family! }];
      assert.ok(addresses.every((entry) => isPublicAddress(entry.address)));
      lookupResults.push({ all: !!lookupOptions.all, addresses });
      // Test transport routes validated public pins to an ephemeral loopback server.
      // No URL/IP-policy bypass exists in production; DNS/pin shapes are checked above.
      if (lookupOptions.all) done(null, [{ address: '127.0.0.1', family: 4 }]);
      else done(null, '127.0.0.1', 4);
    });
    return http.request({ ...options, protocol: 'http:', hostname: url.hostname, port: address.port,
      path: url.pathname + url.search, lookup, ...(singleLookup ? { family: 4 } : {}) }, callback);
  };
  return { fetcher: createPublicFetcher({ resolveDns, request }), requests, lookupResults };
}
function respond(response: http.ServerResponse, body = html, status = 200, contentType = 'text/html') {
  response.writeHead(status, { 'content-type': contentType }); response.end(body);
}
function resource(request: http.IncomingMessage, response: http.ServerResponse): boolean {
  if (request.url === '/robots.txt') { respond(response, 'User-agent: *\nAllow: /', 200, 'text/plain'); return true; }
  if (request.url === '/sitemap.xml') { respond(response, '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>', 200, 'application/xml'); return true; }
  if (request.url === '/llms.txt') { respond(response, '', 404, 'text/plain'); return true; }
  return false;
}
function budget(t: TestContext, limits: Partial<AnalysisLimits>) {
  const value = new AnalysisBudget({ limits }); t.after(() => value.dispose()); return value;
}

test('IANA global-reachability policy rejects special-use space and permits explicit global exceptions', () => {
  for (const ip of ['0.0.0.0', '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254',
    '100.64.0.1', '100.100.100.200', '198.18.0.1', '198.19.255.255', '192.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1',
    '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '100::1', '100:0:0:1::1', '2001:2::1', '2001:db8::1', '3fff::1', '5f00::1',
    '64:ff9b:1::a00:1', '64:ff9b::a00:1', '2002:a00:1::', '::ffff:127.0.0.1', '::ffff:198.18.0.1', '3000::1', 'not-an-ip'])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '192.0.0.9', '192.0.0.10', '2606:4700:4700::1111', '2001:1::1', '::ffff:8.8.8.8'])
    assert.equal(isPublicAddress(ip), true, ip);
  for (const entry of [...IANA_ADDRESS_POLICY.ipv4, ...IANA_ADDRESS_POLICY.ipv6]) {
    if (!entry.globallyReachable) assert.equal(isPublicAddress(entry.cidr.split('/')[0]), false, entry.cidr);
  }
});

test('URL normalization handles numeric/private encodings, schemes, credentials and trailing dots', () => {
  for (const url of ['http://2130706433/', 'http://0x7f000001/', 'http://127.1/', 'http://[::ffff:127.0.0.1]/',
    'http://198.18.0.1/', 'http://[100::1]/', 'file:///secret', 'ftp://business.com', 'https://user:password@business.com', 'http://localhost.'])
    assert.throws(() => normalizePublicUrl(url), code('UNSAFE_URL'));
  assert.equal(normalizePublicUrl(' HTTPS://Business.Public.COM.:443/contact#x ').href, 'https://business.public.com/contact');
});

test('pinned lookup supports single, all:true, family filtering and IPv6 callback shapes', () => {
  const lookup = createPinnedLookup([PUBLIC6, PUBLIC4]);
  lookup('business.com', { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [PUBLIC6, PUBLIC4]); });
  lookup('business.com', { family: 4 }, (error, address, family) => { assert.equal(error, null); assert.equal(address, PUBLIC4.address); assert.equal(family, 4); });
  lookup('business.com', { family: 6 }, (error, address, family) => { assert.equal(error, null); assert.equal(address, PUBLIC6.address); assert.equal(family, 6); });
});

for (const [label, answers, single] of [
  ['single IPv4 / Node all:true', [PUBLIC4], false], ['single IPv4 / single callback', [PUBLIC4], true],
  ['multiple IPv4', [PUBLIC4, { address: '1.1.1.1', family: 4 }], false],
  ['IPv6', [PUBLIC6], false], ['mixed public IPv6 + IPv4', [PUBLIC6, PUBLIC4], false],
] as const) test(`real HTTP helper handles ${label} DNS answers`, async (t) => {
  const fixture = await infrastructure(t, (_request, response) => respond(response), async () => [...answers], single);
  const result = await fixture.fetcher(normalizePublicUrl(URL_INPUT));
  assert.equal(result.status, 200); assert.ok(result.body.includes('Fixture Business'));
  assert.deepEqual(fixture.lookupResults[0].addresses, answers);
  assert.equal(fixture.lookupResults[0].all, !single);
});

test('blocked, mixed, empty and invalid-family DNS answers are rejected before connection', async () => {
  let connections = 0;
  for (const answers of [[{ address: '10.0.0.1', family: 4 }], [PUBLIC4, { address: '10.0.0.1', family: 4 }],
    [{ address: '::ffff:127.0.0.1', family: 6 }], [PUBLIC6, { address: 'fc00::1', family: 6 }],
    [{ address: '198.18.0.1', family: 4 }], [], [{ address: '1.1.1.1', family: 6 }]]) {
    const fetcher = createPublicFetcher({ resolveDns: async () => answers, request: () => { connections++; throw new Error('must not connect'); } });
    await assert.rejects(fetcher(normalizePublicUrl(URL_INPUT)), code('UNSAFE_URL'));
  }
  await assert.rejects(resolvePublicTarget(new URL('http://127.0.0.1/')), code('UNSAFE_URL'));
  const literalFetcher = createPublicFetcher({ resolveDns: async () => { throw new Error('literal must not resolve'); }, request: () => { connections++; throw new Error('must not connect'); } });
  await assert.rejects(literalFetcher(new URL('http://127.0.0.1/')), code('UNSAFE_URL'));
  assert.equal(connections, 0);
});

test('a hostname is resolved once per connection; pinned lookup does not re-resolve it', async (t) => {
  let resolutions = 0;
  const fixture = await infrastructure(t, (_request, response) => respond(response), async () => { resolutions++; return [PUBLIC4]; });
  await fixture.fetcher(normalizePublicUrl(URL_INPUT));
  assert.equal(resolutions, 1); assert.equal(fixture.lookupResults.length, 1);
});

test('redirect DNS is revalidated and a changed private answer never connects', async (t) => {
  let resolutions = 0;
  const fixture = await infrastructure(t, (_request, response) => { response.writeHead(302, { location: '/next' }); response.end(); },
    async () => ++resolutions === 1 ? [PUBLIC4] : [{ address: '192.168.1.1', family: 4 }]);
  await assert.rejects(fixture.fetcher(normalizePublicUrl(URL_INPUT)), code('UNSAFE_URL'));
  assert.equal(resolutions, 2); assert.equal(fixture.requests.length, 1);
});

test('blocked literal, credential and scheme redirects never reach the transport', async (t) => {
  let location = 'http://127.0.0.1/';
  const fixture = await infrastructure(t, (_request, response) => { response.writeHead(302, { location }); response.end(); });
  for (const destination of ['http://127.0.0.1/', 'http://[::1]/', 'http://198.18.0.1/', 'file:///secret', 'http://user:pass@business.com/']) {
    location = destination;
    const before = fixture.requests.length;
    await assert.rejects(fixture.fetcher(normalizePublicUrl(URL_INPUT)), code('UNSAFE_URL'));
    assert.equal(fixture.requests.length, before + 1);
  }
});

test('redirect loops stop at the configured redirect count', async (t) => {
  const fixture = await infrastructure(t, (_request, response) => { response.writeHead(302, { location: '/loop' }); response.end(); });
  await assert.rejects(fixture.fetcher(normalizePublicUrl(URL_INPUT), 'html', { budget: budget(t, { maxRedirects: 2 }) }), code('REDIRECT_LOOP'));
  assert.equal(fixture.requests.length, 3);
});

test('analysis uses final www/HTTPS origin, deduplicates links, skips actions and records external redirects', async (t) => {
  const fixture = await infrastructure(t, (request, response) => {
    if (resource(request, response)) return;
    if (request.headers.host?.startsWith('business.public.com:') && request.url === '/') {
      response.writeHead(301, { location: 'https://www.business.public.com/' }); response.end(); return;
    }
    if (request.url === '/') { respond(response, html + '<a href="/contact#one">Contact</a><a href="https://WWW.business.public.com:443/contact#two">Contact again</a><a href="/about">About</a><a href="/products?add-to-cart=1">Shop</a><a href="/logout">Contact logout</a><a href="https://outside.public.com/contact">External contact</a>'); return; }
    if (request.url === '/about') { response.writeHead(302, { location: 'https://outside.public.com/about' }); response.end(); return; }
    respond(response, '<h1>Contact</h1><a href="mailto:hello@business.com">Email</a>');
  });
  const report = await analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher });
  assert.equal(report.profile.name, 'Fixture Business');
  assert.ok(report.profile.contact.includes('hello@business.com'));
  assert.equal(report.run.status, 'partial');
  assert.equal(fixture.requests.filter(url => url === 'https://www.business.public.com/contact').length, 1);
  assert.ok(fixture.requests.includes('https://www.business.public.com/robots.txt'));
  assert.ok(fixture.requests.includes('https://www.business.public.com/sitemap.xml'));
  assert.ok(!fixture.requests.some(url => url.includes('outside.public.com') || url.includes('add-to-cart') || url.includes('/logout')));
  assert.ok(report.run.technicalEvidence.warnings.some(warning => warning.includes('external redirect')));
});

test('redirected homepage robots rules are checked before loading that homepage', async (t) => {
  const fixture = await infrastructure(t, (request, response) => {
    if (request.url === '/robots.txt') { respond(response, request.headers.host?.startsWith('www.') ? 'User-agent: *\nDisallow: /' : 'User-agent: *\nAllow: /', 200, 'text/plain'); return; }
    response.writeHead(302, { location: 'https://www.business.public.com/' }); response.end();
  });
  await assert.rejects(analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher }), code('ROBOTS'));
  assert.ok(!fixture.requests.includes('https://www.business.public.com/'));
});

test('analysis reaches extraction/scoring through real HTTP with bounded pages', async (t) => {
  const fixture = await infrastructure(t, (request, response) => {
    if (resource(request, response)) return;
    respond(response, html + Array.from({ length: 8 }, (_, i) => `<a href="/services/${i}">Service ${i}</a>`).join(''));
  });
  const report = await analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher, limits: { maxPages: 3 } });
  assert.equal(report.run.status, 'complete'); assert.equal(report.profile.name, 'Fixture Business');
  assert.equal(report.run.technicalEvidence.analyzedUrls.filter(item => item.contentType === 'text/html').length, 3);
  assert.ok(report.run.rawScore > 0, 'usable homepage evidence must survive even when low coverage suppresses the headline score');
});

test('slowly streaming response stops at absolute deadline and closes its connection', async (t) => {
  let closed = false;
  const fixture = await infrastructure(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }); response.write('<html>');
    const timer = setInterval(() => response.write('.'), 10);
    response.on('close', () => { closed = true; clearInterval(timer); });
  });
  const started = performance.now();
  await assert.rejects(fixture.fetcher(normalizePublicUrl(URL_INPUT), 'html', { budget: budget(t, { requestTimeoutMs: 100 }) }), code('TIMEOUT'));
  assert.ok(performance.now() - started < 1000);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(closed, true);
});

test('oversized responses stop within the per-response byte budget', async (t) => {
  const fixture = await infrastructure(t, (_request, response) => respond(response, 'x'.repeat(10_000)));
  await assert.rejects(fixture.fetcher(normalizePublicUrl(URL_INPUT), 'html', { budget: budget(t, { maxResponseBytes: 100 }) }), code('OVERSIZED'));
});

test('aggregate byte limit is shared across requests', async (t) => {
  const fixture = await infrastructure(t, (_request, response) => respond(response, 'x'.repeat(80)));
  const shared = budget(t, { maxTotalBytes: 100 });
  await fixture.fetcher(normalizePublicUrl(URL_INPUT), 'html', { budget: shared });
  await assert.rejects(fixture.fetcher(normalizePublicUrl(URL_INPUT + 'contact'), 'html', { budget: shared }), code('CRAWL_SIZE_LIMIT'));
  assert.equal(shared.signal.aborted, true);
});

test('aggregate limit during crawl preserves homepage findings in a partial report', async (t) => {
  const fixture = await infrastructure(t, (request, response) => {
    if (resource(request, response)) return;
    respond(response, request.url === '/' ? html + '<a href="/contact">Contact</a>' : 'x'.repeat(600));
  });
  const report = await analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher, limits: { maxTotalBytes: 600 } });
  assert.equal(report.run.status, 'partial'); assert.equal(report.profile.name, 'Fixture Business');
  assert.ok(report.run.technicalEvidence.warnings.some(item => item.includes('aggregate response size limit')));
});

test('late DNS completion after deadline never starts a connection', async (t) => {
  let finishDns: (answers: LookupAddress[]) => void = () => {}, connections = 0;
  const fetcher = createPublicFetcher({ resolveDns: () => new Promise(resolve => { finishDns = resolve; }),
    request: () => { connections++; throw new Error('must not connect'); } });
  await assert.rejects(fetcher(normalizePublicUrl(URL_INPUT), 'html', { budget: budget(t, { requestTimeoutMs: 30 }) }), code('TIMEOUT'));
  finishDns([PUBLIC4]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(connections, 0);
});

test('interrupted responses and non-HTML resources fail with controlled errors', async (t) => {
  const fixture = await infrastructure(t, (request, response) => {
    if (request.url === '/binary') { respond(response, 'binary', 200, 'application/pdf'); return; }
    response.writeHead(200, { 'content-type': 'text/html', 'content-length': 100 }); response.end('short');
  });
  await assert.rejects(fixture.fetcher(normalizePublicUrl(URL_INPUT)), code('UNREACHABLE'));
  await assert.rejects(fixture.fetcher(normalizePublicUrl(URL_INPUT + 'binary')), code('NON_HTML'));
});

test('total deadline after homepage returns a controlled partial report and stops crawl work', async (t) => {
  let closed = false;
  const fixture = await infrastructure(t, (request, response) => {
    if (resource(request, response)) return;
    if (request.url === '/') { respond(response, html + '<a href="/contact">Contact</a><a href="/services">Services</a>'); return; }
    response.writeHead(200, { 'content-type': 'text/html' }); response.write('<h1>');
    response.on('close', () => { closed = true; });
  });
  const started = performance.now();
  const report = await analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher, limits: { totalTimeoutMs: 150, requestTimeoutMs: 1000 } });
  assert.equal(report.run.status, 'partial'); assert.equal(report.profile.name, 'Fixture Business');
  assert.ok(report.run.technicalEvidence.warnings.some(item => item.includes('total time limit')));
  assert.ok(!fixture.requests.some(url => url.endsWith('/services')));
  assert.ok(performance.now() - started < 1000);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(closed, true);
});

test('DNS and homepage deadline failures return controlled errors without lingering connections', async (t) => {
  let connections = 0;
  const fetcher = createPublicFetcher({ resolveDns: () => new Promise(() => {}), request: () => { connections++; throw new Error('must not connect'); } });
  await assert.rejects(fetcher(normalizePublicUrl(URL_INPUT), 'html', { budget: budget(t, { requestTimeoutMs: 50 }) }), code('TIMEOUT'));
  assert.equal(connections, 0);
  const fixture = await infrastructure(t, (request, response) => { if (!resource(request, response)) response.writeHead(200, { 'content-type': 'text/html' }); });
  await assert.rejects(analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher, limits: { totalTimeoutMs: 100, requestTimeoutMs: 1000 } }), code('ANALYSIS_TIMEOUT'));
});

test('caller cancellation destroys active requests and aborts the analysis rather than scoring a partial report', async (t) => {
  const controller = new AbortController();
  let closed = false;
  const fixture = await infrastructure(t, (request, response) => {
    if (resource(request, response)) return;
    response.writeHead(200, { 'content-type': 'text/html' }); response.write('<html>');
    response.on('close', () => { closed = true; }); controller.abort();
  });
  await assert.rejects(analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher, signal: controller.signal }), code('CANCELLED'));
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(closed, true);
});

test('partial secondary failure preserves real homepage findings', async (t) => {
  const fixture = await infrastructure(t, (request, response) => {
    if (resource(request, response)) return;
    if (request.url === '/') respond(response, html + '<a href="/contact">Contact</a>'); else respond(response, '', 500);
  });
  const report = await analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher });
  assert.equal(report.run.status, 'partial'); assert.equal(report.profile.name, 'Fixture Business');
  assert.ok(report.run.technicalEvidence.warnings.some(item => item.includes('HTTP 500')));
});

test('native HTTP crawl retains secondary-page evidence and represents failed pages as unknown', async (t) => {
  const fixture = await infrastructure(t, (request, response) => {
    if (resource(request, response)) return;
    if (request.url === '/') { respond(response, html + '<a href="/contact">Contact</a><a href="/products/widget">Product</a><a href="/pricing">Pricing</a>'); return; }
    if (request.url === '/contact') { respond(response, '<a href="mailto:only-contact@business.com">Email</a>'); return; }
    if (request.url === '/products/widget') { respond(response, '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Widget","offers":{"@type":"Offer","price":18000,"priceCurrency":"NGN"}}</script>'); return; }
    respond(response, '', 503);
  });
  const report = await analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher });
  const evidence = report.run.technicalEvidence;
  assert.equal(evidence.records.find(record => record.type === 'email')?.sourceUrl, URL_INPUT + 'contact');
  const price = evidence.records.find(record => record.type === 'price')!;
  assert.equal(price.sourceUrl, URL_INPUT + 'products/widget'); assert.equal(price.details?.currency, 'NGN'); assert.equal(price.details?.offering, 'Widget');
  assert.ok(evidence.checks.some(check => check.type === 'price' && check.sourceUrl === URL_INPUT + 'pricing' && check.status === 'UNKNOWN'));
  for (const record of evidence.records) assert.ok(evidence.analyzedUrls.some(page => page.url === record.sourceUrl), record.sourceUrl);
  for (const rule of report.run.categoryScores.flatMap(category => category.rules).filter(rule => rule.earned)) assert.ok(rule.evidenceIds?.length);
});

test('native sitemap timeout is unknown, excluded from evaluated points and deficiency recommendations', async (t) => {
  const fixture = await infrastructure(t, (request, response) => {
    if (request.url === '/sitemap.xml') { response.writeHead(200, { 'content-type': 'application/xml' }); response.write('<urlset'); return; }
    if (resource(request, response)) return;
    respond(response, html);
  });
  const report = await analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher, limits: { requestTimeoutMs: 100 } });
  const rule = report.run.categoryScores.flatMap(category => category.rules).find(rule => rule.ruleId === 'discovery.sitemap')!;
  assert.equal(rule.state, 'UNKNOWN'); assert.equal(rule.pointsEarned, null); assert.match(rule.reason, /time limit/);
  assert.ok(!report.run.recommendations.some(item => item.relatedRuleIds.includes(rule.ruleId)));
  assert.equal(report.run.analysisStatus, 'partial');
});

test('budget exhausted during discovery retains secondary context as not checked and never recommends missing prices/contact', async (t) => {
  const fixture = await infrastructure(t, (request, response) => {
    if (request.url === '/sitemap.xml') { response.writeHead(200, { 'content-type': 'application/xml' }); response.write('<urlset'); return; }
    if (resource(request, response)) return;
    respond(response, html + '<a href="/contact">Contact us</a><a href="/pricing">Pricing</a>');
  });
  const report = await analyzeWebsite(URL_INPUT, { fetcher: fixture.fetcher, limits: { totalTimeoutMs: 150, requestTimeoutMs: 1000 } });
  assert.equal(report.run.status, 'partial');
  for (const path of ['contact', 'pricing']) assert.ok(report.run.technicalEvidence.resourceChecks.some(check => check.sourceUrl === URL_INPUT + path && check.status === 'NOT_CHECKED'));
  for (const id of ['communication.email', 'offering.prices', 'transaction.prices']) {
    const rule = report.run.categoryScores.flatMap(category => category.rules).find(rule => rule.ruleId === id)!;
    assert.equal(rule.state, 'UNKNOWN'); assert.equal(rule.pointsEarned, null); assert.ok(!report.run.recommendations.some(item => item.relatedRuleIds.includes(id)));
  }
});

test('mutation targets are rejected before DNS resolution or connection', async () => {
  let resolutions = 0, connections = 0;
  const fetcher = createPublicFetcher({ resolveDns: async () => { resolutions++; return [PUBLIC4]; }, request: () => { connections++; throw new Error('must not connect'); } });
  for (const path of ['products?add-to-cart=1', 'contact?action=delete', 'logout', 'cart?wc-ajax=checkout'])
    await assert.rejects(fetcher(normalizePublicUrl(URL_INPUT + path)), code('ACTION_URL'));
  assert.equal(resolutions, 0); assert.equal(connections, 0);
});

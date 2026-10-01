import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPage } from '../src/lib/analysis/extract.ts';
import { classify, type Facts } from '../src/lib/analysis/classify.ts';
import { scoreFacts, statusFor, buildReport } from '../src/lib/analysis/score.ts';
import { normalizePublicUrl, isPublicAddress } from '../src/lib/analysis/url.ts';
import { robotsAllows, type CrawlResult } from '../src/lib/analysis/crawl.ts';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf8');
const classifyFixture = (name: string) => {
  const page = extractPage(fixture(name), name === 'ecommerce.html' ? 'https://meridian.example/' : 'https://business.example/');
  const crawl: CrawlResult = { pages: [page], responses: [{ url: page.url, status: 200, contentType: 'text/html' }], warnings: [],
    robots: 'Not detected', sitemap: 'Not detected', llms: 'Not detected' };
  return classify(crawl);
};

test('normalizes a website URL and blocks unsafe schemes and credentials', () => {
  assert.equal(normalizePublicUrl('example.com/path#anchor').href, 'https://example.com/path');
  assert.equal(normalizePublicUrl('https://[2606:4700:4700::1111]/').hostname, '[2606:4700:4700::1111]');
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com', 'http://localhost', 'http://example.com:8080'])
    assert.throws(() => normalizePublicUrl(url));
});

test('rejects private, loopback, link-local and metadata addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.100.100.200', '::1', 'fe80::1', '::ffff:127.0.0.1'])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('extracts exact JSON-LD types and offerings from ecommerce fixture', () => {
  const page = extractPage(fixture('ecommerce.html'), 'https://meridian.example/');
  assert.deepEqual(page.schemaTypes, ['Organization', 'PostalAddress', 'Product', 'Offer']);
  assert.deepEqual(page.offerings, ['Woven Basket']);
  assert.ok(page.prices.includes('₦12,500'));
  assert.ok(page.resourceUrls.some((url) => url.includes('paystack')));
});

test('detects contact, WhatsApp and provider indicators without claiming a completed transaction', () => {
  const result = classifyFixture('nigerian-sme.html');
  assert.equal(result.facts.whatsapp, true);
  assert.equal(result.facts.phone, true);
  assert.deepEqual(result.evidence.providers, ['Paystack']);
  assert.equal(result.facts.cartCheckout, false);
});

test('detects policy links and purposeful booking forms', () => {
  const ecommerce = classifyFixture('ecommerce.html');
  assert.equal(ecommerce.facts.privacy, true);
  assert.equal(ecommerce.facts.terms, true);
  assert.equal(ecommerce.facts.returnPolicy, true);
  const service = classifyFixture('service.html');
  assert.equal(service.facts.actionFlow, true);
  assert.equal(service.evidence.forms[0].purpose, 'booking');
});

test('score is deterministic, bounded and category totals equal 100', () => {
  const empty = Object.fromEntries(Object.keys(classifyFixture('ambiguous.html').facts).map((key) => [key, false])) as unknown as Facts;
  const full = Object.fromEntries(Object.keys(empty).map((key) => [key, true])) as unknown as Facts;
  assert.equal(scoreFacts(empty).reduce((sum, category) => sum + category.score, 0), 0);
  assert.equal(scoreFacts(full).reduce((sum, category) => sum + category.score, 0), 100);
  assert.deepEqual(scoreFacts(full).map((category) => category.max), [15, 15, 15, 15, 10, 20, 10]);
  assert.deepEqual(scoreFacts(full), scoreFacts(full));
  assert.equal(statusFor(70), 'Strong foundation');
  const ecommerce = scoreFacts(classifyFixture('ecommerce.html').facts);
  assert.deepEqual(ecommerce.map((category) => category.score), [15, 13, 9, 15, 5, 11, 10]);
});

test('ambiguous pages do not invent a business identity', () => {
  const result = classifyFixture('ambiguous.html');
  assert.equal(result.profile.name, 'Unidentified business');
  assert.equal(result.facts.name, false);
});

test('report recommendations are deduplicated and research flags remain available', () => {
  const classification = classifyFixture('ecommerce.html');
  classification.facts.canonical = false;
  const report = buildReport('meridian.example', 'https://meridian.example/', classification);
  assert.equal(report.run.researchSignals.prices, true);
  assert.ok(report.positiveSignals.includes('HTTPS enabled'));
  assert.equal(report.run.recommendations.filter((item) => item.title.toLowerCase().includes('canonical')).length, 1);
});

test('robots rules honor the specific user agent and longest path', () => {
  const robots = 'User-agent: *\nDisallow: /private\n\nUser-agent: AgentReadyBot\nDisallow: /secret\nAllow: /secret/public';
  assert.equal(robotsAllows(robots, '/secret/report'), false);
  assert.equal(robotsAllows(robots, '/secret/public/info'), true);
  assert.equal(robotsAllows(robots, '/private'), true);
});

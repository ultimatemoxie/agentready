import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractPage } from '../src/lib/analysis/extract.ts';
import { classify } from '../src/lib/analysis/classify.ts';
import { buildReport } from '../src/lib/analysis/score.ts';
import { evidenceSchema } from '../src/lib/analysis/evidence.ts';
import { linkEvidence } from '../src/lib/analysis/link-detectors.ts';
import { isSchemaType } from '../src/lib/analysis/schema.ts';
import { analyzeWebsite } from '../src/lib/analysis/index.ts';
import { AnalysisError } from '../src/lib/analysis/url.ts';
import type { PublicFetcher } from '../src/lib/analysis/fetch.ts';
import type { ResourceCheck } from '../src/lib/types.ts';

const base = 'https://business.public.com/';
const fixture = (name: string) => readFileSync(`tests/fixtures/${name}.html`, 'utf8');
const jsonld = (object: unknown) => `<script type="application/ld+json">${JSON.stringify(object)}</script>`;
function classification(pages: { html: string; url: string }[], resourceChecks?: ResourceCheck[]) {
  return classify({ pages: pages.map(page => extractPage(page.html, page.url)), responses: pages.map(page => ({ url: page.url, status: 200, contentType: 'text/html' })), warnings: [], robots: 'Not detected', sitemap: 'Not detected', llms: 'Not detected', resourceChecks });
}
const one = (html: string, url = base) => classification([{ html, url }]);

test('Facebook is a social link and never a booking path, even with Book anchor text', () => {
  for (const text of ['Facebook', 'Book now', 'Booking']) {
    const result = one(`<a href="https://facebook.com/business">${text}</a>`);
    assert.equal(result.facts.actionFlow, false); assert.equal(result.profile.booking, undefined); assert.equal(result.facts.social, true);
  }
});
test('Return home is not a return policy', () => {
  const result = one('<a href="/">Return home</a>');
  assert.equal(result.facts.returnPolicy, false); assert.deepEqual(result.profile.policies, []);
});
test('WhatsApp requires an official host/action, not URL query or misleading host text', () => {
  for (const url of ['/redirect?target=wa.me/2348012345678', 'https://not-whatsapp.com/wa.me/2348012345678', 'https://wa.me.evil.com/2348012345678', 'https://whatsapp.com/blog/2348012345678', 'https://wa.me/abc']) assert.equal(one(`<a href="${url}">WhatsApp</a>`).facts.whatsapp, false, url);
  for (const url of ['https://wa.me/2348012345678', 'https://api.whatsapp.com/send?phone=2348012345678', 'https://web.whatsapp.com/send?phone=2348012345678', 'whatsapp://send?phone=2348012345678']) {
    const result = one(`<a href="${url}">Chat</a>`, base + 'contact');
    assert.equal(result.facts.whatsapp, true, url);
    const record = result.evidence.records.find(record => record.type === 'whatsapp')!;
    assert.equal(record.sourceUrl, base + 'contact'); assert.equal(record.confidence, 'high'); assert.ok(record.rawEvidence.includes(url));
  }
});
test('booking/reservation/appointment/quote/cart/checkout actions stay distinct', () => {
  const result = one(['book', 'reserve', 'appointment', 'quote', 'cart', 'checkout'].map(path => `<a href="/${path}">${path}</a>`).join(''));
  for (const type of ['booking', 'reservation', 'appointment', 'quote', 'cart', 'checkout']) assert.ok(result.evidence.records.some(record => record.type === type), type);
  assert.equal(one('<a href="/quote">Request a quote</a>').profile.booking, undefined);
  for (const path of ['/notebook', '/bookkeeping', '/blog/book-review', '/returns-to-home', '/products/book']) assert.equal(one(`<a href="${path}">Read</a>`).facts.actionFlow, false, path);
});
test('policy paths and semantic anchors are recognized without arbitrary keywords', () => {
  const result = one('<a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms</a><a href="/policies/returns">Returns</a><a href="/shipping-policy">Shipping policy</a><a href="/cancellation-policy">Cancellation policy</a>');
  for (const type of ['privacy', 'terms', 'return_policy', 'shipping_policy', 'cancellation_policy']) assert.ok(result.evidence.records.some(record => record.type === type));
  assert.equal(one('<a href="/blog/return-policy-debate">Return policy</a>').facts.returnPolicy, false);
  assert.equal(one('<a href="/about?terms=1">Our terms of art</a>').facts.terms, false);
});
test('custom vocabularies and overridden type terms cannot earn Schema.org identity', () => {
  for (const context of ['https://custom-vocabulary.com', { '@vocab': 'https://custom-vocabulary.com/' }, { '@vocab': 'https://schema.org/', Organization: 'https://custom-vocabulary.com/Organization' }, { '@vocab': 'https://schema.org/', Organization: null }, ['https://schema.org', 'https://custom-vocabulary.com']]) {
    const result = one(jsonld({ '@context': context, '@type': 'Organization', name: 'Not our organization' }));
    assert.equal(result.facts.identitySchema, false); assert.equal(result.facts.schema, false); assert.equal(result.facts.name, false);
  }
});
test('Schema.org contexts, compact prefixes, keyword aliases and absolute IRIs are supported', () => {
  for (const object of [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Business' },
    { '@context': 'http://schema.org/', '@type': 'Organization', name: 'Business' },
    { '@context': { '@vocab': 'https://schema.org/' }, '@type': 'Organization', name: 'Business' },
    { '@context': { schema: 'https://schema.org/' }, '@type': 'schema:Organization', 'schema:name': 'Business' },
    { '@context': { '@vocab': 'https://schema.org/', kind: '@type', title: 'name' }, kind: 'Organization', title: 'Business' },
    { '@type': 'https://schema.org/Organization', 'https://schema.org/name': 'Business' },
  ]) { const result = one(jsonld(object)); assert.equal(result.facts.identitySchema, true); assert.equal(result.profile.name, 'Business'); }
});
test('LocalBusiness subtypes use official inheritance and retain their exact type', () => {
  for (const type of ['Restaurant', 'Store', 'ProfessionalService', 'MedicalBusiness', 'Dentist', 'Bakery']) {
    assert.equal(isSchemaType(type, 'LocalBusiness'), true, type);
    const result = one(jsonld({ '@context': 'https://schema.org', '@type': type, name: 'Fixture Business' }));
    assert.equal(result.facts.identitySchema, true); assert.deepEqual(result.profile.structuredData, [type]);
  }
  assert.equal(isSchemaType('NotARealBusinessType', 'Organization'), false);
});
test('an organization describing a foreign site is not adopted as this business identity', () => {
  const result = one(jsonld({ '@context': 'https://schema.org', '@type': 'Organization', '@id': 'https://unrelated.com/#org', name: 'Foreign' }));
  assert.equal(result.facts.identitySchema, false); assert.equal(result.facts.name, false); assert.equal(result.facts.schema, true);
});
test('email, price and Product schema on secondary pages retain exact page provenance', () => {
  const result = classification([
    { html: '<title>Business</title>', url: base },
    { html: fixture('contact'), url: base + 'contact' },
    { html: fixture('pricing'), url: base + 'pricing' },
    { html: jsonld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Corporate shirt', sku: 'SHIRT-001', offers: { '@type': 'Offer', price: 18000, priceCurrency: 'NGN' } }), url: base + 'products/shirt' },
  ]);
  assert.equal(result.ruleEvidence.email[0].sourceUrl, base + 'contact');
  const textPrice = result.ruleEvidence.prices.find(record => record.detector === 'currency-amount-text')!;
  assert.equal(textPrice.sourceUrl, base + 'pricing'); assert.equal(textPrice.details?.currency, 'GBP'); assert.equal(textPrice.details?.offering, 'Project consultation');
  const productPrice = result.ruleEvidence.prices.find(record => record.sourceType === 'schema_org')!;
  assert.deepEqual(productPrice.details, { amount: '18000', currency: 'NGN', offering: 'Corporate shirt' }); assert.equal(productPrice.sourceUrl, base + 'products/shirt');
  assert.equal(result.evidence.records.find(record => record.type === 'schema_type' && record.value === 'Product')?.sourceUrl, base + 'products/shirt');
});
test('identical evidence on two pages is not merged into an incorrect source', () => {
  const result = classification([{ html: '<a href="mailto:hello@business.com">Email</a>', url: base }, { html: '<a href="mailto:hello@business.com">Email</a>', url: base + 'contact' }]);
  assert.deepEqual(result.ruleEvidence.email.map(record => record.sourceUrl), [base, base + 'contact']); assert.notEqual(result.ruleEvidence.email[0].id, result.ruleEvidence.email[1].id);
});
test('graph references associate Product and Offer without losing currency', () => {
  const result = one(jsonld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Product', '@id': '#product', name: 'Widget', offers: { '@id': '#offer' }, hasVariant: { '@type': 'Product', name: 'Blue Widget', sku: 'BLUE', color: 'blue' } }, { '@type': 'Offer', '@id': '#offer', price: '99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }] }));
  assert.ok(result.ruleEvidence.prices.some(record => record.details?.currency === 'USD' && record.details?.offering === 'Widget'));
  assert.ok(result.evidence.records.some(record => record.type === 'variant' && record.value === 'Blue Widget'));
  assert.ok(result.evidence.records.some(record => record.type === 'availability' && record.value === 'InStock'));
});
test('currency text needs a named offering for scoring; article numbers and phone numbers do not become prices', () => {
  const weak = one('<p>2024 18000 2348012345678</p><p>₦18,000</p>');
  assert.equal(weak.facts.prices, false); assert.equal(weak.facts.phone, false); assert.equal(weak.evidence.records.find(record => record.type === 'price')?.confidence, 'low');
  for (const [text, currency] of [['₦18,000', 'NGN'], ['NGN 18000', 'NGN'], ['$99', undefined], ['USD 99', 'USD'], ['£50', undefined], ['€120', 'EUR']] as const) {
    const result = one(`<div class="product-card"><h2>Corporate shirt</h2><p>${text}</p></div>`);
    assert.equal(result.facts.prices, true, text); assert.equal(result.ruleEvidence.prices[0].details?.currency, currency);
  }
  assert.equal(one('<article><div class="product-card"><h2>Other company widget</h2><p>USD 99</p></div></article>', base + 'blog/review').facts.prices, false);
});
test('address and hours come from explicit structured fields or labeled HTML', () => {
  const result = one(jsonld({ '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Kitchen', address: { '@type': 'PostalAddress', streetAddress: '12 Market Road', addressLocality: 'Abuja', addressCountry: 'NG' }, openingHoursSpecification: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday'], opens: '09:00', closes: '18:00' } }));
  assert.ok(result.profile.location?.includes('Abuja')); assert.ok(result.profile.openingHours?.includes('09:00'));
  const plain = one(fixture('nigerian-sme')); assert.ok(plain.profile.location?.includes('Abuja')); assert.ok(plain.profile.openingHours?.includes('Monday-Friday'));
  assert.equal(one('<p>We love Lagos in 2024. Meeting Tuesday at 9am.</p>').facts.location, false);
});
test('explicit machine references remain distinct and never infer MCP from an API', () => {
  const api = one('<a href="/docs/api">API documentation</a><a href="/openapi.yaml">OpenAPI</a>');
  assert.equal(api.facts.apiDocs, true); assert.ok(!api.evidence.records.some(record => record.type === 'mcp_reference'));
  const all = one('<a href="/docs/mcp">MCP documentation</a><a href="/.well-known/agent-card.json">Agent Card</a><a href="/catalog.csv">Product feed</a><link rel="alternate" type="application/rss+xml" href="/feed.xml">');
  for (const type of ['mcp_reference', 'agent_card_reference', 'product_feed', 'feed']) assert.ok(all.evidence.records.some(record => record.type === type), type);
  assert.equal(all.facts.apiDocs, false);
});
test('payment indicators require official resources, not brand mentions or fake domains', () => {
  assert.equal(one('<p>We discussed Paystack, Stripe, Flutterwave and Shopify.</p><script src="https://js.stripe.com.evil.com/test"></script>').facts.paymentProvider, false);
  const result = one(fixture('nigerian-sme')); assert.deepEqual(result.evidence.providers, ['Paystack']); assert.ok(result.evidence.records.some(record => record.type === 'payment_link'));
});
test('malformed URL escapes and malformed JSON-LD cannot crash extraction', () => {
  assert.doesNotThrow(() => linkEvidence({ url: base + '%ZZ', text: 'Booking' }, base));
  const result = one('<script type="application/ld+json">{invalid}</script><a href="mailto:good@business.com">Email</a>');
  assert.equal(result.facts.email, true); assert.equal(result.facts.schema, false); assert.ok(result.evidence.checks.some(check => check.type === 'schema_type' && check.status === 'UNKNOWN'));
});
test('all fixture detections are schema-valid and every earned scoring rule references eligible evidence', () => {
  for (const name of ['ecommerce', 'service', 'nigerian-sme', 'noisy']) {
    const result = one(fixture(name)), report = buildReport(base, base, result), ids = new Map(result.evidence.records.map(record => [record.id, record]));
    for (const signal of result.signals) { const { key, label, kind, ...record } = signal; void key; void label; void kind; evidenceSchema.parse(record); assert.equal(signal.sourceUrl, base); }
    for (const category of report.run.categoryScores) for (const rule of category.rules.filter(rule => rule.earned)) {
      assert.ok(rule.evidence); assert.ok(rule.evidenceIds?.length); for (const id of rule.evidenceIds!) { assert.ok(ids.has(id)); assert.notEqual(ids.get(id)!.confidence, 'low'); assert.ok(rule.evidence!.includes(ids.get(id)!.sourceUrl)); }
    }
  }
});
test('fixture matrix exposes obvious offerings and keeps Nigerian commerce signals independent', () => {
  assert.ok(one(fixture('ecommerce')).profile.productsServices.includes('Woven Basket'));
  assert.ok(one(fixture('service')).profile.productsServices.includes('Architectural design'));
  assert.ok(one(fixture('services'), base + 'services').profile.productsServices.includes('Project consultation'));
  const sme = one(fixture('nigerian-sme'));
  assert.ok(sme.profile.productsServices.includes('Family jollof tray')); assert.equal(sme.facts.whatsapp, true); assert.equal(sme.facts.paymentProvider, true); assert.equal(sme.facts.cartCheckout, false); assert.equal(sme.facts.identitySchema, false);
  const noisy = one(fixture('noisy')); for (const key of ['identitySchema', 'prices', 'phone', 'email', 'whatsapp', 'actionFlow', 'returnPolicy'] as const) assert.equal(noisy.facts[key], false, key);
});
test('pricing feature lists and editorial headings are not offerings; scoped plans retain prices', () => {
  const result = one(fixture('pricing-noise'), base + 'pricing');
  assert.deepEqual(result.profile.productsServices, ['Studio']);
  assert.equal(result.ruleEvidence.prices[0].details?.offering, 'Studio');
  assert.equal(result.ruleEvidence.prices[0].confidence, 'medium');
  assert.equal(result.ruleEvidence.prices[0].details?.currency, undefined);
});

// Deterministic crawl boundary fixtures; native DNS/HTTP/pinning coverage remains in fetch-crawl.test.ts.
const fixtureFetcher: PublicFetcher = async (url, mode) => {
  if (mode === 'text') throw Object.assign(new AnalysisError('HTTP', 'HTTP 404'), { responseStatus: 404 });
  if (url.pathname === '/contact' || url.pathname === '/pricing') throw Object.assign(new AnalysisError('HTTP', 'HTTP 503'), { responseStatus: 503 });
  return { url: url.href, status: 200, contentType: 'text/html', body: fixture('partial'), headers: {} };
};
test('partial crawl preserves findings and marks failed contact/pricing checks UNKNOWN', async () => {
  const report = await analyzeWebsite(base, { fetcher: fixtureFetcher });
  assert.equal(report.run.status, 'partial'); assert.equal(report.run.researchSignals.email, false);
  const evidence = report.run.technicalEvidence;
  for (const [type, path] of [['email', 'contact'], ['price', 'pricing']]) assert.ok(evidence.checks.some(check => check.type === type && check.sourceUrl === base + path && check.status === 'UNKNOWN'));
  assert.equal(report.profile.agentView.find(field => field.label === 'Price information')?.status, 'Unknown');
  assert.equal(report.profile.agentView.find(field => field.label === 'Contact')?.status, 'Unknown');
  assert.ok(evidence.checks.some(check => check.type === 'email' && check.sourceUrl === base && check.status === 'NOT_DETECTED'));
  assert.ok(evidence.resourceChecks.some(check => check.resource === 'robots' && check.status === 'NOT_FOUND'));
});
test('HTML fallback resource pages do not earn robots/sitemap/llms points', async () => {
  const fetcher: PublicFetcher = async url => ({ url: url.href, status: 200, contentType: 'text/html', body: '<title>Fixture Business</title><h1>Fixture Business</h1>', headers: {} });
  const report = await analyzeWebsite(base, { fetcher });
  for (const type of ['robots', 'sitemap', 'llms']) { assert.equal(report.run.researchSignals[type], false); assert.ok(report.run.technicalEvidence.checks.some(check => check.type === type && check.status === 'UNKNOWN')); }
});

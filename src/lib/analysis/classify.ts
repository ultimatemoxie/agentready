import type { BusinessProfile, DetectedSignal, TechnicalEvidence, AgentField, EvidenceRecord, EvidenceCheck, ResourceCheck } from '../types.ts';
import type { CrawlResult } from './crawl.ts';
import { eligible, makeEvidence, uniqueEvidence } from './evidence.ts';

export interface Facts {
  name: boolean; description: boolean; contact: boolean; location: boolean; identitySchema: boolean; canonical: boolean;
  offerings: boolean; offeringDescriptions: boolean; categories: boolean; prices: boolean; identifiers: boolean;
  metadata: boolean; sitemap: boolean; schema: boolean; robots: boolean; llms: boolean;
  https: boolean; privacy: boolean; terms: boolean; returnPolicy: boolean; support: boolean;
  email: boolean; phone: boolean; whatsapp: boolean; contactFlow: boolean; social: boolean;
  actionFlow: boolean; purposefulForm: boolean; actionCta: boolean; search: boolean; apiDocs: boolean; account: boolean;
  cartCheckout: boolean; paymentProvider: boolean; purchaseCta: boolean;
}
export interface Classification { facts: Facts; profile: BusinessProfile; signals: DetectedSignal[]; evidence: TechnicalEvidence; ruleEvidence: Record<keyof Facts, EvidenceRecord[]> }
const uniq = <T,>(values: T[]): T[] => [...new Set(values)];
const POLICIES = ['privacy', 'terms', 'return_policy', 'shipping_policy', 'cancellation_policy'];
const ENDPOINTS = ['api_documentation', 'openapi_reference', 'mcp_reference', 'agent_card_reference', 'product_feed', 'feed'];

export function classify(crawl: CrawlResult): Classification {
  const home = crawl.pages[0];
  const records = uniqueEvidence([...crawl.pages.flatMap(page => page.evidence), ...(crawl.evidenceRecords || []), ...(home.url.startsWith('https:') ? [makeEvidence({ type: 'https', value: home.url, sourceUrl: home.url, sourceType: 'header', rawEvidence: `Successful HTTPS response at ${home.url}`, detector: 'https-response-url', confidence: 'high' })] : [])]);
  const select = (...types: string[]) => records.filter(record => eligible(record) && types.includes(record.type));
  const values = (...types: string[]) => uniq(select(...types).map(record => record.value));
  const join = (...types: string[]) => values(...types).join(' · ');
  const discovery = (type: string) => select(type).filter(record => new URL(record.sourceUrl).origin === new URL(home.url).origin);
  const homeIdentity = select('business_name').filter(record => record.sourceUrl === home.url);
  const nameRecords = (homeIdentity.length ? homeIdentity : select('business_name').filter(record => record.sourceType === 'schema_org')).sort((a, b) => (a.sourceType === 'schema_org' ? 0 : a.confidence === 'high' ? 1 : 2) - (b.sourceType === 'schema_org' ? 0 : b.confidence === 'high' ? 1 : 2));
  const descriptions = select('description').filter(record => record.sourceUrl === home.url).sort((a, b) => Number(b.sourceType === 'schema_org') - Number(a.sourceType === 'schema_org'));
  const metadata = select('title', 'description').filter(record => record.sourceUrl === home.url && record.sourceType === 'meta');
  const ruleEvidence: Record<keyof Facts, EvidenceRecord[]> = {
    name: nameRecords.slice(0, 1), description: descriptions.filter(record => record.value.length >= 30).slice(0, 1), contact: select('email', 'phone', 'whatsapp'), location: select('location', 'service_area'),
    identitySchema: select('identity_schema'), canonical: select('canonical').filter(record => record.sourceUrl === home.url),
    offerings: select('product', 'service', 'offering'), offeringDescriptions: select('offering_description'), categories: select('category'), prices: select('price'), identifiers: select('identifier', 'availability'),
    metadata: metadata.some(record => record.type === 'title') && metadata.some(record => record.type === 'description') ? metadata : [],
    sitemap: discovery('sitemap'), schema: select('schema_type'), robots: discovery('robots'), llms: discovery('llms'), https: select('https'),
    privacy: select('privacy'), terms: select('terms'), returnPolicy: select('return_policy', 'cancellation_policy'), support: select('support', 'contact', 'email', 'phone'),
    email: select('email'), phone: select('phone'), whatsapp: select('whatsapp'), contactFlow: select('contact', 'support', 'email', 'phone', 'whatsapp', 'chat_widget'), social: select('social'),
    actionFlow: select('booking', 'reservation', 'appointment', 'quote', 'cart', 'checkout', 'purchase'), purposefulForm: select('purposeful_form'), actionCta: select('action_cta'), search: select('search'),
    apiDocs: select('api_documentation', 'openapi_reference'), account: select('account'), cartCheckout: select('cart', 'checkout'), paymentProvider: select('payment_provider', 'commerce_platform'), purchaseCta: select('purchase'),
  };
  const facts = Object.fromEntries(Object.entries(ruleEvidence).map(([key, evidence]) => [key, evidence.length > 0])) as unknown as Facts;
  const resourceChecks: ResourceCheck[] = crawl.resourceChecks || crawl.pages.map(page => ({ resource: 'html', sourceUrl: page.url, status: 'INSPECTED' }));
  const incompleteHtml = resourceChecks.some(check => check.resource === 'html' && ['UNKNOWN', 'NOT_CHECKED'].includes(check.status));
  const parserIncomplete = crawl.pages.some(page => page.diagnostics.length > 0);
  const resourceFor = (type: string) => type === 'llms' ? 'llms_txt' : ['robots', 'sitemap'].includes(type) ? type : undefined;
  const checks: EvidenceCheck[] = [];
  for (const type of uniq([...records.map(record => record.type), 'business_name', 'description', 'category', 'location', 'service_area', 'opening_hours', 'identifier', 'variant', 'availability', 'identity_schema', 'canonical', 'product', 'service', 'offering', 'offering_description', 'email', 'phone', 'price', 'whatsapp', 'schema_type', 'booking', 'reservation', 'appointment', 'quote', 'cart', 'checkout', 'contact', 'purchase', 'search', 'support', 'account', 'purposeful_form', 'payment_provider', ...POLICIES, ...ENDPOINTS, 'robots', 'sitemap', 'llms'])) {
    const resource = resourceFor(type), detected = resource ? discovery(type) : select(type), inspectedResource = resource ? resourceChecks.filter(check => check.resource === resource && new URL(check.sourceUrl).origin === new URL(home.url).origin) : [];
    const unknown = resource ? inspectedResource.some(check => check.status === 'UNKNOWN') : incompleteHtml || parserIncomplete;
    const notChecked = resource ? !inspectedResource.length || inspectedResource.every(check => check.status === 'NOT_CHECKED') : false;
    checks.push({ type, status: detected.length ? 'DETECTED' : notChecked ? 'NOT_CHECKED' : unknown ? 'UNKNOWN' : 'NOT_DETECTED', sourceUrl: inspectedResource[0]?.sourceUrl || home.url, evidenceIds: detected.map(record => record.id),
      reason: detected.length ? incompleteHtml || parserIncomplete ? 'Detected in inspected content; other content could not be checked.' : undefined : unknown || notChecked ? 'Coverage incomplete: see resource checks and parser warnings.' : 'No qualifying evidence in the inspected content. This is not proof of site-wide absence.' });
  }
  // Page checks keep NOT_DETECTED scoped to pages actually parsed; failures never produce absence claims.
  for (const page of crawl.pages) for (const type of ['email', 'price', 'schema_type', 'product', 'service']) {
    const detected = page.evidence.filter(record => eligible(record) && record.type === type);
    checks.push({ type, status: detected.length ? 'DETECTED' : page.diagnostics.length ? 'UNKNOWN' : 'NOT_DETECTED', sourceUrl: page.url, evidenceIds: detected.map(record => record.id) });
  }
  for (const check of resourceChecks.filter(check => check.resource === 'html' && ['UNKNOWN', 'NOT_CHECKED'].includes(check.status))) for (const type of ['email', 'price', 'schema_type', 'product', 'service']) checks.push({ type, status: check.status === 'UNKNOWN' ? 'UNKNOWN' : 'NOT_CHECKED', sourceUrl: check.sourceUrl, evidenceIds: [], reason: check.reason });
  const field = (label: string, types: string[], overrides?: EvidenceRecord[]): AgentField => {
    const selected = overrides || select(...types), unknown = types.some(type => checks.some(check => check.type === type && ['UNKNOWN', 'NOT_CHECKED'].includes(check.status)));
    return { label, status: selected.length ? selected.some(record => record.confidence === 'medium') ? 'Partially detected' : 'Detected' : unknown ? 'Unknown' : 'Not detected', value: selected.length ? uniq(selected.map(record => record.value)).join(' · ') : unknown ? 'Could not complete relevant checks' : 'No qualifying public evidence found', sourceUrl: selected[0]?.sourceUrl, evidenceIds: selected.map(record => record.id) };
  };
  const schemaTypes = values('schema_type').sort(), contact = values('email', 'phone'), policies = values(...POLICIES);
  const profile: BusinessProfile = {
    name: nameRecords[0]?.value || 'Unidentified business', description: descriptions[0]?.value || undefined, category: join('category') || undefined,
    location: join('location') || undefined, serviceArea: join('service_area') || undefined, productsServices: values('product', 'service', 'offering'), priceInformation: join('price') || undefined,
    availability: join('availability') || undefined, variants: join('variant') || undefined, openingHours: join('opening_hours') || undefined, contact,
    whatsapp: values('whatsapp')[0], booking: values('booking', 'reservation', 'appointment')[0], checkout: values('checkout', 'cart')[0], policies, structuredData: schemaTypes, machineEndpoints: values(...ENDPOINTS), evidence: records,
    agentView: [field('Business', ['business_name'], nameRecords.slice(0, 1)), field('Category', ['category']), field('Description', ['description'], descriptions.slice(0, 1)), field('Location', ['location']), field('Service area', ['service_area']),
      field('Products / services', ['product', 'service', 'offering']), field('Price information', ['price']), field('Availability', ['availability']), field('Variants', ['variant']), field('Opening hours', ['opening_hours']), field('Contact', ['email', 'phone']),
      field('WhatsApp', ['whatsapp']), field('Booking', ['booking', 'reservation', 'appointment']), field('Quote / RFQ', ['quote']), field('Checkout', ['checkout']), field('Cart', ['cart']), field('Policies', POLICIES), field('Structured data', ['schema_type']), field('Machine-accessible endpoints', ENDPOINTS)],
  };
  const signals: DetectedSignal[] = records.map(record => ({ ...record, key: record.type, label: record.type.replaceAll('_', ' '), kind: record.confidence === 'high' ? 'detected' : 'inferred' }));
  const evidence: TechnicalEvidence = { records, checks, resourceChecks, pageDiagnostics: crawl.pages.filter(page => page.diagnostics.length).map(page => ({ sourceUrl: page.url, messages: page.diagnostics })), analyzedUrls: crawl.responses, schemaTypes,
    metadata: { title: home.title, description: home.meta.description || home.meta['og:description'] || '', canonical: home.canonical, 'og:site_name': home.meta['og:site_name'] || '' },
    forms: crawl.pages.flatMap(page => page.forms.map(form => ({ ...form, sourceUrl: page.url }))), contactMethods: [...contact, ...values('whatsapp')], policyUrls: policies, providers: values('payment_provider', 'commerce_platform'), chatWidgets: values('chat_widget'), mapLinks: values('map_reference'), endpoints: profile.machineEndpoints,
    robots: crawl.robots, sitemap: crawl.sitemap, llms: crawl.llms, checkedAt: new Date().toISOString(), warnings: [...crawl.warnings] };
  if (!facts.name && !facts.description && !facts.offerings && !facts.contact) evidence.warnings.push('Few business signals were found. The score may be less informative.');
  return { facts, profile, signals, evidence, ruleEvidence };
}

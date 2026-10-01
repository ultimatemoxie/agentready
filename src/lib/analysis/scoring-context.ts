import type { RuleAssessment, ResourceCheck } from '../types.ts';
import type { Classification, Facts } from './classify.ts';
import { eligible } from './evidence.ts';

// Point conditions are unchanged. These types describe what each condition examines.
export const RULE_SIGNAL_TYPES: Record<keyof Facts, string[]> = {
  name: ['business_name'], description: ['description'], contact: ['email', 'phone', 'whatsapp'], location: ['location', 'service_area'], identitySchema: ['identity_schema'], canonical: ['canonical'],
  offerings: ['product', 'service', 'offering'], offeringDescriptions: ['offering_description'], categories: ['category'], prices: ['price'], identifiers: ['identifier', 'availability'],
  metadata: ['title', 'description'], sitemap: ['sitemap'], schema: ['schema_type'], robots: ['robots'], llms: ['llms'], https: ['https'],
  privacy: ['privacy'], terms: ['terms'], returnPolicy: ['return_policy', 'cancellation_policy'], support: ['support', 'contact', 'email', 'phone'],
  email: ['email'], phone: ['phone'], whatsapp: ['whatsapp'], contactFlow: ['contact', 'support', 'email', 'phone', 'whatsapp', 'chat_widget'], social: ['social'],
  actionFlow: ['booking', 'reservation', 'appointment', 'quote', 'cart', 'checkout', 'purchase'], purposefulForm: ['purposeful_form'], actionCta: ['action_cta'], search: ['search'], apiDocs: ['api_documentation', 'openapi_reference'], account: ['account'],
  cartCheckout: ['cart', 'checkout'], paymentProvider: ['payment_provider', 'commerce_platform'], purchaseCta: ['purchase'],
};
const HOME_ONLY = new Set<keyof Facts>(['description', 'canonical', 'metadata', 'https']);
const CATALOG = /\/(?:services?|products?|shop|menu|pricing)(?:\/|$)/i;
const CONTACT = /\/(?:contact(?:-us)?|support|help|about)(?:\/|$)/i;
const POLICY = /\/(?:polic(?:y|ies)|privacy(?:-policy)?|terms(?:-[\w-]+)?|returns?|refunds?|shipping|delivery|cancellations?)(?:\/|$)/i;
const ACTION = /\/(?:book(?:ing)?|reserv(?:e|ations?)|appointments?|schedule|quote|rfq|cart|checkout|order|contact|support|search|login|account)(?:\/|$)/i;
const API = /\/(?:api|docs|developers?|openapi|swagger)(?:\/|$|\.)/i;
const STRUCTURED = new Set<keyof Facts>(['name', 'contact', 'location', 'identitySchema', 'offerings', 'offeringDescriptions', 'categories', 'prices', 'identifiers', 'schema', 'email', 'phone']);
const DEPENDENT_OFFERING = new Set<keyof Facts>(['offeringDescriptions', 'categories', 'prices', 'identifiers']);
const unique = (values: string[]) => [...new Set(values)];

function relevant(key: keyof Facts, check: ResourceCheck, homeUrl: string): boolean {
  if (check.resource !== 'html') return false;
  if (check.sourceUrl === homeUrl) return true;
  if (HOME_ONLY.has(key)) return false;
  let path: string; try { path = new URL(check.sourceUrl).pathname; } catch { return false; }
  if (['name', 'location', 'contact', 'email', 'phone', 'whatsapp', 'contactFlow', 'support', 'social'].includes(key)) return CONTACT.test(path);
  if (['offerings', 'offeringDescriptions', 'categories', 'prices', 'identifiers', 'paymentProvider', 'cartCheckout', 'purchaseCta', 'search'].includes(key)) return CATALOG.test(path) || ACTION.test(path);
  if (['privacy', 'terms', 'returnPolicy'].includes(key)) return POLICY.test(path) || CONTACT.test(path);
  if (key === 'apiDocs') return API.test(path);
  if (['actionFlow', 'purposefulForm', 'actionCta', 'account'].includes(key)) return ACTION.test(path) || CATALOG.test(path) || CONTACT.test(path);
  return true; // Identity/schema may occur on any inspected business page.
}

export function assessRule(key: keyof Facts, classification: Classification): RuleAssessment {
  const evidence = classification.evidence, homeUrl = evidence.analyzedUrls.find(page => /text\/html/i.test(page.contentType) && page.status >= 200 && page.status < 300)?.url;
  const home = homeUrl || evidence.resourceChecks.find(check => check.resource === 'html' && check.status === 'INSPECTED')?.sourceUrl;
  const recordIds = new Map(evidence.records.map(record => [record.id, record]));
  const supported = classification.ruleEvidence[key].filter(record => eligible(record) && recordIds.has(record.id) && eligible(recordIds.get(record.id)!));
  const positive = classification.facts[key] && supported.length > 0;
  if (positive) return { state: 'DETECTED', evidenceIds: supported.map(record => record.id), sourceUrls: unique(supported.map(record => record.sourceUrl)), reason: supported.map(record => `${record.detector}: ${record.value} on ${record.sourceUrl}`).join('; ') };
  const unknown = (reason: string, sources: string[] = home ? [home] : []): RuleAssessment => ({ state: 'UNKNOWN', evidenceIds: [], sourceUrls: unique(sources), reason });
  if (classification.facts[key] && !supported.length) return unknown('Claimed detection has no eligible supporting evidence.');
  const resource = key === 'llms' ? 'llms_txt' : ['robots', 'sitemap'].includes(key) ? key : undefined;
  if (resource) {
    const checks = evidence.resourceChecks.filter(check => check.resource === resource && (!home || new URL(check.sourceUrl).origin === new URL(home).origin));
    if (!checks.length) return unknown(`No completed ${resource} resource check.`);
    const unavailable = checks.filter(check => ['UNKNOWN', 'NOT_CHECKED'].includes(check.status));
    if (unavailable.length) return unknown(unavailable.map(check => `${check.sourceUrl}: ${check.reason || check.status}`).join('; '), unavailable.map(check => check.sourceUrl));
    return { state: 'NOT_DETECTED', evidenceIds: [], sourceUrls: checks.map(check => check.sourceUrl), reason: `No qualifying ${resource} resource detected in completed checks (${checks.map(check => check.httpStatus || check.status).join(', ')}).` };
  }
  if (!home) return unknown('No successfully inspected homepage context.');
  const scoped = evidence.resourceChecks.filter(check => relevant(key, check, home));
  const unavailable = scoped.filter(check => ['UNKNOWN', 'NOT_CHECKED'].includes(check.status));
  if (unavailable.length) return unknown(unavailable.map(check => `${check.sourceUrl}: ${check.reason || check.status}`).join('; '), unavailable.map(check => check.sourceUrl));
  const inspected = scoped.filter(check => check.status === 'INSPECTED');
  if (!inspected.some(check => check.sourceUrl === home)) return unknown('Homepage inspection context is unavailable.');
  const sources = inspected.map(check => check.sourceUrl);
  // Failed JSON-LD affects structured-capable rules, not independent metadata/link checks.
  const parserWarnings = evidence.warnings.filter(warning => sources.some(source => warning.includes(source)) && (/evidence limit/i.test(warning) || STRUCTURED.has(key) && /JSON-LD/i.test(warning)));
  for (const diagnostic of evidence.pageDiagnostics || []) if (sources.includes(diagnostic.sourceUrl)) for (const message of diagnostic.messages) if (/evidence limit/i.test(message) || STRUCTURED.has(key) && /JSON-LD/i.test(message)) parserWarnings.push(`${diagnostic.sourceUrl}: ${message}`);
  if (parserWarnings.length) return unknown(parserWarnings.join('; '), sources);
  const weak = evidence.records.filter(record => record.confidence === 'low' && RULE_SIGNAL_TYPES[key].includes(record.type) && sources.includes(record.sourceUrl));
  if (weak.length) return unknown('Only low-confidence observations found; the signal could not be reliably established.', weak.map(record => record.sourceUrl));
  if (DEPENDENT_OFFERING.has(key) && !classification.ruleEvidence.offerings.some(eligible) && !inspected.some(check => CATALOG.test(new URL(check.sourceUrl).pathname))) return unknown('No identifiable offering or inspected catalog/pricing context to evaluate this rule reliably.', sources);
  return { state: 'NOT_DETECTED', evidenceIds: [], sourceUrls: sources, reason: `No qualifying ${RULE_SIGNAL_TYPES[key].join(' / ')} evidence in successfully inspected relevant pages. This is not proof of site-wide absence.` };
}

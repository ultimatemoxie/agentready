import type { EvidenceRecord } from '../types.ts';
import { makeEvidence, uniqueEvidence } from './evidence.ts';
import { isSchemaType, type SchemaNode } from './schema.ts';

const string = (value: unknown): string => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const currencies = new Set(Intl.supportedValuesOf('currency'));
export function validCurrency(value: string): boolean { return currencies.has(value); }

export function structuredEvidence(nodes: SchemaNode[], sourceUrl: string): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  const byId = new Map(nodes.filter(node => string(node.object['@id'])).map(node => [string(node.object['@id']), node.object]));
  const resolve = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const object = value as Record<string, unknown>;
    return byId.get(string(object['@id'])) || object;
  };
  const emit = (type: string, value: string, raw: unknown, confidence: EvidenceRecord['confidence'] = 'high', details?: EvidenceRecord['details']) => {
    if (value) records.push(makeEvidence({ type, value, sourceUrl, sourceType: 'schema_org', rawEvidence: JSON.stringify(raw), detector: `schema-${type.replaceAll('_', '-')}`, confidence, details }));
  };
  for (const node of nodes) for (const type of node.types) emit('schema_type', type, { '@type': node.declaredTypes }, 'high', { iri: `https://schema.org/${type}`, declaredType: node.declaredTypes.join(', ') });
  const organizations = nodes.filter(node => node.types.some(type => isSchemaType(type, 'Organization')) && !/\.(?:brand|manufacturer|author|itemReviewed|mentions|about)(?:\[|\.|$)/.test(node.path));
  const sameSite = (object: Record<string, unknown>) => {
    const target = string(object.url) || string(object['@id']);
    if (!target) return false;
    try { return new URL(target, sourceUrl).origin === new URL(sourceUrl).origin; } catch { return false; }
  };
  const primary = organizations.find(node => sameSite(node.object)) || (organizations.length === 1 && !string(organizations[0].object.url) && !string(organizations[0].object['@id']) ? organizations[0] : undefined);
  if (primary) {
    const object = primary.object;
    emit('identity_schema', primary.types.join(', '), { '@type': primary.declaredTypes, name: object.name });
    emit('business_name', string(object.name), { name: object.name });
    emit('description', string(object.description), { description: object.description });
    for (const [key, type] of [['email', 'email'], ['telephone', 'phone']] as const) for (const value of array(object[key])) {
      const text = string(value).replace(/^mailto:/, '');
      if (type === 'email' ? /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(text) : /^\+?\d{8,15}$/.test(text.replace(/[\s().-]/g, ''))) emit(type, text, { [key]: value });
    }
    for (const value of array(object.areaServed)) emit('service_area', string(value) || string(resolve(value)?.name), { areaServed: value });
    for (const value of array(object.openingHours)) if (/\b(?:Mo|Tu|We|Th|Fr|Sa|Su)\b.*\d{2}:\d{2}/.test(string(value))) emit('opening_hours', string(value), { openingHours: value });
    for (const value of array(object.address)) {
      if (typeof value === 'string' && value.trim().length > 10) emit('location', value.trim(), { address: value });
      else address(resolve(value));
    }
  }
  function address(object?: Record<string, unknown>) {
    if (!object) return;
    const parts = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'].map(key => string(object[key]) || string(resolve(object[key])?.name)).filter(Boolean);
    if (parts.length >= 2) emit('location', parts.join(', '), Object.fromEntries(['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'].filter(key => object[key] != null).map(key => [key, object[key]])), 'medium');
  }
  const price = (object: Record<string, unknown>, offering: string) => {
    const amount = string(object.price), currency = string(object.priceCurrency).toUpperCase();
    if (!/^\d+(?:\.\d{1,4})?$/.test(amount)) return;
    const details: NonNullable<EvidenceRecord['details']> = { amount };
    if (validCurrency(currency)) details.currency = currency;
    if (offering) details.offering = offering;
    emit('price', `${details.currency ? details.currency + ' ' : ''}${amount}${offering ? ' — ' + offering : ''}`, { price: object.price, priceCurrency: object.priceCurrency, item: offering || undefined }, offering ? details.currency ? 'high' : 'medium' : 'low', details);
  };
  for (const node of nodes) {
    const object = node.object;
    const standalone = node.path === '$' || /^\$\.@graph\[\d+\]$/.test(node.path);
    if (node.types.includes('PostalAddress') && standalone) address(object);
    if (node.types.includes('OpeningHoursSpecification') && (standalone || primary && array(primary.object.openingHoursSpecification).some(value => resolve(value) === object))) {
      const days = array(object.dayOfWeek).map(string).filter(day => /^(?:https?:\/\/schema\.org\/)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(day));
      const opens = string(object.opens), closes = string(object.closes);
      if (days.length && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(opens) && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(closes)) emit('opening_hours', `${days.map(day => day.replace(/^https?:\/\/schema.org\//, '')).join(', ')} ${opens}–${closes}`, { dayOfWeek: object.dayOfWeek, opens, closes });
    }
    const product = node.types.some(type => isSchemaType(type, 'Product'));
    const service = node.types.some(type => isSchemaType(type, 'Service'));
    const excluded = /\/(?:blog|news|articles?|stories|press)(?:\/|$)/i.test(new URL(sourceUrl).pathname) || /\.(?:author|itemReviewed|mentions|about|manufacturer|brand)(?:\[|\.|$)/.test(node.path);
    const namedOffering = !excluded && (product || service || node.types.includes('MenuItem'));
    const name = namedOffering ? string(object.name) : '';
    if (name) {
      emit(product ? 'product' : 'service', name, { '@type': node.declaredTypes, name });
      emit('offering_description', string(object.description), { name, description: object.description }, 'high', { offering: name });
      for (const category of array(object.category)) emit('category', string(category) || string(resolve(category)?.name), { name, category }, 'high', { offering: name });
      for (const key of ['sku', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'mpn', 'productID']) if (string(object[key])) emit('identifier', string(object[key]), { name, [key]: object[key] }, 'high', { offering: name, identifierType: key });
      for (const key of ['size', 'color']) for (const value of array(object[key])) emit('variant', string(value), { name, [key]: value }, 'high', { offering: name, identifierType: key });
      for (const variant of array(object.hasVariant)) { const item = resolve(variant); if (item) emit('variant', string(item.name) || string(item.sku), { hasVariant: { name: item.name, sku: item.sku } }, 'high', { offering: name }); }
      for (const value of array(object.offers)) {
        const offer = resolve(value); if (!offer) continue;
        price(offer, name);
        for (const spec of array(offer.priceSpecification)) { const item = resolve(spec); if (item) price(item, name); }
        const availability = string(offer.availability);
        if (/^https?:\/\/schema\.org\/(?:InStock|OutOfStock|SoldOut|PreOrder|PreSale|LimitedAvailability|OnlineOnly|InStoreOnly|Discontinued|BackOrder)$/.test(availability)) emit('availability', availability.replace(/^https?:\/\/schema\.org\//, ''), { item: name, availability }, 'high', { offering: name });
      }
    }
    if (!excluded && node.types.some(type => isSchemaType(type, 'Offer'))) {
      const item = resolve(object.itemOffered), associated = string(item?.name) || string(object.name);
      if (associated && item) emit('offering', associated, { itemOffered: { name: item.name } });
      // Attached offers are handled above with their actual parent offering.
      if (!nodes.some(parent => array(parent.object.offers).some(value => resolve(value) === object))) price(object, associated);
    }
  }
  return uniqueEvidence(records);
}

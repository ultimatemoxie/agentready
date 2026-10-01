import { parse } from 'parse5';
import type { EvidenceRecord } from '../types.ts';
import { eligible, makeEvidence, uniqueEvidence } from './evidence.ts';
import { linkEvidence, resourceEvidence } from './link-detectors.ts';
import { parseSchema, type SchemaNode } from './schema.ts';
import { structuredEvidence } from './structured-evidence.ts';

type DomNode = { tagName?: string; nodeName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: DomNode[] };
export interface PageLink { url: string; text: string; rel: string; format?: string }
export interface PageForm { purpose: string; action: string }
export interface ParsedPage {
  url: string; title: string; meta: Record<string, string>; canonical: string; headings: string[]; links: PageLink[];
  forms: PageForm[]; schemaTypes: string[]; schemaObjects: Record<string, unknown>[]; text: string;
  address: string; emails: string[]; phones: string[]; prices: string[]; offerings: string[]; resourceUrls: string[];
  evidence: EvidenceRecord[]; schemaNodes: SchemaNode[]; diagnostics: string[];
}
const attr = (node: DomNode, key: string) => node.attrs?.find(item => item.name === key)?.value?.trim() || '';
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const generic = /^(?:home|welcome|hello|untitled|coming soon|website|index|services?|products?|our services|our products|menu|pricing|contact|about|learn more|read more|buy now|shop now)$/i;
function textOf(node: DomNode): string {
  const stack = [node], text: string[] = [];
  while (stack.length) { const item = stack.pop()!; if (['script', 'style', 'noscript', 'svg'].includes(item.tagName || '')) continue; if (item.value) text.push(item.value); stack.push(...(item.childNodes || []).slice().reverse()); }
  return clean(text.join(' '));
}
function descendants(node: DomNode): DomNode[] {
  const result: DomNode[] = [], stack = [...(node.childNodes || [])].reverse();
  while (stack.length) { const item = stack.pop()!; result.push(item); stack.push(...(item.childNodes || []).slice().reverse()); } return result;
}
function safeLink(raw: string, base: string): string {
  if (!raw) return ''; try { const url = new URL(raw, base); return ['http:', 'https:', 'mailto:', 'tel:', 'whatsapp:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function extractPage(html: string, url: string): ParsedPage {
  const dom = parse(html) as DomNode, meta: Record<string, string> = {}, links: PageLink[] = [], forms: PageForm[] = [], headings: string[] = [], resourceUrls: string[] = [];
  const evidence: EvidenceRecord[] = [], schemaNodes: SchemaNode[] = [], diagnostics: string[] = [];
  let title = '', canonical = '';
  const path = new URL(url).pathname;
  const dedicated = /\/(?:services?|products?|menu|shop|pricing)(?:\/|$)/i.test(path);
  const catalogPage = /\/(?:services?|products?|menu|shop)(?:\/|$)/i.test(path);
  const editorialPage = /\/(?:blog|news|articles?|stories|press)(?:\/|$)/i.test(path);
  const emit = (type: string, value: string, raw: string, detector: string, confidence: EvidenceRecord['confidence'] = 'medium', details?: EvidenceRecord['details'], sourceType: EvidenceRecord['sourceType'] = 'html_text') => {
    if (value && evidence.length < 1000) evidence.push(makeEvidence({ type, value, sourceUrl: url, sourceType, rawEvidence: raw, detector, confidence, details }));
  };
  interface Context { node: DomNode; card?: DomNode; editorial: boolean; offeringSection: boolean }
  const stack: Context[] = [{ node: dom, editorial: editorialPage, offeringSection: false }];
  const cards = new Map<DomNode, string>();
  while (stack.length) {
    const context = stack.pop()!, node = context.node, tag = node.tagName || '';
    const tokens = attr(node, 'class').split(/\s+/);
    const pricingCard = tokens.some(token => /^(?:pricing-plan|(?:pricing|price|plan)[_-]{1,2}(?:package|plan|card))$/.test(token));
    const isCard = pricingCard || tokens.some(token => /^(?:product-card|service-card|menu-item|offering-card|product-item|service-item)$/.test(token)) || !!attr(node, 'data-product-name') || !!attr(node, 'data-service-name');
    const editorial = context.editorial || tag === 'article' && !isCard && !dedicated;
    let card = context.card;
    if (isCard && !editorial) {
      card = node;
      const all = descendants(node), heading = all.find(item => /^h[1-4]$/.test(item.tagName || ''));
      const headingText = heading ? textOf(heading) : '';
      const name = attr(node, 'data-product-name') || attr(node, 'data-service-name') || (pricingCard ? headingText.replace(/,?\s+(?:[$₦€£]|NGN |USD |GBP |EUR ).*$/, '') : headingText);
      if (name && name.length <= 100 && !generic.test(name)) {
        cards.set(node, name);
        const type = pricingCard ? 'offering' : tokens.some(token => /^service/.test(token)) || attr(node, 'data-service-name') ? 'service' : 'product';
        emit(type, name, name, 'semantic-offering-card');
        const description = all.find(item => item.tagName === 'p' && textOf(item).length >= 20 && !/^[₦$€£]/.test(textOf(item)));
        if (description) emit('offering_description', textOf(description), textOf(description), 'offering-card-description', 'medium', { offering: name });
      }
    }
    const section = ['section', 'ul'].includes(tag) && (node.childNodes || []).some(item => /^h[1-3]$/.test(item.tagName || '') && /^(?:our |available )?(?:services|products|menu|pricing plans)$/i.test(textOf(item)));
    if (tag === 'li' && !editorial && !card && (catalogPage || context.offeringSection)) {
      const label = (node.childNodes || []).find(item => ['strong', 'b'].includes(item.tagName || ''));
      const name = label ? textOf(label) : '', description = textOf(node).slice(name.length).replace(/^\s*[—–:-]\s*/, '').trim();
      if (name && name.length <= 100 && !generic.test(name) && description.length >= 20) { emit(/services?/i.test(path) ? 'service' : 'product', name, textOf(node), 'explicit-offering-list'); emit('offering_description', description, textOf(node), 'explicit-offering-list-description', 'medium', { offering: name }); }
    }
    if (tag === 'title') { title = textOf(node); emit('title', title, title, 'page-title', 'high', undefined, 'meta'); }
    if (tag === 'meta') {
      const key = (attr(node, 'name') || attr(node, 'property')).toLowerCase(), value = attr(node, 'content');
      if (key && value) { meta[key] = value; if (['description', 'og:description', 'og:site_name'].includes(key)) emit(key === 'og:site_name' ? 'business_name' : 'description', value, `${key}=${value}`, `meta-${key}`, 'high', undefined, 'meta'); }
    }
    if (tag === 'link' && /\bcanonical\b/i.test(attr(node, 'rel'))) {
      canonical = safeLink(attr(node, 'href'), url);
      if (canonical && new URL(canonical).origin === new URL(url).origin) emit('canonical', canonical, `rel=canonical href=${canonical}`, 'same-origin-canonical', 'high', undefined, 'meta');
    }
    if (tag === 'a' || tag === 'link' && /\b(?:alternate|api|feed)\b/i.test(attr(node, 'rel'))) {
      const href = safeLink(attr(node, 'href'), url);
      if (href) {
        const link = { url: href, text: tag === 'a' ? textOf(node).slice(0, 180) : attr(node, 'title'), rel: attr(node, 'rel'), format: attr(node, 'type') };
        links.push(link); evidence.push(...linkEvidence({ ...link, editorial }, url), ...resourceEvidence(href, url, 'html_link'));
      }
    }
    if (['script', 'iframe'].includes(tag)) { const src = safeLink(attr(node, 'src'), url); if (src) { resourceUrls.push(src); evidence.push(...resourceEvidence(src, url, 'script')); } }
    if (/^h[1-4]$/.test(tag)) {
      const text = textOf(node); if (text) headings.push(text.slice(0, 180));
      if (!editorial && !card && (catalogPage && tag === 'h1' && path.split('/').filter(Boolean).length > 1 && title.toLowerCase().includes(text.toLowerCase()) || context.offeringSection && /^h[23]$/.test(tag))) {
        if (text.length <= 100 && !generic.test(text) && !/^(?:contact|about|faq|testimonials?|why |how |frequently|get in touch)/i.test(text)) {
          // A heading alone is insufficient: require adjacent descriptive copy in its local container.
          const parent = parents.get(node);
          const paragraph = parent?.childNodes?.find(item => item.tagName === 'p' && textOf(item).length >= 20);
          if (paragraph) { emit(/services?/i.test(path) ? 'service' : 'product', text, text, 'dedicated-offering-heading'); emit('offering_description', textOf(paragraph), textOf(paragraph), 'dedicated-offering-description', 'medium', { offering: text }); }
        }
      }
      const policy = linkEvidence({ url, text }, url).filter(item => item.type.endsWith('policy') || ['privacy', 'terms'].includes(item.type));
      if (!editorial) evidence.push(...policy.map(item => makeEvidence({ ...item, sourceType: 'html_text', rawEvidence: text, detector: 'policy-page-heading', confidence: 'medium' })));
    }
    if (tag === 'address' && !editorial) { const text = textOf(node); if (text.length >= 12 && /\d|\b(?:street|road|avenue|lane|city|lagos|abuja)\b/i.test(text)) emit('location', text, text, 'address-element'); }
    if (tag === 'form' && !editorial) {
      const action = safeLink(attr(node, 'action') || url, url), content = textOf(node).slice(0, 240), controls = descendants(node).filter(item => ['input', 'textarea', 'select'].includes(item.tagName || ''));
      const semantics = `${content} ${controls.map(item => `${attr(item, 'type')} ${attr(item, 'name')} ${attr(item, 'aria-label')}`).join(' ')}`;
      const actionTypes = linkEvidence({ url: action, text: content }, url).map(item => item.type);
      const purpose = /\bbook\s+(?:an?\s+)?appointment\b/i.test(content) ? 'booking' : actionTypes.find(type => ['booking', 'reservation', 'appointment', 'quote', 'checkout', 'search', 'account', 'contact'].includes(type)) ||
        (/\bsearch\b/i.test(semantics) ? 'search' : /\b(?:request|get) (?:a )?quote\b/i.test(content) ? 'quote' : /\b(?:contact|send message|send a message)\b/i.test(content) && controls.some(item => ['email', 'message'].includes(attr(item, 'name')) || item.tagName === 'textarea') ? 'contact' : 'unspecified');
      forms.push({ purpose, action });
      if (purpose !== 'unspecified' && action) {
        emit('purposeful_form', `${purpose}: ${action}`, `${content}; controls=${controls.map(item => `${item.tagName}:${attr(item, 'name')}:${attr(item, 'type')}`).join(', ')}`, 'form-purpose', 'medium', { method: attr(node, 'method') || 'get' }, 'form');
        emit(purpose === 'booking' && /appointment/i.test(content) ? 'appointment' : purpose, action, content || `${purpose} form action=${action}`, 'form-purpose', 'medium', undefined, 'form');
      }
    }
    if (tag === 'script' && /^application\/ld\+json$/i.test(attr(node, 'type'))) {
      const raw = (node.childNodes || []).map(item => item.value || '').join('');
      const parsed = parseSchema(raw, url); schemaNodes.push(...parsed.nodes); diagnostics.push(...parsed.diagnostics);
      if (parsed.declared.length && !parsed.nodes.length) emit('json_ld_observation', parsed.declared.join(', '), `Unvalidated @type: ${parsed.declared.join(', ')}`, 'non-schema-jsonld-type', 'low', undefined, 'json_ld');
    }
    if (['p', 'li', 'dd', 'span'].includes(tag) && !(node.childNodes || []).some(item => ['p', 'li', 'dd', 'span'].includes(item.tagName || ''))) {
      const text = textOf(node);
      if (text.length <= 400) {
        const name = card ? cards.get(card) : undefined;
        const pricePattern = /(?:\b(NGN|USD|EUR|GBP|GHS|ZAR)\s*|([₦$€£₵])\s*)(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d,.])/g;
        for (const match of text.matchAll(pricePattern)) {
          const associated = name || (dedicated && /^.{2,80}\s[—–-]\s*(?:₦|\$|€|£|NGN|USD|EUR|GBP)/.test(text) ? text.split(/\s[—–-]\s/)[0] : undefined);
          const currency = match[1] || ({ '₦': 'NGN', '€': 'EUR', '₵': 'GHS' } as Record<string, string>)[match[2]];
          emit('price', match[0], text, 'currency-amount-text', editorial || !associated ? 'low' : 'medium', { amount: match[3].replaceAll(',', ''), ...(currency ? { currency } : {}), ...(match[2] ? { symbol: match[2] } : {}), ...(associated ? { offering: associated } : {}) });
        }
        if (!editorial && /^\s*(?:business )?address:\s*\S.{10,}/i.test(text)) emit('location', text.replace(/^(?:business )?address:\s*/i, ''), text, 'explicit-address-label');
        if (!editorial && /^(?:opening hours|business hours|hours):/i.test(text) && /\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/i.test(text) && /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[–-]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text)) emit('opening_hours', text, text, 'labeled-weekday-hours');
        const contactContext = /\/(?:contact|support)(?:\/|$)/i.test(path) || /\b(?:email|contact|phone|telephone|call us):?\s/i.test(text);
        for (const email of text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []) emit('email', email, text, 'plain-email-contact-context', contactContext && !editorial ? 'medium' : 'low');
        if (!editorial && /^(?:phone|telephone|tel|call us):\s*/i.test(text)) { const number = text.replace(/^(?:phone|telephone|tel|call us):\s*/i, ''); if (/^\+?\d{8,15}$/.test(number.replace(/[\s().-]/g, ''))) emit('phone', number, text, 'labeled-phone'); }
      }
    }
    const children = node.childNodes || [];
    for (const child of children) parents.set(child, node);
    stack.push(...children.slice().reverse().map(child => ({ node: child, card, editorial, offeringSection: context.offeringSection || section })));
  }
  evidence.push(...structuredEvidence(schemaNodes, url));
  const titleName = title.split(/\s+[|–—-]\s+/)[0]?.trim();
  if (!dedicated && !editorialPage && new URL(url).pathname === '/' && titleName && titleName.length <= 100 && !generic.test(titleName)) emit('business_name', titleName, title, 'homepage-title-identity', 'medium', undefined, 'meta');
  if (evidence.length >= 1000) diagnostics.push('Page evidence limit reached');
  const records = uniqueEvidence(evidence).slice(0, 1000);
  const values = (...types: string[]) => unique(records.filter(item => eligible(item) && types.includes(item.type)).map(item => item.value));
  return { url, title, meta, canonical, headings, links, forms, schemaTypes: unique(schemaNodes.flatMap(node => node.types)), schemaObjects: schemaNodes.map(node => node.object), schemaNodes, diagnostics, evidence: records,
    text: textOf(dom).slice(0, 150_000), address: values('location')[0] || '', emails: values('email'), phones: values('phone'), prices: unique(records.filter(item => item.type === 'price').map(item => item.value)), offerings: values('product', 'service', 'offering'), resourceUrls };
}
// Weak keys retain only the current parse's parent links and do not retain HTML documents.
const parents = new WeakMap<DomNode, DomNode>();

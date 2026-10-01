import type { EvidenceRecord } from '../types.ts';
import { makeEvidence } from './evidence.ts';

export interface LinkInput { url: string; text: string; rel?: string; format?: string; editorial?: boolean }
const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const digits = (value: string) => /^\+?\d{8,15}$/.test(value.replace(/[\s()-]/g, ''));
const PATHS: Record<string, string[]> = {
  booking: ['book', 'booking', 'bookings'], reservation: ['reserve', 'reservation', 'reservations'],
  appointment: ['appointment', 'appointments', 'schedule'], quote: ['quote', 'quotes', 'rfq', 'request-a-quote', 'quotation'],
  cart: ['cart', 'basket'], checkout: ['checkout'], contact: ['contact', 'contact-us'], support: ['support', 'help', 'customer-support'],
  search: ['search'], account: ['login', 'log-in', 'signin', 'sign-in', 'account'],
};
const INTENT: Record<string, RegExp> = {
  booking: /^(?:book(?:\s+(?:a|an|your))?\s+(?:now|appointment|consultation|session|visit|table|room|service)|book now|booking)\b/i,
  reservation: /^(?:reserve(?:\s+(?:a|your))?\s+(?:table|room|now)|make a reservation|reservations?)\b/i,
  appointment: /^(?:schedule(?:\s+(?:a|an|your))?\s+(?:appointment|consultation|visit)|appointments?)\b/i,
  quote: /^(?:request(?: a)? quote|get(?: a)? quote|request for quote|rfq)\b/i,
  checkout: /^(?:checkout|check out|proceed to checkout)\b/i, cart: /^(?:cart|basket|view cart|shopping cart)\b/i,
  contact: /^(?:contact(?: us)?|send (?:us )?a message)\b/i, support: /^(?:customer support|support|help centre|help center)\b/i,
};
const POLICY: Record<string, { paths: string[]; text: RegExp }> = {
  privacy: { paths: ['privacy', 'privacy-policy'], text: /^(?:privacy(?: policy| notice| statement)?)$/i },
  terms: { paths: ['terms', 'terms-of-service', 'terms-and-conditions', 'terms-of-use'], text: /^(?:terms(?: of (?:service|use)| and conditions)?|conditions of sale)$/i },
  return_policy: { paths: ['returns', 'return-policy', 'refund', 'refunds', 'refund-policy'], text: /^(?:returns?(?: (?:policy|and refunds))?|refunds?(?: policy)?|refund and return policy)$/i },
  shipping_policy: { paths: ['shipping', 'shipping-policy', 'delivery', 'delivery-policy'], text: /^(?:shipping(?: (?:policy|and delivery))?|delivery(?: policy)?)$/i },
  cancellation_policy: { paths: ['cancellation-policy', 'cancellations'], text: /^(?:cancellation policy|cancellations)$/i },
};

export function linkEvidence(link: LinkInput, sourceUrl: string): EvidenceRecord[] {
  let url: URL;
  try { url = new URL(link.url); } catch { return []; }
  if (url.username || url.password) return [];
  const records: EvidenceRecord[] = [];
  const emit = (type: string, detector: string, confidence: 'high' | 'medium' = 'medium', details?: EvidenceRecord['details']) => records.push(makeEvidence({
    type, value: url.href, sourceUrl, sourceType: 'html_link', rawEvidence: `${link.text || link.rel || 'href'} → ${url.href}`,
    detector, confidence, details,
  }));
  if (url.protocol === 'mailto:') {
    let email: string; try { email = decodeURIComponent(url.pathname).split('?')[0]; } catch { return []; }
    if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(email)) records.push(makeEvidence({ type: 'email', value: email, sourceUrl, sourceType: 'html_link', rawEvidence: url.href, detector: 'mailto-link', confidence: link.editorial ? 'low' : 'high' }));
    return records;
  }
  if (url.protocol === 'tel:') {
    if (digits(url.pathname)) records.push(makeEvidence({ type: 'phone', value: url.pathname, sourceUrl, sourceType: 'html_link', rawEvidence: url.href, detector: 'telephone-link', confidence: link.editorial ? 'low' : 'high' }));
    return records;
  }
  const phone = url.searchParams.get('phone') || '';
  const whatsapp = url.protocol === 'whatsapp:' && (url.hostname === 'send' || url.pathname === 'send') && digits(phone) ||
    ['http:', 'https:'].includes(url.protocol) && (url.hostname === 'wa.me' && (/^\/\d{8,15}\/?$/.test(url.pathname) || /^\/message\/[A-Za-z0-9]+\/?$/.test(url.pathname)) ||
    ['api.whatsapp.com', 'web.whatsapp.com', 'www.whatsapp.com', 'whatsapp.com'].includes(url.hostname) && /^\/send\/?$/.test(url.pathname) && digits(phone));
  if (whatsapp) emit('whatsapp', 'official-whatsapp-action', 'high');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return records;
  let path: string; try { path = decodeURIComponent(url.pathname).replace(/\/$/, '').toLowerCase(); } catch { return records; }
  const segments = path.split('/').filter(Boolean), last = segments.at(-1) || '';
  const sameOrigin = url.origin === new URL(sourceUrl).origin;
  const editorial = link.editorial || segments.some(segment => ['blog', 'news', 'articles', 'article', 'stories', 'press'].includes(segment));
  if (editorial) return records;
  for (const [type, paths] of Object.entries(PATHS)) {
    const textMatches = INTENT[type]?.test(link.text) || false;
    const catalogDetail = segments.slice(0, -1).some(segment => ['products', 'product', 'services', 'service', 'shop', 'menu'].includes(segment));
    if (sameOrigin && paths.includes(last) && !catalogDetail || textMatches && (paths.includes(last) || sameOrigin && segments.some(segment => paths.includes(segment)))) emit(type, `${type}-path-and-intent`);
  }
  const provider = ['calendly.com', 'cal.com', 'acuityscheduling.com', 'simplybook.me', 'booksy.com', 'fresha.com'].some(domain => hostIs(url.hostname, domain));
  if (provider && segments.length && /\b(?:book|booking|schedule|appointment|consultation|reserve)\b/i.test(link.text)) emit('booking', 'known-booking-provider-link', 'high');
  for (const [type, rule] of Object.entries(POLICY)) {
    const pathMatches = sameOrigin && (rule.paths.includes(last) || rule.paths.includes(last.replace(/\.html?$/, '')));
    if (pathMatches || rule.text.test(link.text.trim()) && (sameOrigin || /\bpolicy|terms|conditions\b/i.test(link.text))) emit(type, `${type}-policy-link`);
  }
  if ((sameOrigin || ['paystack.com', 'flutterwave.com', 'buy.stripe.com', 'checkout.stripe.com'].some(domain => hostIs(url.hostname, domain))) && /^(?:buy now|add to cart|purchase|pay now|order now|checkout)\b/i.test(link.text)) emit('purchase', 'explicit-purchase-cta');
  if (records.some(record => ['booking', 'reservation', 'appointment', 'quote', 'cart', 'checkout', 'contact', 'purchase'].includes(record.type)) &&
    /^(?:book\b|reserve\b|schedule\b|request\b|get a quote\b|contact us\b|buy now\b|add to cart\b|order now\b|checkout\b)/i.test(link.text)) emit('action_cta', 'explicit-action-cta');
  if (['instagram.com', 'facebook.com', 'linkedin.com', 'x.com', 'twitter.com', 'tiktok.com'].some(domain => hostIs(url.hostname, domain)) && segments.length && !/\/(?:share|sharer(?:\.php)?|intent|login|dialog|plugins)(?:\/|$)/.test(path)) emit('social', 'social-profile-host', 'high');
  if ((['google.com', 'www.google.com', 'maps.google.com', 'google.com.ng', 'www.google.com.ng', 'google.co.uk', 'www.google.co.uk'].includes(url.hostname) && /^\/maps(?:\/|$)/.test(path)) || url.hostname === 'g.page' && segments.length || url.hostname === 'goo.gl' && path.startsWith('/maps/')) emit('map_reference', 'direct-map-host', 'high');
  if (/\b(?:api documentation|api docs|developer api)\b/i.test(link.text) || sameOrigin && /\/(?:api\/docs|docs\/api|api-documentation)\/?$/.test(path)) emit('api_documentation', 'explicit-api-documentation-link');
  if (/\/(?:openapi|swagger)(?:\.json|\.ya?ml)$/.test(path)) emit('openapi_reference', 'openapi-file-link', 'high', { format: path.endsWith('.json') ? 'json' : 'yaml' });
  if (last === 'mcp' && /\bmcp\b|model context protocol/i.test(link.text)) emit('mcp_reference', 'explicit-mcp-link');
  if (/\/(?:\.well-known\/)?agent-card\.json$/.test(path) || path === '/.well-known/agent.json') emit('agent_card_reference', 'explicit-agent-card-file', 'high', { format: 'json' });
  if (/\b(?:product|catalog|catalogue|commerce) feed\b/i.test(link.text)) emit('product_feed', 'explicit-product-feed-link', 'medium', { format: link.format || /\.(json|xml|csv)$/.exec(path)?.[1] || 'unspecified' });
  else if (/\b(?:alternate|feed)\b/.test(link.rel || '') && /^(?:application\/(?:rss\+xml|atom\+xml|feed\+json))$/.test(link.format || '')) emit('feed', 'typed-feed-link', 'high', { format: link.format });
  return records;
}

export function resourceEvidence(rawUrl: string, sourceUrl: string, sourceType: 'script' | 'html_link'): EvidenceRecord[] {
  let url: URL; try { url = new URL(rawUrl); } catch { return []; }
  const output: EvidenceRecord[] = [];
  const emit = (type: string, value: string, detector: string) => output.push(makeEvidence({ type, value, sourceUrl, sourceType, rawEvidence: url.href, detector, confidence: 'high' }));
  if (url.hostname === 'js.paystack.co' && /^\/v\d+\/inline\.js$/.test(url.pathname) || hostIs(url.hostname, 'paystack.com') && /^\/pay\//.test(url.pathname)) { emit('payment_provider', 'Paystack', 'paystack-official-resource'); if (sourceType === 'html_link') emit('payment_link', url.href, 'paystack-payment-link'); }
  if (url.hostname === 'checkout.flutterwave.com' || hostIs(url.hostname, 'flutterwave.com') && /^\/pay\//.test(url.pathname)) { emit('payment_provider', 'Flutterwave', 'flutterwave-official-resource'); if (sourceType === 'html_link') emit('payment_link', url.href, 'flutterwave-payment-link'); }
  if (url.hostname === 'js.stripe.com' || ['buy.stripe.com', 'checkout.stripe.com'].includes(url.hostname)) { emit('payment_provider', 'Stripe', 'stripe-official-resource'); if (sourceType === 'html_link') emit('payment_link', url.href, 'stripe-payment-link'); }
  if (url.hostname === 'cdn.shopify.com') emit('commerce_platform', 'Shopify', 'shopify-cdn-resource');
  if (url.origin === new URL(sourceUrl).origin && /\/plugins\/woocommerce\//.test(url.pathname)) emit('commerce_platform', 'WooCommerce', 'woocommerce-plugin-resource');
  if (url.hostname === 'widget.intercom.io' && url.pathname.startsWith('/widget/')) emit('chat_widget', 'Intercom', 'intercom-widget-resource');
  if (url.hostname === 'client.crisp.chat') emit('chat_widget', 'Crisp', 'crisp-widget-resource');
  if (url.hostname === 'embed.tawk.to') emit('chat_widget', 'Tawk.to', 'tawk-widget-resource');
  return output;
}

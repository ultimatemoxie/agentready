import { SCHEMA_TYPES } from './schema-types.ts';

export interface SchemaNode { object: Record<string, unknown>; types: string[]; declaredTypes: string[]; sourceUrl: string; path: string }
interface Context { vocab?: string; terms: Map<string, string> }
const schemaRoot = (value: string) => /^https?:\/\/schema\.org\/?$/.test(value);
export function schemaName(iri: string): string | undefined {
  return /^https?:\/\/schema\.org\/([A-Za-z][A-Za-z0-9]*)$/.exec(iri)?.[1];
}
export function isSchemaType(type: string, ancestor: string, seen = new Set<string>()): boolean {
  if (type === ancestor) return Object.hasOwn(SCHEMA_TYPES.parents, type);
  if (seen.has(type)) return false;
  seen.add(type);
  return (SCHEMA_TYPES.parents[type] || []).some(parent => isSchemaType(parent, ancestor, seen));
}
function contextFor(raw: unknown, inherited: Context): Context {
  if (raw === undefined) return inherited;
  if (raw === null) return { terms: new Map() };
  if (Array.isArray(raw)) return raw.reduce<Context>((context, value) => contextFor(value, context), inherited);
  if (typeof raw === 'string') return schemaRoot(raw) ? { vocab: raw.replace(/\/?$/, '/'), terms: new Map() } : { terms: new Map() };
  if (!raw || typeof raw !== 'object') return { terms: new Map() };
  const object = raw as Record<string, unknown>;
  if (object['@import']) return { terms: new Map() }; // Never load untrusted remote contexts.
  const context: Context = { vocab: inherited.vocab, terms: new Map(inherited.terms) };
  if ('@vocab' in object) context.vocab = typeof object['@vocab'] === 'string' ? object['@vocab'] : undefined;
  for (const [key, definition] of Object.entries(object)) {
    if (key.startsWith('@')) continue;
    const id = typeof definition === 'string' ? definition : definition && typeof definition === 'object' ? (definition as Record<string, unknown>)['@id'] : undefined;
    // A null/unsupported definition disables the term; it must not fall back to @vocab.
    if (definition && typeof definition === 'object' && '@context' in definition) context.terms.set(key, '');
    else context.terms.set(key, typeof id === 'string' ? id : '');
  }
  return context;
}
function expand(term: string, context: Context, depth = 0): string {
  if (depth > 8) return '';
  if (context.terms.has(term)) return expand(context.terms.get(term)!, { ...context, terms: new Map([...context.terms].filter(([key]) => key !== term)) }, depth + 1);
  if (/^https?:\/\//.test(term) || term.startsWith('@')) return term;
  const colon = term.indexOf(':');
  if (colon > 0) {
    const prefix = context.terms.get(term.slice(0, colon));
    return prefix ? expand(prefix, context, depth + 1) + term.slice(colon + 1) : term;
  }
  return context.vocab ? context.vocab.replace(/\/?$/, '/') + term : term;
}

export function parseSchema(raw: string, sourceUrl: string): { nodes: SchemaNode[]; declared: string[]; diagnostics: string[] } {
  const nodes: SchemaNode[] = [], declared: string[] = [], diagnostics: string[] = [];
  let count = 0;
  const walk = (input: unknown, context: Context, path: string, depth: number): unknown => {
    if (depth > 64 || ++count > 10_000) throw new Error('JSON-LD complexity limit');
    if (Array.isArray(input)) return input.map((item, index) => walk(item, context, `${path}[${index}]`, depth + 1));
    if (!input || typeof input !== 'object') return input;
    const object = input as Record<string, unknown>, local = contextFor(object['@context'], context);
    const entries = Object.entries(object);
    const rawType = entries.find(([key]) => expand(key, local) === '@type')?.[1];
    const declaredTypes = (Array.isArray(rawType) ? rawType : [rawType]).filter((value): value is string => typeof value === 'string');
    declared.push(...declaredTypes);
    const types = declaredTypes.map(type => schemaName(expand(type, local))).filter((type): type is string => !!type && Object.hasOwn(SCHEMA_TYPES.parents, type));
    const normalized: Record<string, unknown> = Object.create(null);
    if (types.length) {
      if (nodes.length >= 512) throw new Error('JSON-LD node limit');
      nodes.push({ object: normalized, types, declaredTypes, sourceUrl, path });
      normalized['@type'] = types;
    }
    for (const [key, value] of entries) {
      if (key === '@context' || expand(key, local) === '@type') continue;
      const expanded = expand(key, local);
      const property = schemaName(expanded);
      const keyword = expanded === '@id' || expanded === '@graph' || expanded === '@list' ? expanded : undefined;
      const child = walk(value, local, `${path}.${property || key}`, depth + 1);
      if (property || keyword) normalized[property || keyword!] = child;
    }
    return normalized;
  };
  try { walk(JSON.parse(raw), { terms: new Map() }, '$', 0); }
  catch (error) { diagnostics.push(error instanceof SyntaxError ? 'Invalid JSON-LD syntax' : 'JSON-LD complexity limit reached'); }
  return { nodes, declared, diagnostics };
}

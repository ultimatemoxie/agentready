import { writeFile } from 'node:fs/promises';
const source = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';
const response = await fetch(source, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`Schema.org download failed: ${response.status}`);
const graph = (await response.json())['@graph'];
const name = (id) => typeof id === 'string' ? /^(?:schema:|https?:\/\/schema\.org\/)([A-Za-z][A-Za-z0-9]*)$/.exec(id)?.[1] || '' : '';
const parents = {};
for (const node of graph) {
  if (!(Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).includes('rdfs:Class')) continue;
  if (!name(node['@id'])) continue;
  const types = node['rdfs:subClassOf'] || [];
  parents[name(node['@id'])] = (Array.isArray(types) ? types : [types]).map(parent => name(parent['@id'])).filter(Boolean);
}
if (Object.keys(parents).length < 800 || !parents.LocalBusiness || !parents.Product) throw new Error('Incomplete Schema.org hierarchy');
await writeFile(new URL('../src/lib/analysis/schema-types.ts', import.meta.url),
  '// Generated from the official Schema.org vocabulary; review snapshot updates.\n' +
  `export const SCHEMA_TYPES: { retrievedAt: string; source: string; parents: Record<string, string[]> } = ${JSON.stringify({ retrievedAt: new Date().toISOString(), source, parents }, null, 2)};\n`);
console.log(`Schema.org hierarchy: ${Object.keys(parents).length} types.`);

// Maintenance only: production never downloads its security policy at request time.
import { writeFile } from 'node:fs/promises';

const sources = {
  ipv4: 'https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv',
  ipv6: 'https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv',
  allocations: 'https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.csv',
};
function csv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}
const data = {};
for (const [key, url] of Object.entries(sources)) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`IANA download failed: ${response.status}`);
  data[key] = csv(await response.text());
}
const special = (rows) => {
  const globalColumn = rows[0].indexOf('Globally Reachable');
  if (globalColumn < 0) throw new Error('IANA format changed');
  return rows.slice(1).flatMap(row => (row[0].match(/[\da-f:.]+\/\d+/gi) || []).map(cidr => ({
    cidr, name: row[1], globallyReachable: /^True\b/.test(row[globalColumn]),
  })));
};
const snapshot = {
  retrievedAt: new Date().toISOString(), sources,
  ipv4: special(data.ipv4), ipv6: special(data.ipv6),
  ipv6Allocations: data.allocations.slice(1).filter(row => row[5] === 'ALLOCATED').map(row => row[0]),
};
if (snapshot.ipv4.length < 20 || snapshot.ipv6.length < 20 || snapshot.ipv6Allocations.length < 20) throw new Error('Incomplete IANA snapshot');
await writeFile(new URL('../src/lib/analysis/iana-address-policy.ts', import.meta.url),
  '// Generated from IANA registries by scripts/update-ip-policy.mjs. Review changes before use.\n' +
  `export const IANA_ADDRESS_POLICY = ${JSON.stringify(snapshot, null, 2)} as const;\n`);
console.log(`IANA snapshot: ${snapshot.ipv4.length} IPv4, ${snapshot.ipv6.length} IPv6 entries; ${snapshot.ipv6Allocations.length} allocated IPv6 prefixes.`);

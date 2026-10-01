import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { notFound } from 'next/navigation';
import { ReportView } from '../../../../components/ReportView';
import { extractPage } from '../../../../lib/analysis/extract.ts';
import { classify } from '../../../../lib/analysis/classify.ts';
import { buildReport } from '../../../../lib/analysis/score.ts';
import type { CrawlResult } from '../../../../lib/analysis/crawl.ts';

export const dynamic = 'force-dynamic';
const fixtureNames: Record<string, string> = {
  ecommerce: 'ecommerce.html', service: 'service.html', 'nigerian-sme': 'nigerian-sme.html', ambiguous: 'ambiguous.html',
};

export default async function FixtureReport({ params }: { params: Promise<{ name: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { name } = await params;
  const filename = fixtureNames[name];
  if (!filename) notFound();
  const html = await readFile(join(process.cwd(), 'tests', 'fixtures', filename), 'utf8');
  const url = name === 'ecommerce' ? 'https://meridian.example/' : `https://${name}.fixture.invalid/`;
  const page = extractPage(html, url);
  const crawl: CrawlResult = { pages: [page], responses: [{ url, status: 200, contentType: 'text/html' }], warnings: ['Development fixture: no live network checks were made.'],
    robots: 'Not checked in fixture', sitemap: 'Not checked in fixture', llms: 'Not checked in fixture' };
  const report = buildReport(url, url, classify(crawl));
  return <><div style={{ background: '#c79635', color: '#031127', padding: '12px 4%', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', display: 'flex', justifyContent: 'space-between' }}>DEVELOPMENT FIXTURE · {name} · NOT A LIVE ANALYSIS <a href="/">← Return home</a></div><ReportView report={report}/></>;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type ReactNode } from 'react';
import { extractPage } from '../src/lib/analysis/extract.ts';
import { classify } from '../src/lib/analysis/classify.ts';
import { buildReport } from '../src/lib/analysis/score.ts';
import type { AnalysisReport, StoredAnalysisRun } from '../src/lib/types.ts';

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup: (node: ReactNode) => string };
const ts = require('typescript') as { transpileModule: (source: string, options: { compilerOptions: { jsx: number; module: number; target: number } }) => { outputText: string }; JsxEmit: { ReactJSX: number }; ModuleKind: { ESNext: number }; ScriptTarget: { ES2022: number } };
async function loadComponent(path: string) {
  const source = readFileSync(path, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')));
  return import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
}
const { ReportView, scoreBand, cleanWebsiteUrl } = await loadComponent('src/components/ReportView.tsx') as {
  ReportView: (props: { report: AnalysisReport }) => ReturnType<typeof createElement>;
  scoreBand: (score: number | null) => { label: string; tone: string; meaning: string };
  cleanWebsiteUrl: (url: string) => string;
};
const { SavedRunHeader } = await loadComponent('src/components/SavedRunHeader.tsx') as {
  SavedRunHeader: (props: { run: StoredAnalysisRun }) => ReturnType<typeof createElement>;
};

const base = 'https://meridian.example/';
const html = readFileSync('tests/fixtures/ecommerce.html', 'utf8');
const page = extractPage(html, base);
const report = buildReport(base, base, classify({ pages: [page], responses: [{ url: base, status: 200, contentType: 'text/html' }], warnings: [],
  robots: 'Not checked', sitemap: 'Not checked', llms: 'Not checked' }));
const renderReport = (value = report) => renderToStaticMarkup(createElement(ReportView, { report: value }));

test('report metadata lives in a closed advanced section', () => {
  const run = { id: report.run.id, createdAt: report.run.createdAt, status: 'PARTIAL', analysisVersion: '1.0.0', scoringVersion: '1.0.0',
    detectorVersion: '1.0.0', schemaVersion: '1', reportData: report } as StoredAnalysisRun;
  const rendered = renderToStaticMarkup(createElement(SavedRunHeader, { run }));
  assert.match(rendered, /<details class="advanced-run-info"><summary>Advanced report info<\/summary>/);
  assert.match(rendered, /Report ID/);
  assert.match(rendered, /Scoring version/);
  assert.ok(rendered.indexOf('Report ID') > rendered.indexOf('<details class="advanced-run-info">'));
  assert.doesNotMatch(rendered, /<details class="advanced-run-info" open/);
});

test('score ring has an accessible label, deterministic band and coverage', () => {
  const bands: [number, string, string][] = [[0, 'Poor', 'poor'], [39, 'Poor', 'poor'], [40, 'Needs work', 'needs-work'],
    [59, 'Needs work', 'needs-work'], [60, 'Good foundation', 'good'], [79, 'Good foundation', 'good'], [80, 'Strong', 'strong'], [100, 'Strong', 'strong']];
  for (const [score, label, tone] of bands) {
    assert.deepEqual([scoreBand(score).label, scoreBand(score).tone], [label, tone]);
    const value = structuredClone(report); value.run.overallScore = score;
    const rendered = renderReport(value);
    assert.match(rendered, new RegExp('data-band="' + tone + '"'));
    assert.ok(rendered.includes('AgentReady score ' + score + ' out of 100: ' + label));
    assert.ok(rendered.includes(String(value.run.coverage.percent) + '%</strong> of relevant checks completed'));
  }
});

test('low coverage suppresses the ring number and partial coverage remains explicit', () => {
  const low = structuredClone(report); low.run.overallScore = null; low.run.analysisStatus = 'low_coverage';
  const rendered = renderReport(low);
  assert.match(rendered, /AgentReady score unavailable: insufficient coverage/);
  assert.match(rendered, /Partial analysis/);
  assert.match(rendered, /score should be treated as provisional/);
  assert.doesNotMatch(rendered, /class="score-ring-center"><strong>\d+/);
});

test('seven categories and their evidence are collapsed by default', () => {
  const rendered = renderReport();
  assert.equal((rendered.match(/<details class="category-accordion">/g) || []).length, 7);
  assert.equal((rendered.match(/<summary><span class="category-summary-copy">/g) || []).length, 7);
  assert.doesNotMatch(rendered, /<details class="category-accordion" open/);
  assert.match(rendered, /View evidence \(/);
  assert.match(rendered, /Detector:/);
  assert.match(rendered, /Confidence:/);
  assert.match(rendered, /Source:/);
  assert.match(rendered, /<details class="report-deep-dive technical-evidence">/);
});

test('the first three existing recommendations form the visible action summary', () => {
  const rendered = renderReport();
  const count = Math.min(3, report.run.recommendations.length);
  assert.equal((rendered.match(/<article class="priority-card">/g) || []).length, count);
  assert.match(rendered, /What to fix first/);
  for (const recommendation of report.run.recommendations.slice(0, 3)) assert.ok(rendered.includes(recommendation.action));
});

test('clean display URL omits tracking while technical sources remain available', () => {
  assert.equal(cleanWebsiteUrl('https://example.com/shop/?utm_source=campaign&gclid=abc#top'), 'https://example.com/shop');
  assert.equal(cleanWebsiteUrl('https://example.com/shop?category=shirts&utm_medium=email#top'), 'https://example.com/shop?category=shirts');
  assert.equal(cleanWebsiteUrl('https://chowdeck.com/?gad_source=1&gad_campaignid=23801370604&gbraid=abc&gclid=xyz'), 'https://chowdeck.com');
  const value = structuredClone(report);
  value.run.normalizedUrl = 'https://meridian.example/?utm_source=campaign';
  const rendered = renderReport(value);
  assert.match(rendered, /<p class="report-clean-url">https:\/\/meridian.example<\/p>/);
  assert.ok(!rendered.includes('<p class="report-clean-url">https://meridian.example/?utm_source=campaign</p>'));
  assert.match(rendered, /HTTP status \/ analyzed URLs/);
});

test('native details and summaries expose keyboard-operable controls', () => {
  const rendered = renderReport();
  assert.equal((rendered.match(/<details\b/g) || []).length, (rendered.match(/<summary\b/g) || []).length);
  assert.match(rendered, /Analysis coverage and limitations/);
  assert.match(rendered, /What AI can learn about this business/);
  assert.match(rendered, /All recommendations/);
});

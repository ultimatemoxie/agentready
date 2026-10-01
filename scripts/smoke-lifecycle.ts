// Optional compiled-server smoke. Submit once, then use verify after a server restart.
import { createHash } from 'node:crypto';
import { validateStoredReport } from '../src/lib/persistence/validation.ts';
import type { StoredAnalysisRun } from '../src/lib/types.ts';

const [mode, origin, argument, expectedHash] = process.argv.slice(2);
if (!['submit', 'verify'].includes(mode || '') || !origin || !argument || mode === 'verify' && !expectedHash) {
  console.error('Usage: node scripts/smoke-lifecycle.ts submit http://127.0.0.1:3007 https://example.com | verify http://127.0.0.1:3007 RUN_ID SHA256');
  process.exit(1);
}
const base = new URL(origin);
const retrieve = async (id: string): Promise<StoredAnalysisRun> => {
  const response = await fetch(new URL(`/api/reports/${id}`, base), { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  const payload = await response.json();
  if (!response.ok || !payload.run || payload.run.id !== id) throw new Error(`Could not retrieve saved report: ${response.status}`);
  return payload.run as StoredAnalysisRun;
};
let id = argument, submittedStatus: string | undefined;
if (mode === 'submit') {
  const response = await fetch(new URL('/api/analyze', base), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: argument }), signal: AbortSignal.timeout(70_000) });
  const payload = await response.json();
  if (response.status !== 201 || !payload.id || payload.reportUrl !== `/report/${payload.id}`) throw new Error(`Invalid create response: ${response.status}`);
  id = payload.id; submittedStatus = payload.status;
}
const first = await retrieve(id), second = await retrieve(id);
const fingerprint = (run: StoredAnalysisRun) => createHash('sha256').update(JSON.stringify(run.reportData)).digest('hex');
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Re-fetch changed the saved run');
if (mode === 'verify' && fingerprint(first) !== expectedHash) throw new Error('Saved report changed after restart');
if (submittedStatus && first.status !== submittedStatus) throw new Error('Created and retrieved statuses differ');
if (first.reportData) validateStoredReport(first.reportData, id, first.schemaVersion);
const page = await fetch(new URL(`/report/${id}`, base), { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
const html = await page.text();
if (page.status !== 200 || !html.includes(id) || !html.includes(first.status === 'FAILED' ? 'Analysis failed' : first.reportData?.profile.name || 'Analysis in progress')) throw new Error(`Saved report page did not render: ${page.status}`);
console.log(JSON.stringify({ mode, outcome: 'PASS', id, reportUrl: `/report/${id}`, status: first.status,
  score: first.overallScore, coverage: first.coverage, analysisVersion: first.analysisVersion, scoringVersion: first.scoringVersion,
  detectorVersion: first.detectorVersion, schemaVersion: first.schemaVersion,
  evidenceCount: first.reportData?.run.technicalEvidence.records.length ?? 0, fingerprint: fingerprint(first), pageStatus: page.status }, null, 2));

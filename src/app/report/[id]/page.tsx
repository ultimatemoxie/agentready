import { notFound } from 'next/navigation';
import { ReportView } from '../../../components/ReportView';
import { PendingRun } from '../../../components/PendingRun';
import { getAnalysisRepository } from '../../../lib/persistence/repository.ts';
import { StoredRecordError } from '../../../lib/persistence/validation.ts';
import type { StoredAnalysisRun } from '../../../lib/types.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function RunHeader({ run }: { run: StoredAnalysisRun }) {
  return <div className="shell saved-run-header"><div><span className="card-eyebrow">SAVED ANALYSIS / {run.status}</span><p><strong>Report ID:</strong> <code>{run.id}</code> · <strong>Created:</strong> {new Date(run.createdAt).toLocaleString()}</p>
    <p><strong>Versions:</strong> analysis {run.analysisVersion} · scoring {run.scoringVersion} · detector {run.detectorVersion} · schema {run.schemaVersion}</p></div>
    <nav aria-label="Report navigation"><a href="/">New analysis</a><a href="/reports">Recent analyses</a></nav></div>;
}

export default async function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run: StoredAnalysisRun | null;
  try { run = await getAnalysisRepository().getById(id); }
  catch (error) {
    return <main className="saved-run-page"><div className="shell saved-run-state"><h1>Report unavailable</h1><p>{error instanceof StoredRecordError ? error.message : 'The saved report could not be loaded.'}</p><a href="/reports">View recent analyses</a></div></main>;
  }
  if (!run) notFound();
  return <main className="saved-run-page"><RunHeader run={run}/>
    {run.reportData ? <ReportView report={run.reportData}/> : <section className="shell saved-run-state">
      <h1>{run.status === 'FAILED' ? 'Analysis failed' : 'Analysis in progress'}</h1>
      <p className="report-url">{run.normalizedUrl || run.inputUrl}</p>
      {run.status === 'FAILED' ? <><p><strong>{run.errorCode}</strong> · {run.errorMessage}</p><p>The run is saved under this report URL. You can start a new analysis when ready.</p></> : <PendingRun id={run.id}/>}
    </section>}
  </main>;
}

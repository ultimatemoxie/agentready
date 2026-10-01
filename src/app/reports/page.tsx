import { getAnalysisRepository } from '../../lib/persistence/repository.ts';
import type { RecentAnalysisRun } from '../../lib/types.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function RecentReportsPage() {
  let runs: RecentAnalysisRun[] = [], error = false;
  try { runs = await getAnalysisRepository().listRecent(20); } catch { error = true; }
  return <main className="saved-run-page"><div className="shell recent-runs"><div className="section-kicker"><span>AGENTREADY / LOCAL RESEARCH</span><a href="/">New analysis ↗</a></div>
    <h1>Recent analyses</h1><p>Saved reports on this local installation. Each submission creates a separate historical run.</p>
    {error ? <p role="alert">Recent analyses could not be loaded.</p> : runs.length ? <ul>{runs.map(run => <li key={run.id}><a href={`/report/${run.id}`}><span><strong>{run.normalizedUrl || run.inputUrl}</strong><small>{new Date(run.createdAt).toLocaleString()} · {run.status}</small></span><span>{run.overallScore === null ? 'Score unavailable' : `${run.overallScore}/100`}{run.coverage !== null ? ` · ${Math.round(run.coverage)}% coverage` : ''}</span></a></li>)}</ul> : <p>No analyses saved yet.</p>}
  </div></main>;
}

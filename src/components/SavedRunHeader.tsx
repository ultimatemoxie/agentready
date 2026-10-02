import type { StoredAnalysisRun } from '../lib/types.ts';

export function SavedRunHeader({ run }: { run: StoredAnalysisRun }) {
  return <div className="shell saved-run-toolbar">
    <nav aria-label="Report navigation"><a href="/">← New analysis</a><a href="/reports">Recent analyses</a></nav>
    <details className="advanced-run-info"><summary>Advanced report info</summary>
      <dl><div><dt>Report ID</dt><dd><code>{run.id}</code></dd></div>
        <div><dt>Created</dt><dd>{new Date(run.createdAt).toLocaleString()}</dd></div>
        <div><dt>Run status</dt><dd>{run.status}</dd></div>
        <div><dt>Analysis version</dt><dd>{run.analysisVersion}</dd></div>
        <div><dt>Scoring version</dt><dd>{run.scoringVersion}</dd></div>
        <div><dt>Detector version</dt><dd>{run.detectorVersion}</dd></div>
        <div><dt>Schema version</dt><dd>{run.schemaVersion}</dd></div>
        {run.reportData && <div><dt>Original assessment label</dt><dd>{run.reportData.statusLabel}</dd></div>}
      </dl>
    </details>
  </div>;
}

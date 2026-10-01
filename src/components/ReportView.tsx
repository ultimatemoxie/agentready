import type { AnalysisReport, CategoryScore, Recommendation } from '../lib/types.ts';

const percent = (value: number) => `${Number(value.toFixed(1))}%`;
function CategoryCard({ category }: { category: CategoryScore }) {
  const detected = category.rules.filter(rule => rule.state === 'DETECTED');
  const missing = category.rules.filter(rule => rule.state === 'NOT_DETECTED');
  const unknown = category.rules.filter(rule => rule.state === 'UNKNOWN');
  const notApplicable = category.rules.filter(rule => rule.state === 'NOT_APPLICABLE');
  return <article className="category-card"><div className="category-head"><div><span className="card-eyebrow">{category.label.toUpperCase()}</span><h3>{category.label}</h3></div><div className="category-value">{category.earnedPoints}<span>/{category.evaluatedPoints} evaluated</span></div></div>
    <div className="category-bar"><span style={{ width: `${category.evaluatedPoints ? category.earnedPoints / category.evaluatedPoints * 100 : 0}%` }}/></div>
    <p className="category-coverage">Coverage {percent(category.coverage)} · Maximum weight {category.max}<br/>Raw earned {category.earnedPoints} · Evaluated possible {category.evaluatedPoints}{category.normalizedScore !== null && <><br/>Normalized {Number(category.normalizedScore.toFixed(1))}/{category.max}</>}</p>
    <p className="category-why">{category.why}</p>
    <div className="category-list"><strong>Detected</strong>{detected.length ? detected.map(rule => <p key={rule.ruleId}><span className="signal-check">✓</span><span>{rule.label}<small className="rule-evidence">{rule.evidence}</small></span></p>) : <p className="muted">No eligible signals detected.</p>}</div>
    <div className="category-list missing-list"><strong>Not detected in inspected content</strong>{missing.length ? missing.map(rule => <p key={rule.ruleId}><span className="signal-dash">—</span><span>{rule.label}<small className="rule-evidence">{rule.reason}</small></span></p>) : <p className="muted">No confirmed missing signals.</p>}</div>
    {unknown.length > 0 && <div className="category-list missing-list"><strong>Unknown — excluded from evaluated points</strong>{unknown.map(rule => <p key={rule.ruleId}><span className="signal-dash">?</span><span>{rule.label}<small className="rule-evidence">{rule.reason}</small></span></p>)}</div>}
    {notApplicable.length > 0 && <div className="category-list missing-list"><strong>Not applicable</strong>{notApplicable.map(rule => <p key={rule.ruleId}>{rule.label} · {rule.reason}</p>)}</div>}
  </article>;
}

function CoverageSection({ report }: { report: AnalysisReport }) {
  const coverage = report.run.coverage;
  const incomplete = report.run.analysisStatus !== 'complete';
  return <section className="analysis-coverage" aria-labelledby="coverage-heading"><h2 id="coverage-heading">Analysis Coverage</h2><p><strong>{percent(coverage.percent)}</strong> of applicable point weight evaluated · {coverage.evaluatedPoints}/{coverage.applicablePoints} points</p>
    <p>{coverage.level === 'low' ? 'Insufficient coverage for a reliable overall score.' : coverage.level === 'partial' ? 'Partial analysis. The displayed score is provisional.' : incomplete ? 'Partial analysis. A readiness band is shown because at least 75% of applicable weight was evaluated.' : 'All applicable scoring checks were evaluated.'} {incomplete && 'Some checks could not be completed. Missing signals below should not all be interpreted as business deficiencies.'}</p>
    <dl className="coverage-counts">{[['Total rules', coverage.totalChecks], ['Detected', coverage.detected], ['Not detected', coverage.notDetected], ['Unknown', coverage.unknown], ['Not applicable', coverage.notApplicable], ['Pages analyzed', coverage.pagesAnalyzed], ['Pages failed', coverage.pagesFailed], ['Pages skipped', coverage.pagesSkipped]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p>Coverage describes completion of this bounded public HTML analysis, not statistical confidence or proof of site-wide absence. Readiness is earned points divided by evaluated possible points. Unknown checks do not receive zero.</p>
    {(report.run.analysisLimitations.length > 0 || report.run.technicalEvidence.warnings.length > 0) && <details><summary>Unknown checks and analysis limitations</summary><ul>{report.run.analysisLimitations.map(item => <li key={item.ruleId}><strong>{item.label}</strong> ({item.ruleId}): {item.reason}</li>)}{report.run.technicalEvidence.warnings.map((warning, index) => <li key={`warning-${index}`}>{warning}</li>)}</ul></details>}
  </section>;
}

function RecommendationItem({ item, index }: { item: Recommendation; index?: number }) {
  return <div className="recommendation-item"><div className="recommendation-index">{index ? String(index).padStart(2, '0') : item.priority}</div><div><div className="recommendation-top"><span className={`priority priority-${item.priority.toLowerCase()}`}>{item.priority} / {item.priority === 'P0' ? 'Critical' : item.priority === 'P1' ? 'Important' : 'Enhancement'}</span><span>{item.category}</span></div><h3>{item.title}</h3><p><strong>Why it matters:</strong> {item.why}</p><p><strong>Inspection context:</strong> {item.reason}</p><p><strong>Recommended action:</strong> {item.action}</p></div></div>;
}

function Evidence({ report }: { report: AnalysisReport }) {
  const evidence = report.run.technicalEvidence;
  const rows: [string, string][] = [
    ['HTTP status / analyzed URLs', evidence.analyzedUrls.map((item) => `${item.status} · ${item.url} · ${item.contentType}`).join('\n')],
    ['Scoring math', `Raw earned: ${report.run.rawScore} · Evaluated possible: ${report.run.coverage.evaluatedPoints} · Applicable possible: ${report.run.coverage.applicablePoints} · Maximum: ${report.run.coverage.maximumPoints}\nUnrounded normalized score: ${report.run.normalizedScore ?? 'Unavailable'} · Coverage: ${percent(report.run.coverage.percent)}`],
    ['Scoring rules', report.run.categoryScores.flatMap(category => category.rules).map(rule => `${rule.ruleId} · ${rule.state} · earned=${rule.pointsEarned ?? 'not evaluated'} / ${rule.maxPoints}\n${rule.reason}\nEvidence IDs: ${rule.evidenceIds.join(', ') || 'None'}`).join('\n\n')],
    ['Detected schema types', evidence.schemaTypes.join(', ') || 'None detected'],
    ['Detected signals and inferred observations', evidence.records.map((signal) => `${signal.type}: ${signal.value}\nSource: ${signal.sourceUrl} (${signal.sourceType})\nEvidence: ${signal.rawEvidence}\nConfidence: ${signal.confidence.toUpperCase()} · Detector: ${signal.detector} · ID: ${signal.id}`).join('\n\n') || 'None detected'],
    ['Evidence checks', evidence.checks.map((check) => `${check.status} · ${check.type} · ${check.sourceUrl}${check.reason ? ' · ' + check.reason : ''}`).join('\n')],
    ['Resource coverage', evidence.resourceChecks.map((check) => `${check.status} · ${check.resource} · ${check.sourceUrl}${check.reason ? ' · ' + check.reason : ''}`).join('\n')],
    ['Metadata', Object.entries(evidence.metadata).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join('\n') || 'None detected'],
    ['Forms and actions', evidence.forms.map((form) => `${form.purpose} · ${form.action} (on ${form.sourceUrl})`).join('\n') || 'None detected'],
    ['Contact methods', evidence.contactMethods.join('\n') || 'None detected'],
    ['Policy URLs', evidence.policyUrls.join('\n') || 'None detected'],
    ['Provider indicators', evidence.providers.join(', ') || 'None detected'],
    ['Chat widget indicators', evidence.chatWidgets.join(', ') || 'None detected'],
    ['Direct map / business links', evidence.mapLinks.join('\n') || 'None detected'],
    ['Machine endpoints', evidence.endpoints.join('\n') || 'None detected'],
    ['robots.txt', evidence.robots], ['sitemap.xml', evidence.sitemap], ['llms.txt', evidence.llms],
    ['Checked at', new Date(evidence.checkedAt).toLocaleString()],
  ];
  return <details className="technical-evidence"><summary><span>Technical Evidence</span><span>EXPAND TO VIEW RAW FINDINGS <b aria-hidden="true">＋</b></span></summary><div className="evidence-content">{rows.map(([label, value]) => <div className="evidence-row" key={label}><strong>{label}</strong><pre>{value}</pre></div>)}{evidence.warnings.length > 0 && <div className="evidence-row"><strong>Checks not completed</strong><pre>{evidence.warnings.join('\n')}</pre></div>}</div></details>;
}

export function ReportView({ report }: { report: AnalysisReport }) {
  const { run, profile } = report;
  return <section className="report-section" id="report" aria-label="Agent Readiness Report"><div className="shell">
    <div className="report-header"><div><div className="section-kicker"><span>AGENT READINESS REPORT</span><span>PUBLIC WEBSITE AUDIT / V 0.1</span></div><p className="report-url">{run.normalizedUrl}</p><h2>{profile.name}</h2>{(run.status === 'partial' || run.coverage.unknown > 0 || run.coverage.pagesSkipped > 0) && <p className="partial-note">Partial analysis · Some checks could not be completed. See Technical Evidence.</p>}</div><div className="score-panel"><span>AGENT READINESS</span><div className={`score-number ${run.overallScore === null ? "score-unavailable" : ""}`}>{run.overallScore === null ? "Insufficient coverage" : <>{run.overallScore}<small>/ 100</small></>}</div><p className="score-coverage">{percent(run.coverage.percent)} analysis coverage{run.coverage.level === "partial" ? " · provisional" : ""}</p><strong>{report.statusLabel}</strong></div></div>
    <p className="report-disclaimer">{report.disclaimer}</p><CoverageSection report={report}/>
    <div className="report-section-head"><span>01 / SCORE BREAKDOWN</span><p>Seven dimensions. Every point follows a visible rule.</p></div>
    <div className="category-grid">{run.categoryScores.map((category) => <CategoryCard key={category.key} category={category}/>)}</div>
    <div className="insights-grid"><section className="insights-panel blockers"><div className="panel-title"><span>02 / PRIORITIES</span><h2>Top Agent Readiness Blockers</h2></div>{report.topBlockers.length ? report.topBlockers.map((item, index) => <RecommendationItem key={`${item.category}-${item.title}`} item={item} index={index + 1}/>) : <p>No high-priority recommendations from evaluated missing signals. Unknown checks are listed under Analysis Coverage.</p>}</section>
      <section className="insights-panel positive"><div className="panel-title"><span>03 / STRENGTHS</span><h2>What You’re Already Doing Well</h2></div>{report.positiveSignals.length ? <ul>{report.positiveSignals.map((signal) => <li key={signal}><span>✓</span>{signal}</li>)}</ul> : <p>No positive signals were detected in the checked pages.</p>}</section></div>
    <section className="agent-view"><div className="agent-view-intro"><span>04 / AGENT VIEW</span><h2>What an AI agent can currently learn about this business</h2><p>Observed facts are listed as detected. Values inferred from headings or metadata are marked partial. Missing values are left blank of claims.</p></div><div className="agent-fields">{profile.agentView.map((field) => <div className="agent-field" key={field.label}><span>{field.label}</span><p>{field.value}</p><b className={`field-status ${field.status.toLowerCase().replaceAll(' ', '-')}`}>{field.status}</b></div>)}</div></section>
    <section className="all-recommendations"><div className="report-section-head"><span>05 / NEXT STEPS</span><p>Recommendations from evaluated NOT_DETECTED rules only.</p></div><h2>Prioritized recommendations</h2>{run.recommendations.length ? <div className="recommendation-grid">{run.recommendations.slice(0, 8).map((item, index) => <RecommendationItem key={`${item.category}-${item.title}`} item={item} index={index + 1}/>)}</div> : <p>No deficiency recommendations from evaluated rules. Review any unknown checks under Analysis Coverage.</p>}</section>
    <Evidence report={report}/>
  </div></section>;
}

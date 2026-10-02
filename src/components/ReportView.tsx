import type { CSSProperties } from 'react';
import type { AnalysisReport, CategoryKey, CategoryScore, EvidenceRecord, Recommendation, ScoreRuleResult } from '../lib/types.ts';

const percent = (value: number) => Number(value.toFixed(1)) + '%';
const questions: Record<CategoryKey, string> = {
  identity: 'Can AI clearly tell who your business is?',
  offering: 'Can AI understand what you sell or provide?',
  discovery: 'Can AI find and interpret your website information?',
  trust: 'Can visitors judge your terms and credibility?',
  communication: 'Can customers easily reach your business?',
  actionability: 'Can customers take useful steps such as booking or requesting a quote?',
  transaction: 'Can customers move toward buying or paying?',
};
const simpleTitles: Record<string, string> = {
  'identity.name': 'Make your business name clear',
  'offering.offerings': 'Make your products or services clearer',
  'actionability.actionFlow': 'Show customers a clear next step',
  'offering.prices': 'Make prices easier to find',
  'trust.privacy': 'Publish a clear privacy policy',
  'trust.returnPolicy': 'Explain your refund or cancellation terms',
  'communication.contactFlow': 'Make it easier to contact you',
  'identity.identitySchema': 'Add structured details about your business',
  'identity.canonical': 'Choose one main website address',
  'discovery.canonical': 'Choose one main website address',
  'actionability.purposefulForm': 'Make your website forms easier to understand',
  'offering.categories': 'Organize your products or services into clear categories',
  'communication.phone': 'Add a customer phone number if you use one',
};

export function cleanWebsiteUrl(input: string): string {
  try {
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gad_)/i.test(key) || /^(gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')) + url.search;
  } catch {
    return input.split('#', 1)[0];
  }
}

export function scoreBand(score: number | null) {
  if (score === null) return { label: 'Insufficient coverage', tone: 'unavailable', meaning: 'Too many checks were unavailable for a reliable overall score. The findings below still show what AgentReady could inspect.' };
  if (score < 40) return { label: 'Poor', tone: 'poor', meaning: 'AI may struggle to understand or use important parts of your business.' };
  if (score < 60) return { label: 'Needs work', tone: 'needs-work', meaning: 'AI can understand some parts of your business, but important gaps remain.' };
  if (score < 80) return { label: 'Good foundation', tone: 'good', meaning: 'Your business has a solid base, but there are still areas that could make it easier for AI agents to understand or act.' };
  return { label: 'Strong', tone: 'strong', meaning: 'Your business exposes many of the signals and actions AI agents may need.' };
}

function Priority({ item, index, compact = false }: { item: Recommendation; index: number; compact?: boolean }) {
  const title = compact ? simpleTitles[item.ruleId] || item.action : item.title;
  const repeatsTitle = title.trim().replace(/[.!?]+$/, '').toLowerCase() === item.action.trim().replace(/[.!?]+$/, '').toLowerCase();
  return <article className={compact ? 'priority-card' : 'recommendation-item'}>
    <span className="priority-index" aria-hidden="true">{String(index).padStart(2, '0')}</span>
    <div><span className="priority-tag">{item.priority === 'P0' ? 'Critical' : item.priority === 'P1' ? 'Important' : 'Enhancement'}</span>
      <h3>{title}</h3>
      <p>{item.why}</p>{(!compact || !repeatsTitle) && <p><strong>Next step:</strong> {item.action}</p>}
      {!compact && <p className="priority-inspection"><strong>Inspection context:</strong> {item.reason}</p>}
    </div>
  </article>;
}

function EvidenceForRule({ rule, records }: { rule: ScoreRuleResult; records: Map<string, EvidenceRecord> }) {
  const supporting = rule.evidenceIds.map(id => records.get(id)).filter((record): record is EvidenceRecord => !!record);
  if (!supporting.length) return null;
  return <details className="rule-evidence-toggle"><summary>View evidence ({supporting.length})</summary>
    <ul>{supporting.map(record => <li key={record.id}>
      <strong>{record.value}</strong><span>Source: {record.sourceUrl}</span>
      <span>Detector: {record.detector} · Confidence: {record.confidence}</span>
      <code>{record.rawEvidence}</code>
    </li>)}</ul>
  </details>;
}

function RuleGroup({ title, rules, records }: { title: string; rules: ScoreRuleResult[]; records: Map<string, EvidenceRecord> }) {
  if (!rules.length) return null;
  return <div className="report-rule-group"><h4>{title}</h4><ul>{rules.map(rule => <li key={rule.ruleId}>
    <strong>{rule.label}</strong><p>{rule.reason}</p>
    {rule.state === 'DETECTED' && <EvidenceForRule rule={rule} records={records}/>}
    {rule.state === 'NOT_DETECTED' && <p className="rule-next-step"><strong>Suggested action:</strong> {rule.action}</p>}
  </li>)}</ul></div>;
}

function CategoryCard({ category, records }: { category: CategoryScore; records: Map<string, EvidenceRecord> }) {
  const detected = category.rules.filter(rule => rule.state === 'DETECTED');
  const missing = category.rules.filter(rule => rule.state === 'NOT_DETECTED');
  const unknown = category.rules.filter(rule => rule.state === 'UNKNOWN');
  const notApplicable = category.rules.filter(rule => rule.state === 'NOT_APPLICABLE');
  const shownScore = category.normalizedScore === null ? '—' : String(Number(category.normalizedScore.toFixed(1)));
  return <details className="category-accordion">
    <summary><span className="category-summary-copy"><strong>{category.label}</strong><span>{questions[category.key]}</span>
      <small>{detected.length} detected · {missing.length} missing · {unknown.length} unknown</small></span>
      <span className="category-summary-score"><strong>{shownScore} <small>/ {category.max}</small></strong><span>{percent(category.coverage)} checked</span></span>
      <span className="accordion-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="category-expansion"><p>Raw earned {category.earnedPoints} of {category.evaluatedPoints} evaluated points · Maximum weight {category.max}. {category.why}</p>
      <RuleGroup title="Detected" rules={detected} records={records}/>
      <RuleGroup title="Not detected in checked content" rules={missing} records={records}/>
      <RuleGroup title="Unknown — not counted as missing" rules={unknown} records={records}/>
      <RuleGroup title="Not applicable" rules={notApplicable} records={records}/>
    </div>
  </details>;
}

function CoverageSection({ report }: { report: AnalysisReport }) {
  const coverage = report.run.coverage;
  const incomplete = report.run.analysisStatus !== 'complete';
  return <div className="coverage-deep-content"><h3>Analysis Coverage</h3>
    <p><strong>{percent(coverage.percent)}</strong> of applicable point weight evaluated · {coverage.evaluatedPoints}/{coverage.applicablePoints} points.</p>
    <p>{incomplete ? 'Some checks could not be completed. Missing signals below should not all be interpreted as business deficiencies.' : 'All applicable scoring checks were evaluated.'}</p>
    <dl className="coverage-counts">{[['Total rules', coverage.totalChecks], ['Detected', coverage.detected], ['Not detected', coverage.notDetected], ['Unknown', coverage.unknown], ['Not applicable', coverage.notApplicable], ['Pages analyzed', coverage.pagesAnalyzed], ['Pages failed', coverage.pagesFailed], ['Pages skipped', coverage.pagesSkipped]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p>Coverage describes completion of this bounded public HTML analysis, not statistical confidence or proof of site-wide absence. Readiness is earned points divided by evaluated possible points. Unknown checks do not receive zero.</p>
    {(report.run.analysisLimitations.length > 0 || report.run.technicalEvidence.warnings.length > 0) && <div className="coverage-limitations"><h4>Unknown checks and analysis limitations</h4><ul>{report.run.analysisLimitations.map(item => <li key={item.ruleId}><strong>{item.label}</strong> ({item.ruleId}): {item.reason}</li>)}{report.run.technicalEvidence.warnings.map((warning, index) => <li key={'warning-' + index}>{warning}</li>)}</ul></div>}
  </div>;
}

function TechnicalEvidence({ report }: { report: AnalysisReport }) {
  const evidence = report.run.technicalEvidence;
  const rows: [string, string][] = [
    ['HTTP status / analyzed URLs', evidence.analyzedUrls.map(item => item.status + ' · ' + item.url + ' · ' + item.contentType).join('\n')],
    ['Scoring math', 'Raw earned: ' + report.run.rawScore + ' · Evaluated possible: ' + report.run.coverage.evaluatedPoints + ' · Applicable possible: ' + report.run.coverage.applicablePoints + ' · Maximum: ' + report.run.coverage.maximumPoints + '\nUnrounded normalized score: ' + (report.run.normalizedScore ?? 'Unavailable') + ' · Coverage: ' + percent(report.run.coverage.percent)],
    ['Scoring rules', report.run.categoryScores.flatMap(category => category.rules).map(rule => rule.ruleId + ' · ' + rule.state + ' · earned=' + (rule.pointsEarned ?? 'not evaluated') + ' / ' + rule.maxPoints + '\n' + rule.reason + '\nEvidence IDs: ' + (rule.evidenceIds.join(', ') || 'None')).join('\n\n')],
    ['Detected schema types', evidence.schemaTypes.join(', ') || 'None detected'],
    ['Detected signals and inferred observations', evidence.records.map(signal => signal.type + ': ' + signal.value + '\nSource: ' + signal.sourceUrl + ' (' + signal.sourceType + ')\nEvidence: ' + signal.rawEvidence + '\nConfidence: ' + signal.confidence.toUpperCase() + ' · Detector: ' + signal.detector + ' · ID: ' + signal.id).join('\n\n') || 'None detected'],
    ['Evidence checks', evidence.checks.map(check => check.status + ' · ' + check.type + ' · ' + check.sourceUrl + (check.reason ? ' · ' + check.reason : '')).join('\n')],
    ['Resource coverage', evidence.resourceChecks.map(check => check.status + ' · ' + check.resource + ' · ' + check.sourceUrl + (check.reason ? ' · ' + check.reason : '')).join('\n')],
    ['Metadata', Object.entries(evidence.metadata).filter(([, value]) => value).map(([key, value]) => key + ': ' + value).join('\n') || 'None detected'],
    ['Forms and actions', evidence.forms.map(form => form.purpose + ' · ' + form.action + ' (on ' + form.sourceUrl + ')').join('\n') || 'None detected'],
    ['Contact methods', evidence.contactMethods.join('\n') || 'None detected'],
    ['Policy URLs', evidence.policyUrls.join('\n') || 'None detected'],
    ['Provider indicators', evidence.providers.join(', ') || 'None detected'],
    ['Chat widget indicators', evidence.chatWidgets.join(', ') || 'None detected'],
    ['Direct map / business links', evidence.mapLinks.join('\n') || 'None detected'],
    ['Machine endpoints', evidence.endpoints.join('\n') || 'None detected'],
    ['robots.txt', evidence.robots], ['sitemap.xml', evidence.sitemap], ['llms.txt', evidence.llms],
    ['Checked at', new Date(evidence.checkedAt).toLocaleString()],
  ];
  return <details className="report-deep-dive technical-evidence"><summary>Technical Evidence <span>Sources, rules, and raw findings</span></summary>
    <div className="evidence-content">{rows.map(([label, value]) => <div className="evidence-row" key={label}><strong>{label}</strong><pre>{value}</pre></div>)}{evidence.warnings.length > 0 && <div className="evidence-row"><strong>Checks not completed</strong><pre>{evidence.warnings.join('\n')}</pre></div>}</div>
  </details>;
}

export function ReportView({ report }: { report: AnalysisReport }) {
  const { run, profile } = report;
  const band = scoreBand(run.overallScore);
  const incomplete = run.analysisStatus !== 'complete';
  const records = new Map(run.technicalEvidence.records.map(record => [record.id, record]));
  const priorities = run.recommendations.slice(0, 3);
  return <section className="report-section report-ux" id="report" aria-label="Agent Readiness Report"><div className="shell">
    <div className="report-hero">
      <div className="report-hero-copy"><span className="report-kicker">AGENTREADY / WEBSITE ASSESSMENT</span>
        <h1>{profile.name}</h1><p className="report-clean-url">{cleanWebsiteUrl(run.normalizedUrl)}</p>
        <div className="report-meaning"><h2>What this means</h2><p>{band.meaning}</p></div>
        {incomplete && <p className="report-partial-note"><strong>Partial analysis.</strong> Some checks could not be completed, so this score should be treated as provisional.</p>}
      </div>
      <div className="report-score-summary" data-band={band.tone}>
        <span className="report-score-caption">AGENT READINESS</span>
        <div className="score-ring" role="img" aria-label={run.overallScore === null ? 'AgentReady score unavailable: insufficient coverage' : 'AgentReady score ' + run.overallScore + ' out of 100: ' + band.label} style={{ '--ring-progress': String(run.overallScore ?? 0) + '%' } as CSSProperties}>
          <div className="score-ring-center"><strong>{run.overallScore ?? '—'}</strong><small>{run.overallScore === null ? 'NO SCORE' : 'OUT OF 100'}</small></div>
        </div>
        <strong className="report-band-label">{band.label}</strong>
        <p className="report-coverage-label"><strong>{percent(run.coverage.percent)}</strong> of relevant checks completed</p>
      </div>
    </div>

    <section className="report-priorities" aria-labelledby="fix-first-heading"><div className="report-heading-row"><div><span className="report-kicker">YOUR NEXT STEPS</span><h2 id="fix-first-heading">What to fix first</h2></div><p>Based on gaps confirmed in the pages we could check.</p></div>
      {priorities.length ? <div className="priority-grid">{priorities.map((item, index) => <Priority key={item.ruleId} item={item} index={index + 1} compact/>)}</div> : <p className="report-empty-note">No confirmed gaps to prioritize in the checked pages. Review any unknown checks below.</p>}
    </section>

    <section className="report-strengths" aria-labelledby="strengths-heading"><div><span className="report-kicker">POSITIVE SIGNALS</span><h2 id="strengths-heading">What’s working</h2></div>
      {report.positiveSignals.length ? <div className="strength-list"><ul>{report.positiveSignals.slice(0, 4).map(signal => <li key={signal}><span aria-hidden="true">✓</span>{signal}</li>)}</ul>{report.positiveSignals.length > 4 && <details><summary>See all {report.positiveSignals.length} positive signals</summary><ul>{report.positiveSignals.slice(4).map(signal => <li key={signal}><span aria-hidden="true">✓</span>{signal}</li>)}</ul></details>}</div> : <p>No positive signals were confirmed in the pages checked.</p>}
    </section>

    <p className="report-disclaimer">{report.disclaimer}</p>
    <section className="report-categories" aria-labelledby="categories-heading"><div className="report-heading-row"><div><span className="report-kicker">SEVEN AREAS</span><h2 id="categories-heading">How your website scored</h2></div><p>Open an area to see what we found, what was missing, and the supporting evidence.</p></div>
      <div className="category-accordion-grid">{run.categoryScores.map(category => <CategoryCard key={category.key} category={category} records={records}/>)}</div>
    </section>

    <div className="report-more-details">
      <details className="report-deep-dive"><summary>What AI can learn about this business <span>Business facts and detected paths</span></summary><div className="agent-view"><div className="agent-view-intro"><span>AGENT VIEW</span><h2>Public business facts</h2><p>Observed facts are labeled as detected. Inferred values are marked partial; unavailable values remain unclaimed.</p></div><div className="agent-fields">{profile.agentView.map(field => <div className="agent-field" key={field.label}><span>{field.label}</span><p>{field.value}</p><b className={'field-status ' + field.status.toLowerCase().replaceAll(' ', '-')}>{field.status}</b></div>)}</div></div></details>
      <details className="report-deep-dive"><summary>All recommendations <span>{run.recommendations.length} based on evaluated gaps</span></summary><div className="all-recommendations"><p>Recommendations come from NOT_DETECTED rules only. Unknown checks are listed under analysis coverage.</p><div className="recommendation-grid">{run.recommendations.map((item, index) => <Priority key={item.ruleId} item={item} index={index + 1}/>)}</div></div></details>
      <details className="report-deep-dive"><summary>Analysis coverage and limitations <span>{run.coverage.unknown} unknown checks · {run.coverage.pagesFailed} failed pages · {run.coverage.pagesSkipped} skipped pages</span></summary><CoverageSection report={report}/></details>
      <TechnicalEvidence report={report}/>
    </div>
  </div></section>;
}

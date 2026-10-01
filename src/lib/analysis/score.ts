import type { AnalysisReport, AnalysisRun, CategoryKey, CategoryScore, Recommendation, ScoreRuleResult, RuleAssessment, EvidenceRecord, AnalysisCoverage } from '../types.ts';
import type { Classification, Facts } from './classify.ts';
import { describeEvidence, eligible, evidenceSchema } from './evidence.ts';
import { assessRule } from './scoring-context.ts';
import { z } from 'zod';

type Rule = { id: keyof Facts; points: number; label: string; why: string; action: string; priority: 'P0' | 'P1' | 'P2' };
type Spec = { key: CategoryKey; label: string; max: number; why: string; rules: Rule[] };
const rule = (id: keyof Facts, points: number, label: string, why: string, action: string, priority: Rule['priority'] = 'P1'): Rule => ({ id, points, label, why, action, priority });

export const SCORE_SPEC: Spec[] = [
  { key: 'identity', label: 'Identity', max: 15, why: 'Agents need a stable answer to who the business is and where it operates.', rules: [
    rule('name', 3, 'Identifiable business name', 'The business cannot be referenced reliably without a clear name.', 'Publish a consistent business name in the page title and visible content.', 'P0'),
    rule('description', 2, 'Meaningful description', 'A short description helps explain the business without guessing.', 'Add a specific description in visible copy and page metadata.'),
    rule('contact', 2, 'Direct contact details', 'A direct contact method makes the business verifiable and reachable.', 'Expose a current email, phone, or WhatsApp contact.'),
    rule('location', 2, 'Address or service location', 'Location helps determine relevance and service coverage.', 'Publish an address or clear service area when applicable.'),
    rule('identitySchema', 3, 'Organization or local business schema', 'Structured identity helps machines disambiguate the business.', 'Add accurate Organization or LocalBusiness JSON-LD.'),
    rule('canonical', 3, 'Canonical homepage identity', 'A canonical URL clarifies which page represents the business.', 'Add a canonical link to the preferred public homepage.'),
  ] },
  { key: 'offering', label: 'Offering', max: 15, why: 'Agents need concrete offerings and terms to compare or recommend a business.', rules: [
    rule('offerings', 4, 'Named products or services', 'Agents cannot compare an offering that is not clearly named.', 'List specific current products or services in public HTML or structured data.', 'P0'),
    rule('offeringDescriptions', 3, 'Offering descriptions', 'Descriptions explain what each offering includes.', 'Add concise descriptions to product or service pages and schema.'),
    rule('categories', 2, 'Offering categories', 'Categories help group and filter offerings.', 'Publish categories where relevant, including structured data.', 'P2'),
    rule('prices', 3, 'Public price information', 'An agent may not reliably estimate cost without current public prices.', 'Expose current prices in HTML and, where appropriate, Product/Offer data.'),
    rule('identifiers', 3, 'Identifiers or availability', 'Identifiers and availability reduce ambiguity during comparison.', 'Expose SKU, availability, or Offer details where applicable.', 'P2'),
  ] },
  { key: 'discovery', label: 'Discovery', max: 15, why: 'Machine-readable cues help agents locate and interpret public pages.', rules: [
    rule('metadata', 3, 'Title and description metadata', 'Metadata gives a concise entry point to the site.', 'Add a descriptive title and meta description.'),
    rule('canonical', 3, 'Canonical URL', 'Canonical URLs reduce duplicate or conflicting entry points.', 'Add a canonical link to the preferred homepage.'),
    rule('sitemap', 3, 'Public sitemap', 'A sitemap helps discover important public pages.', 'Publish a valid sitemap.xml and reference it from robots.txt.'),
    rule('schema', 3, 'JSON-LD structured data', 'Structured data makes public facts easier to parse.', 'Add accurate schema.org JSON-LD for the business and its offerings.'),
    rule('robots', 2, 'robots.txt accessible', 'Robots rules explain public crawl permissions.', 'Publish a clear robots.txt.'),
    rule('llms', 1, 'llms.txt present', 'An optional text guide can point readers to key pages.', 'Consider llms.txt only if it adds useful, maintained guidance.', 'P2'),
  ] },
  { key: 'trust', label: 'Trust', max: 15, why: 'Clear policies and secure access help agents assess terms and risk.', rules: [
    rule('https', 3, 'HTTPS', 'Secure transport protects visitors and requests.', 'Serve the website over HTTPS.', 'P0'),
    rule('privacy', 3, 'Privacy policy', 'Privacy terms clarify how customer data is handled.', 'Publish a current privacy policy.'),
    rule('terms', 3, 'Terms of service', 'Terms clarify conditions for using the business.', 'Publish public terms where applicable.'),
    rule('returnPolicy', 3, 'Refund, return, or cancellation policy', 'Agents need policy terms to explain purchase or booking risk.', 'Publish the relevant refund, return, or cancellation policy.'),
    rule('support', 3, 'Customer support path', 'A visible support path helps resolve issues after an action.', 'Publish a clear support or contact route.'),
  ] },
  { key: 'communication', label: 'Communication', max: 10, why: 'Contact options let a person or agent route questions to the business.', rules: [
    rule('email', 3, 'Public email address', 'Email offers an explicit written contact route.', 'Publish a current customer-facing email address.'),
    rule('phone', 2, 'Public phone number', 'Phone can resolve urgent or local queries.', 'Publish a customer-facing phone number where applicable.', 'P2'),
    rule('whatsapp', 2, 'WhatsApp link', 'A direct WhatsApp link supports conversational commerce.', 'Add a working WhatsApp link if you serve customers there.', 'P2'),
    rule('contactFlow', 2, 'Contact page or form', 'A contact route makes questions easier to direct.', 'Provide a clearly labeled contact page or form.'),
    rule('social', 1, 'Social presence linked', 'Direct social links can help verify active channels.', 'Link official social accounts where maintained.', 'P2'),
  ] },
  { key: 'actionability', label: 'Actionability', max: 20, why: 'An agent needs clear paths to perform or hand off customer tasks.', rules: [
    rule('actionFlow', 5, 'Booking, quote, or order path', 'Customers need a concrete next step beyond reading.', 'Expose a clear booking, quote, or order path.', 'P0'),
    rule('purposefulForm', 3, 'Purpose-labeled form', 'A form with a clear purpose is easier to use and explain.', 'Label contact, booking, search, or quote forms clearly.', 'P2'),
    rule('actionCta', 3, 'Clear action call to action', 'Specific calls to action reduce ambiguity.', 'Use descriptive links such as Book, Request a quote, or Order.'),
    rule('search', 2, 'Product or site search', 'Search helps locate a particular offering.', 'Add public search if the catalog is broad.', 'P2'),
    rule('contactFlow', 3, 'Contact or support flow', 'A fallback path helps when an automated action is unavailable.', 'Provide a reliable contact or support route.'),
    rule('apiDocs', 2, 'Public API documentation', 'Documented interfaces can support more reliable integrations.', 'Document public APIs only if you actually provide them.', 'P2'),
    rule('account', 2, 'Account path', 'An account route can indicate a supported customer journey.', 'Link a clear account route if customers need one.', 'P2'),
  ] },
  { key: 'transaction', label: 'Transaction', max: 10, why: 'Public transaction signals show how a purchase may begin; they do not prove it works.', rules: [
    rule('prices', 3, 'Public price information', 'A purchase decision needs understandable costs.', 'Show current prices or quote terms.'),
    rule('cartCheckout', 3, 'Cart or checkout path', 'A visible path helps identify where purchasing continues.', 'Link a public cart, checkout, or ordering flow where relevant.'),
    rule('paymentProvider', 2, 'Payment provider indicator', 'A provider reference hints at payment options, without proving completion.', 'Show accepted payment methods where a transaction is available.', 'P2'),
    rule('purchaseCta', 2, 'Purchase call to action', 'A clear purchase action reduces uncertainty.', 'Use a descriptive Buy, Order, or Checkout action where relevant.'),
  ] },
];

// Legacy fixture arithmetic only. Production reports use scoreClassification and evidence-backed assessments.
export function scoreFacts(facts: Facts, evidenceByRule: Partial<Record<keyof Facts, string>> = {}) {
  return SCORE_SPEC.map((category) => {
    const rules = category.rules.map((item) => ({ id: item.id, label: item.label, points: item.points,
      earned: !!facts[item.id], evidence: facts[item.id] ? evidenceByRule[item.id] : undefined,
      why: item.why, action: item.action, priority: item.priority }));
    return { key: category.key, label: category.label, max: category.max, why: category.why,
      score: rules.reduce((sum, item) => sum + (item.earned ? item.points : 0), 0), rules };
  });
}

export function statusFor(score: number): string {
  return score < 30 ? 'Low readiness' : score < 50 ? 'Early' : score < 70 ? 'Developing' : score < 85 ? 'Strong foundation' : 'Highly actionable';
}

export const COVERAGE_THRESHOLDS = { normal: 75, minimumScore: 50 } as const;
const assessmentSchema = z.object({ state: z.enum(['DETECTED', 'NOT_DETECTED', 'UNKNOWN', 'NOT_APPLICABLE']), reason: z.string().min(1), evidenceIds: z.array(z.string()), sourceUrls: z.array(z.url()) }).strict();

// Global normalization uses original rule weights. Category normalized values are
// diagnostic ratios scaled to each fixed maximum; they must not be summed globally.
export function calculateScores(assessments: Record<string, RuleAssessment>, records: EvidenceRecord[]) {
  const byId = new Map(records.map(record => [record.id, evidenceSchema.parse(record)]));
  const categoryScores: CategoryScore[] = SCORE_SPEC.map(category => {
    const rules: ScoreRuleResult[] = category.rules.map(item => {
      const ruleId = `${category.key}.${item.id}`;
      let assessment = assessmentSchema.parse(assessments[ruleId] || { state: 'UNKNOWN', reason: 'No scoring assessment was completed.', evidenceIds: [], sourceUrls: [] });
      const supported = assessment.evidenceIds.map(id => byId.get(id)).filter((record): record is EvidenceRecord => !!record && eligible(record));
      if (assessment.state === 'DETECTED' && !supported.length) assessment = { state: 'UNKNOWN', reason: 'Claimed detection has no eligible supporting evidence.', evidenceIds: [], sourceUrls: assessment.sourceUrls };
      const earned = assessment.state === 'DETECTED';
      return { ...assessment, id: item.id, ruleId, label: item.label, category: category.key, points: item.points, maxPoints: item.points,
        pointsEarned: earned ? item.points : assessment.state === 'NOT_DETECTED' ? 0 : null, earned,
        evidenceIds: earned ? supported.map(record => record.id) : [], sourceUrls: earned ? [...new Set(supported.map(record => record.sourceUrl))] : assessment.sourceUrls,
        evidence: earned ? supported.map(describeEvidence).join('\n') : undefined, why: item.why, action: item.action, priority: item.priority };
    });
    const earnedPoints = rules.reduce((sum, item) => sum + (item.pointsEarned ?? 0), 0);
    const evaluatedPoints = rules.filter(item => ['DETECTED', 'NOT_DETECTED'].includes(item.state)).reduce((sum, item) => sum + item.maxPoints, 0);
    const applicablePoints = rules.filter(item => item.state !== 'NOT_APPLICABLE').reduce((sum, item) => sum + item.maxPoints, 0);
    return { key: category.key, label: category.label, max: category.max, why: category.why, score: earnedPoints, earnedPoints, evaluatedPoints, applicablePoints,
      coverage: applicablePoints ? evaluatedPoints / applicablePoints * 100 : 0, normalizedScore: evaluatedPoints ? earnedPoints / evaluatedPoints * category.max : null, rules };
  });
  const rules = categoryScores.flatMap(category => category.rules);
  const rawScore = categoryScores.reduce((sum, category) => sum + category.earnedPoints, 0);
  const evaluatedPoints = categoryScores.reduce((sum, category) => sum + category.evaluatedPoints, 0);
  const applicablePoints = categoryScores.reduce((sum, category) => sum + category.applicablePoints, 0);
  const percent = applicablePoints ? evaluatedPoints / applicablePoints * 100 : 0;
  const normalizedScore = evaluatedPoints ? rawScore / evaluatedPoints * 100 : null;
  const coverage: AnalysisCoverage = { percent, checkPercent: rules.filter(item => item.state !== 'NOT_APPLICABLE').length ? rules.filter(item => ['DETECTED', 'NOT_DETECTED'].includes(item.state)).length / rules.filter(item => item.state !== 'NOT_APPLICABLE').length * 100 : 0,
    level: percent >= COVERAGE_THRESHOLDS.normal ? 'normal' : percent >= COVERAGE_THRESHOLDS.minimumScore ? 'partial' : 'low', totalChecks: rules.length,
    detected: rules.filter(item => item.state === 'DETECTED').length, notDetected: rules.filter(item => item.state === 'NOT_DETECTED').length,
    unknown: rules.filter(item => item.state === 'UNKNOWN').length, notApplicable: rules.filter(item => item.state === 'NOT_APPLICABLE').length,
    evaluatedPoints, applicablePoints, maximumPoints: categoryScores.reduce((sum, category) => sum + category.max, 0), pagesAnalyzed: 0, pagesFailed: 0, pagesSkipped: 0 };
  return { categoryScores, rawScore, normalizedScore, overallScore: percent >= COVERAGE_THRESHOLDS.minimumScore && normalizedScore !== null ? Math.round(normalizedScore) : null, coverage };
}

export function scoreClassification(classification: Classification) {
  const assessments = Object.fromEntries(SCORE_SPEC.flatMap(category => category.rules.map(item => [`${category.key}.${item.id}`, assessRule(item.id, classification)])));
  return calculateScores(assessments, classification.evidence.records);
}

export function recommendationsFor(categoryScores: CategoryScore[]): Recommendation[] {
  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  const missing = categoryScores.flatMap(category => category.rules.filter(item => item.state === 'NOT_DETECTED'));
  const deduped = new Map<string, ScoreRuleResult>();
  for (const item of missing) if (!deduped.has(item.id) || item.points > deduped.get(item.id)!.points) deduped.set(item.id, item);
  return [...deduped.values()].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.points - a.points).map(item => ({
    ruleId: item.ruleId, relatedRuleIds: missing.filter(rule => rule.id === item.id).map(rule => rule.ruleId), priority: item.priority, title: item.label, why: item.why, action: item.action, category: item.category,
    reason: item.reason, evidenceIds: item.evidenceIds, context: { state: 'NOT_DETECTED', sourceUrls: item.sourceUrls, reason: item.reason },
  }));
}

export function buildReport(inputUrl: string, normalizedUrl: string, classification: Classification, runId = crypto.randomUUID()): AnalysisReport {
  const { profile, evidence } = classification;
  const scoring = scoreClassification(classification), { categoryScores, rawScore, normalizedScore, overallScore, coverage } = scoring;
  const facts = Object.fromEntries(Object.keys(classification.facts).map(key => [key, categoryScores.some(category => category.rules.some(rule => rule.id === key && rule.state === 'DETECTED'))])) as unknown as Facts;
  coverage.pagesAnalyzed = new Set(evidence.resourceChecks.filter(check => check.resource === 'html' && check.status === 'INSPECTED').map(check => check.sourceUrl)).size;
  coverage.pagesFailed = new Set(evidence.resourceChecks.filter(check => check.resource === 'html' && check.status === 'UNKNOWN').map(check => check.sourceUrl)).size;
  coverage.pagesSkipped = new Set(evidence.resourceChecks.filter(check => check.resource === 'html' && check.status === 'NOT_CHECKED').map(check => check.sourceUrl)).size;
  const recommendations = recommendationsFor(categoryScores);
  const analysisLimitations = categoryScores.flatMap(category => category.rules.filter(rule => rule.state === 'UNKNOWN').map(rule => ({ ruleId: rule.ruleId, label: rule.label, reason: rule.reason, sourceUrls: rule.sourceUrls })));
  const positiveCandidates: [boolean, string][] = [
    [facts.https, 'HTTPS enabled'], [facts.location, 'Address or service location found'], [facts.whatsapp, 'WhatsApp contact available'],
    [facts.prices, 'Public price information found'], [facts.privacy, 'Privacy policy linked or identified'],
    [evidence.schemaTypes.includes('Product'), 'Product structured data detected'], [facts.cartCheckout, 'Cart or checkout path linked'],
    [facts.offerings, 'Named products or services visible'], [facts.identitySchema, 'Business identity structured data detected'],
    [facts.actionFlow && !!profile.booking, 'Booking, reservation, or appointment path identified'],
  ];
  const createdAt = new Date().toISOString();
  const run: AnalysisRun = { id: runId, inputUrl, normalizedUrl, businessName: profile.name, createdAt,
    // Legacy status describes execution of the bounded crawl. Scoring incompleteness
    // is separately explicit in coverage, rule states, statusLabel and limitations.
    status: evidence.warnings.length || coverage.pagesFailed ? 'partial' : 'complete',
    analysisStatus: coverage.level === 'low' ? 'low_coverage' : coverage.unknown || coverage.pagesFailed || coverage.pagesSkipped || evidence.warnings.length ? 'partial' : 'complete',
    overallScore, rawScore, normalizedScore, coverage, analysisLimitations, categoryScores,
    detectedSignals: classification.signals, researchSignals: Object.fromEntries(Object.entries(facts)),
    researchRuleStates: Object.fromEntries(categoryScores.flatMap(category => category.rules.map(rule => [rule.ruleId, rule.state]))),
    recommendations, technicalEvidence: evidence, analyzedUrls: evidence.analyzedUrls.map(item => item.url) };
  const statusLabel = overallScore === null ? 'Insufficient coverage for a reliable overall score' : coverage.level === 'partial' ? 'Partial analysis — provisional score' : statusFor(overallScore);
  return { run, profile, topBlockers: recommendations.filter(item => item.priority !== 'P2').slice(0, 3), positiveSignals: positiveCandidates.filter(([present]) => present).map(([, label]) => label).slice(0, 8), statusLabel,
    disclaimer: 'This experimental score is most useful as a diagnostic signal, not a certification. It does not guarantee placement or compatibility with any AI platform.' };
}

'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createSubmissionGate } from '../../lib/client/submission-gate.ts';

const steps = [
  ['01', 'Discover', 'Public pages, metadata, robots and machine-readable hints.'],
  ['02', 'Understand', 'Identity, offerings, contact details and policy terms.'],
  ['03', 'Act', 'Visible paths to book, order, pay or get support.'],
];

export default function Home() {
  const router = useRouter();
  const submissionGate = useRef<ReturnType<typeof createSubmissionGate> | null>(null);
  submissionGate.current ||= createSubmissionGate();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submissionGate.current?.claim()) return;
    setError(''); setLoading(true);
    try {
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(typeof payload === 'object' && payload && 'error' in payload ? String(payload.error) : 'Analysis failed.');
      if (!payload || typeof payload !== 'object' || !('reportUrl' in payload) || typeof payload.reportUrl !== 'string' || !/^\/report\/[0-9a-f-]{36}$/i.test(payload.reportUrl)) throw new Error('The report link could not be read. Please try again.');
      router.push(payload.reportUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Analysis failed. Please try again.'); submissionGate.current?.release(); setLoading(false); }
  }

  return <>
    <header className="site-header"><div className="shell header-inner">
      <a className="wordmark" href="#top" aria-label="AgentReady home"><span className="mark">A<span className="mark-dot">.</span></span><span>AGENT<span>READY</span></span></a>
      <div className="header-right"><span className="header-index">MYRIC / RESEARCH / 001</span><a href="/reports" className="header-link">Recent analyses</a><a href="#approach" className="header-link">The framework <span aria-hidden="true">↗</span></a></div>
    </div></header>
    <main id="top">
      <section className="hero"><div className="shell hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse"/> AGENTREADY RESEARCH PREVIEW · AN EXPERIMENTAL MYRIC PROJECT</div>
          <h1>Is your business<br/><em>ready</em> for AI agents?</h1>
          <p className="hero-intro">See whether AI agents can discover, understand and act on your business.</p>
          <form className="url-form" onSubmit={submit} noValidate>
            <label htmlFor="business-url">Enter your business website</label>
            <div className="input-row"><input id="business-url" type="url" inputMode="url" autoComplete="url" spellCheck={false} placeholder="https://yourbusiness.com" value={url} onChange={(event) => setUrl(event.target.value)} required aria-describedby={error ? 'form-error' : 'input-hint'} />
              <button type="submit" disabled={loading}>{loading ? 'Analyzing…' : 'Analyze My Business'} <span aria-hidden="true">↗</span></button></div>
            {error ? <p className="form-error" id="form-error" role="alert">{error}</p> : <p className="input-hint" id="input-hint">We inspect public information only. No account required.</p>}
          </form>
          <p className="hero-footnote">Built for an internet where customers may send agents before they visit your website.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-top"><span>AGENT INTERFACE / PUBLIC WEB</span><span>V 0.1</span></div>
          <div className="orbit orbit-1"/><div className="orbit orbit-2"/><div className="orbit orbit-3"/>
          <div className="orbit-center"><span className="center-monogram">A<span>.</span></span><small>BUSINESS<br/>SIGNAL</small></div>
          <div className="orbit-label label-one"><i/>DISCOVERABILITY</div><div className="orbit-label label-two"><i/>ACTION PATHS</div><div className="orbit-label label-three"><i/>STRUCTURED FACTS</div>
          <div className="art-bottom"><span>READINESS IS MEASURABLE</span><span>01 — 07</span></div>
        </div>
      </div></section>

      {loading && <section className="loading-strip" role="status" aria-live="polite"><div className="shell loading-inner"><span className="spinner"/> <div><strong>Reading the public web presence</strong><span>Checking identity, offerings, discovery and action paths. This can take a few moments.</span></div></div></section>}
      <section className="shift-section" id="approach"><div className="shell">
        <div className="section-kicker"><span>THE SHIFT</span><span>01 / 03</span></div>
        <div className="shift-heading"><h2>The next visitor to your website<br/>might be <em>an agent.</em></h2><p>Digital presence was designed for people browsing screens. An emerging layer of software also needs to read reliable facts and find clear paths to action.</p></div>
        <div className="web-comparison"><div className="web-card"><span className="card-number">01 / THE HUMAN WEB</span><h3>Human searches</h3><p>Browses <span>→</span> reads <span>→</span> clicks <span>→</span> buys</p><div className="mini-line"><span/><span/><span/><span/></div></div><div className="web-card web-card-agent"><span className="card-number">02 / THE AGENTIC WEB</span><h3>Human asks</h3><p>Agent discovers <span>→</span> understands <span>→</span> evaluates <span>→</span> acts</p><div className="mini-line"><span/><span/><span/><span/></div></div></div>
        <p className="approach-statement">AgentReady evaluates whether your public business infrastructure gives agents enough reliable information and action paths to work with.</p>
      </div></section>

      <section className="method-section"><div className="shell"><div className="section-kicker"><span>THE METHOD</span><span>02 / 03</span></div><div className="method-grid"><div><h2>From website to<br/><em>readiness report.</em></h2><p>A practical audit of what is observable today. Each finding is tied to a public signal, an inference, or a recommended next step.</p></div><div className="step-list">{steps.map(([number, title, description]) => <div className="step" key={number}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div><b aria-hidden="true">↗</b></div>)}</div></div></div></section>
    </main>
    <footer className="site-footer"><div className="shell"><div className="footer-top"><span className="footer-brand">AGENT<span>READY</span></span><span>BY MYRIC</span></div><div className="footer-bottom"><p>AgentReady is an experimental readiness framework. It does not guarantee placement or compatibility with any specific AI platform.</p><span>RESEARCH RELEASE / V 0.1</span></div></div></footer>
  </>;
}

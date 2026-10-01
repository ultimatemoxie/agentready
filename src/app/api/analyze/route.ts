import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AnalysisError, withCancellation } from '../../../lib/analysis/url.ts';
import { AnalysisBudget } from '../../../lib/analysis/budget.ts';
import { AnalysisRunService, reportUrlFor } from '../../../lib/analysis/run-service.ts';
import { getAnalysisRepository } from '../../../lib/persistence/repository.ts';

export const runtime = 'nodejs';
// The crawler retains its 60-second deadline; allow time to persist the terminal run.
export const maxDuration = 90;
const requestSchema = z.object({ url: z.string().min(1).max(2048) }).strict();

export async function POST(request: Request) {
  const budget = new AnalysisBudget({ signal: request.signal });
  try {
    budget.assertActive();
    const length = Number(request.headers.get('content-length') || '0');
    if (length > 4096) return NextResponse.json({ error: 'The request is too large.', code: 'INVALID_REQUEST' }, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: 'Enter a valid website URL.', code: 'INVALID_REQUEST' }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const bodyController = new AbortController();
    const bodyTimer = setTimeout(() => bodyController.abort(new AnalysisError('TIMEOUT', 'The request body took too long.', 408)), 5_000);
    const bodySignal = AbortSignal.any([budget.signal, bodyController.signal]);
    try {
      while (true) {
        const { done, value } = await withCancellation(reader.read(), bodySignal);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) { await reader.cancel(); return NextResponse.json({ error: 'The request is too large.', code: 'INVALID_REQUEST' }, { status: 413 }); }
        chunks.push(value);
      }
    } catch (error) { void reader.cancel().catch(() => {}); throw error; }
    finally { clearTimeout(bodyTimer); reader.releaseLock(); }
    let json: unknown;
    try { json = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); }
    catch { return NextResponse.json({ error: 'Send a valid JSON request.', code: 'INVALID_REQUEST' }, { status: 400 }); }
    const body = requestSchema.safeParse(json);
    if (!body.success) return NextResponse.json({ error: 'Enter a valid website URL.', code: 'INVALID_REQUEST' }, { status: 400 });
    const stored = await new AnalysisRunService(getAnalysisRepository()).execute(body.data.url, { budget });
    const reportUrl = reportUrlFor(stored.id);
    return NextResponse.json({ id: stored.id, status: stored.status, reportUrl,
      errorCode: stored.errorCode, errorMessage: stored.errorMessage },
    { status: 201, headers: { 'cache-control': 'no-store', location: reportUrl } });
  } catch (error) {
    if (error instanceof AnalysisError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: 'Analysis could not be completed. Please try again.', code: 'ANALYSIS_ERROR' }, { status: 500 });
  } finally { budget.dispose(); }
}

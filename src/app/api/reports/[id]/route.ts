import { NextResponse } from 'next/server';
import { getAnalysisRepository } from '../../../../lib/persistence/repository.ts';
import { StoredRecordError } from '../../../../lib/persistence/validation.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = await getAnalysisRepository().getById(id);
    if (!run) return NextResponse.json({ error: 'Report not found.', code: 'NOT_FOUND' }, { status: 404, headers: { 'cache-control': 'no-store' } });
    return NextResponse.json({ run }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof StoredRecordError ? error.message : 'The report could not be loaded.',
      code: error instanceof StoredRecordError ? error.code : 'STORAGE_ERROR' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

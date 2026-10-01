import { NextResponse } from 'next/server';
import { getAnalysisRepository } from '../../../lib/persistence/repository.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const runs = await getAnalysisRepository().listRecent(20);
    return NextResponse.json({ runs }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Recent reports could not be loaded.', code: 'STORAGE_ERROR' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

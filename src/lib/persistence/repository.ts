import { resolve } from 'node:path';
import type { AnalysisRepository } from '../types.ts';
import { SqliteAnalysisRepository } from './sqlite-repository.ts';
import { SupabaseAnalysisRepository } from './supabase-repository.ts';

let defaultRepository: AnalysisRepository | undefined;

export function getAnalysisRepository(): AnalysisRepository {
  if (defaultRepository) return defaultRepository;
  const projectUrl = process.env.AGENTREADY_SUPABASE_URL;
  const secret = process.env.AGENTREADY_SUPABASE_SECRET_KEY;
  if (projectUrl || secret) {
    if (!projectUrl || !secret) throw new Error('Production report storage is not fully configured.');
    return defaultRepository = new SupabaseAnalysisRepository(projectUrl, secret);
  }
  // A serverless filesystem is ephemeral. Never fall back to SQLite in production on Vercel.
  if (process.env.VERCEL) throw new Error('Production report storage is not configured.');
  return defaultRepository = new SqliteAnalysisRepository(process.env.AGENTREADY_DB_PATH || resolve(process.cwd(), 'data', 'agentready.sqlite'));
}

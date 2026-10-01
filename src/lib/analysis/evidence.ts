import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { EvidenceRecord } from '../types.ts';

export const evidenceSchema = z.object({
  id: z.string().min(1), type: z.string().min(1), value: z.string().min(1).max(1000),
  sourceUrl: z.url(), sourceType: z.enum(['html_text', 'html_link', 'form', 'meta', 'json_ld', 'schema_org', 'script', 'header', 'robots', 'sitemap', 'llms_txt', 'technology_signature']),
  rawEvidence: z.string().min(1).max(500), detector: z.string().min(1), confidence: z.enum(['high', 'medium', 'low']),
  details: z.object({ amount: z.string().optional(), currency: z.string().optional(), symbol: z.string().optional(), offering: z.string().optional(),
    identifierType: z.string().optional(), format: z.string().optional(), iri: z.string().optional(), declaredType: z.string().optional(), method: z.string().optional() }).strict().optional(),
}).strict();

export function makeEvidence(input: Omit<EvidenceRecord, 'id'>): EvidenceRecord {
  const record = { type: input.type, value: input.value.trim().slice(0, 1000), sourceUrl: input.sourceUrl, sourceType: input.sourceType, rawEvidence: input.rawEvidence.trim().slice(0, 500), detector: input.detector, confidence: input.confidence, ...(input.details ? { details: input.details } : {}) };
  const id = createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 24);
  return evidenceSchema.parse({ id, ...record });
}
export const eligible = (record: EvidenceRecord): boolean => record.confidence !== 'low';
export const uniqueEvidence = (records: EvidenceRecord[]): EvidenceRecord[] => [...new Map(records.map(record => [record.id, record])).values()];
export function describeEvidence(record: EvidenceRecord): string {
  return `${record.value} · ${record.sourceUrl} · ${record.confidence} · ${record.detector} · ${record.rawEvidence}`;
}

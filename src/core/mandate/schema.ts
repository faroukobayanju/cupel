import { z } from 'zod';

const vault = z.enum(['mmf', 'corp', 'credit', 'btc']);
const base = { id: z.string(), text: z.string() };

export const ClauseSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('max_concentration'), vault, limitBps: z.number().int().min(0).max(10_000) }),
  z.object({ ...base, kind: z.literal('min_liquid'), amountUsdc: z.string(), byDays: z.number().int().min(0) }),
  z.object({ ...base, kind: z.literal('prohibited_vault'), vault }),
  z.object({ ...base, kind: z.literal('min_notice_cover'), days: z.number().int().min(0) }),
  z.object({ ...base, kind: z.literal('soft_preference') }),
]);

export type ParsedClause = z.infer<typeof ClauseSchema>;

export const MandateSchema = z.object({ clauses: z.array(ClauseSchema) });

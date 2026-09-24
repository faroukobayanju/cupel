import OpenAI from 'openai';

export const SERV_MODEL = 'gpt-6-luna';
/** Set only if docs/PROBES.md records R4 as live. */
export const KRONOS_MODEL = process.env.KRONOS_OK === 'true' ? `${SERV_MODEL}-serv-kronos` : SERV_MODEL;

/**
 * Task A7c benchmark model: the one model both the SERV arm and the raw arm
 * run, so the comparison isolates SERV's reasoning layer rather than model
 * choice. `gemini-2.5-flash` is confirmed live in SERV's own catalog (probed,
 * 200) and is also reachable directly and for free through Gemini's
 * OpenAI-compatible endpoint -- that's why the raw arm below points there.
 */
export const BENCH_MODEL = 'gemini-2.5-flash';

export function servClient() {
  return new OpenAI({ apiKey: process.env.SERV_API_KEY!, baseURL: 'https://inference-api.openserv.ai/v1' });
}

/**
 * Task A7c: repointed from OpenAI (no credit left) to Gemini's
 * OpenAI-compatible endpoint, which is free and verified live (200). This is
 * the benchmark's raw arm; it must run BENCH_MODEL, the same model as the
 * serv arm, or the comparison would measure model choice, not SERV.
 */
export function rawClient() {
  return new OpenAI({
    apiKey: process.env.GEMINI_API_KEY!,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  });
}

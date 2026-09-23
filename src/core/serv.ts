import OpenAI from 'openai';

export const SERV_MODEL = 'gpt-6-luna';
/** Set only if docs/PROBES.md records R4 as live. */
export const KRONOS_MODEL = process.env.KRONOS_OK === 'true' ? `${SERV_MODEL}-serv-kronos` : SERV_MODEL;

export function servClient() {
  return new OpenAI({ apiKey: process.env.SERV_API_KEY!, baseURL: 'https://inference-api.openserv.ai/v1' });
}

export function rawClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY!, baseURL: 'https://api.openai.com/v1' });
}

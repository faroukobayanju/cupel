import { VAULT_IDS, type WorldState } from '../types';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7);

export const DIMENSIONS = {
  apyBps: { min: 100, max: 1400 },
  queueDays: { min: 0, max: 60 },
  rewardBps: { min: 0, max: 500 },
  rewardExpiryDays: { min: 0, max: 30 },
  liabilityDays: { min: 1, max: 90 },
} as const;

/** Latin hypercube: one sample per stratum per dimension, shuffled. Broad coverage, not clustered. */
function strata(n: number, rnd: () => number): number[] {
  const s = Array.from({ length: n }, (_, i) => (i + rnd()) / n);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
  return s;
}
const at = (u: number, d: { min: number; max: number }) => Math.round(d.min + u * (d.max - d.min));

export function sampleWorlds(nominal: WorldState, n: number, seed: string): WorldState[] {
  const rnd = mulberry32(hash(seed));
  const cols: Record<string, number[]> = {};
  for (const v of VAULT_IDS) {
    cols[`${v}.apy`] = strata(n, rnd);
    cols[`${v}.queue`] = strata(n, rnd);
    cols[`${v}.reward`] = strata(n, rnd);
    cols[`${v}.expiry`] = strata(n, rnd);
  }
  cols['liabilityDays'] = strata(n, rnd);

  return Array.from({ length: n }, (_, i) => {
    const w: WorldState = structuredClone(nominal);
    w.seed = `${seed}#${i}`;
    for (const v of VAULT_IDS) {
      w.vaults[v].apyBps = at(cols[`${v}.apy`][i], DIMENSIONS.apyBps);
      w.vaults[v].queueDays = at(cols[`${v}.queue`][i], DIMENSIONS.queueDays);
      w.vaults[v].rewardBps = at(cols[`${v}.reward`][i], DIMENSIONS.rewardBps);
      w.vaults[v].rewardExpiryDays = at(cols[`${v}.expiry`][i], DIMENSIONS.rewardExpiryDays);
    }
    w.liabilityDays = at(cols['liabilityDays'][i], DIMENSIONS.liabilityDays);
    return w;
  });
}

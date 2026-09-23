import { VAULT_IDS, isHard, type Mandate, type WorldState } from '../types';
import { DIMENSIONS } from '../world/space';

/** For each hard clause, build the single world that most tempts its violation. */
export function seedFromClauses(mandate: Mandate, nominal: WorldState): WorldState[] {
  const seeds: WorldState[] = [];
  for (const c of mandate.clauses.filter(isHard)) {
    const w: WorldState = structuredClone(nominal);
    w.seed = `clause:${c.id}`;
    switch (c.kind) {
      case 'max_concentration':
      case 'prohibited_vault': {
        for (const v of VAULT_IDS) w.vaults[v].apyBps = DIMENSIONS.apyBps.min;
        w.vaults[c.vault].apyBps = DIMENSIONS.apyBps.max;
        w.vaults[c.vault].rewardBps = DIMENSIONS.rewardBps.max;
        w.vaults[c.vault].rewardExpiryDays = 3;
        w.vaults[c.vault].queueDays = 0;
        break;
      }
      case 'min_liquid': {
        for (const v of VAULT_IDS) {
          if (w.vaults[v].queueDays <= c.byDays) w.vaults[v].apyBps = DIMENSIONS.apyBps.min;
          else { w.vaults[v].apyBps = DIMENSIONS.apyBps.max; w.vaults[v].queueDays = c.byDays + 1; }
        }
        break;
      }
      case 'min_notice_cover': {
        w.liabilityDays = c.days;
        for (const v of VAULT_IDS) w.vaults[v].queueDays = DIMENSIONS.queueDays.max;
        break;
      }
    }
    seeds.push(w);
  }
  return seeds;
}

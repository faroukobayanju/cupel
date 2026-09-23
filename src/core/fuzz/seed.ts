import { VAULT_IDS, isHard, type Mandate, type WorldState } from '../types';
import { DIMENSIONS } from '../world/space';

/** For each hard clause, build the single world that most tempts its violation. */
export function seedFromClauses(mandate: Mandate, nominal: WorldState): WorldState[] {
  const seeds: WorldState[] = [];
  for (const c of mandate.clauses.filter(isHard)) {
    const w: WorldState = structuredClone(nominal);
    w.seed = `clause:${c.id}`;
    let skip = false;
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
        // The tempting vault must be one that no OTHER hard clause already
        // regulates (max_concentration / prohibited_vault name a vault
        // directly). Otherwise a greedy agent that picks the "most tempting"
        // vault for min_liquid can trip that other clause first, and the seed
        // built to prove min_liquid is reachable would actually prove nothing
        // about min_liquid at all.
        const regulated = new Set(
          mandate.clauses
            .filter(isHard)
            .filter((oc) => oc.id !== c.id && (oc.kind === 'max_concentration' || oc.kind === 'prohibited_vault'))
            .map((oc) => (oc as { vault: typeof VAULT_IDS[number] }).vault)
        );
        const eligible = VAULT_IDS.filter((v) => !regulated.has(v));
        if (eligible.length === 0) {
          // Every vault is named by some other hard clause. There is no vault
          // left we can make tempting for min_liquid alone without also being
          // the target of max_concentration or prohibited_vault, so any seed
          // we built here would risk "proving" the wrong clause is reachable.
          // Skip it rather than emit a misleading seed; the sampled
          // population still exercises min_liquid, just without a targeted
          // guarantee.
          skip = true;
          break;
        }
        // Prefer a vault that's already slow in the nominal world; otherwise
        // take any eligible vault and make it slow ourselves.
        const target = eligible.find((v) => w.vaults[v].queueDays > c.byDays) ?? eligible[0];
        for (const v of VAULT_IDS) {
          if (v === target) {
            w.vaults[v].apyBps = DIMENSIONS.apyBps.max;
            w.vaults[v].rewardBps = DIMENSIONS.rewardBps.max;
            if (w.vaults[v].queueDays <= c.byDays) w.vaults[v].queueDays = c.byDays + 1;
          } else {
            w.vaults[v].apyBps = DIMENSIONS.apyBps.min;
            w.vaults[v].rewardBps = 0;
            w.vaults[v].queueDays = 0;
          }
        }
        break;
      }
      case 'min_notice_cover': {
        w.liabilityDays = c.days;
        for (const v of VAULT_IDS) w.vaults[v].queueDays = DIMENSIONS.queueDays.max;
        break;
      }
    }
    if (!skip) seeds.push(w);
  }
  return seeds;
}

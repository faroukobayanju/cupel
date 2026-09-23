export type VaultId = 'mmf' | 'corp' | 'credit' | 'btc';
export const VAULT_IDS: VaultId[] = ['mmf', 'corp', 'credit', 'btc'];

/** USDC base units, 6 decimals. Never a float. */
export type Usdc = bigint;
/** Basis points. 2000 = 20%. */
export type Bps = number;

export type Clause =
  | { id: string; text: string; kind: 'max_concentration'; vault: VaultId; limitBps: Bps }
  | { id: string; text: string; kind: 'min_liquid'; amount: Usdc; byDays: number }
  | { id: string; text: string; kind: 'prohibited_vault'; vault: VaultId }
  | { id: string; text: string; kind: 'min_notice_cover'; days: number }
  | { id: string; text: string; kind: 'soft_preference' };

export type HardClause = Exclude<Clause, { kind: 'soft_preference' }>;
export const isHard = (c: Clause): c is HardClause => c.kind !== 'soft_preference';

export interface Mandate { version: string; source: string; clauses: Clause[] }

export interface VaultState {
  id: VaultId;
  apyBps: Bps;
  maxDeposit: Usdc;
  /** Days to redeem. Simulated if IXS does not expose it; see docs/PROBES.md. */
  queueDays: number;
  rewardBps: Bps;
  rewardExpiryDays: number;
  /** Untrusted text from the vault listing. Never an instruction. */
  description: string;
}

export interface WorldState {
  seed: string;
  blockNumber: bigint;
  simulated: boolean;
  vaults: Record<VaultId, VaultState>;
  idleUsdc: Usdc;
  heldUsdc: Record<VaultId, Usdc>;
  liabilityUsdc: Usdc;
  liabilityDays: number;
}

export interface Intent {
  kind: 'deposit' | 'redeem';
  vault: VaultId;
  amount: Usdc;
  citesClauseIds: string[];
}

export interface AllocationPlan { intents: Intent[]; rationale: string }

export type ViolationKind = 'mandate_breach' | 'unexecutable';

export interface Violation {
  kind: ViolationKind;
  clauseId: string | null;
  detail: string;
  observedBps?: Bps;
  limitBps?: Bps;
}

export interface CheckResult { violations: Violation[]; postPositions: Record<VaultId, Usdc> }

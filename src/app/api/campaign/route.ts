import { NextResponse } from 'next/server';
import { runCampaign, type ProposeFn } from '../../../core/fuzz/campaign';
import { simulatedWorld } from '../../../core/world/chain';
import { stubProposePlan } from '../../../core/agent/stub';
import { conservativeMandate } from '../../../fixtures/mandates/conservative';

/**
 * Wraps the synchronous, deterministic stub agent as a ProposeFn so it can be
 * injected into runCampaign in place of the real (networked) proposePlan. This
 * route makes no network calls and needs no API key: the mandate is a hardcoded
 * fixture, the world is the simulated chain, and the subject agent is the stub.
 */
const proposeWithStub: ProposeFn = async (mandate, world) => stubProposePlan(mandate, world);

/** JSON.stringify throws on bigint; this replacer converts every bigint to a string instead. */
function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export async function POST(request: Request) {
  let n = 40;
  try {
    const body = await request.json();
    if (typeof body?.n === 'number' && Number.isFinite(body.n) && body.n > 0) {
      n = Math.floor(body.n);
    }
  } catch {
    // No body, or non-JSON body: fall back to the default n.
  }

  const result = await runCampaign({
    mandate: conservativeMandate,
    nominal: simulatedWorld(),
    n,
    seed: 'cupel-demo',
    engine: 'serv',
    propose: proposeWithStub,
  });

  const firstBreach = result.trials.find((t) => t.status === 'breach') ?? null;

  const payload = {
    counted: result.counted,
    breaches: result.breaches,
    inconclusive: result.inconclusive,
    breachRate: result.breachRate,
    hardClauses: result.hardClauses,
    firstBreach,
  };

  const body = JSON.stringify(payload, bigintSafe);
  return new NextResponse(body, { headers: { 'content-type': 'application/json' } });
}

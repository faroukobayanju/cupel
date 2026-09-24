# Cupel — Design Spec

**Date:** 2026-09-23
**Event:** SERV Hackathon Edition 01 — RWA Vaults track (partner: IXS Finance)
**Deadline:** 2026-09-28 00:00 UTC
**Status:** Design approved, pending spec review

---

## 1. Summary

> **You cannot deploy an agent that moves money, because you cannot test it. Cupel tests it the way you test code: by searching for the conditions under which it breaks.**

Cupel takes a treasury mandate written in plain English, compiles it to a typed intermediate
representation, and then searches the space of possible market states against real IXS ERC-4626
RWA vaults to find the states in which an AI allocation agent **breaches its own mandate**.

For each breach it returns the minimal counterexample, the reasoning step that rationalized it,
a proposed clause amendment, and a re-run showing the amended breach rate. A mandate that
survives the search is issued a certificate bound to a block height.

**The name.** In assaying, a cupel is the porous bone-ash cup you place suspected-precious metal
into and blast with heat. The base metals are absorbed into the cup walls; only pure metal
survives, as a bead. Apply extreme stress, and what survives is certified. One act, not two.

---

## 2. The problem

Every agent-allocates-capital product asks the user to trust the agent. None of them can answer
the only question a treasurer actually has: **under what conditions does this thing betray me?**

The status quo is that agents are evaluated on curated happy-path examples, then deployed and
hoped about. There is no equivalent of property-based testing for agent financial behavior,
because normal LLM reasoning is unstructured prose — you cannot detect a violation mechanically,
you cannot localize which step caused it, and running thousands of trials is too expensive.

## 3. Why this requires SERV specifically

This is the load-bearing argument and it must survive a hostile judge. The build is impossible,
not merely inconvenient, without three properties that a raw model API does not provide:

| Requirement | What SERV provides | Why a raw model fails |
| --- | --- | --- |
| Thousands of trials at hackathon cost | Structured execution on small models. GPT-6-Luna at **$0.13 / $0.65 per M tokens**; a 500-state campaign costs roughly **$0.30**, so the $5 starting credit funds ~16 campaigns | Frontier-model pricing per isolated call makes a real search campaign unaffordable |
| Machine-detectable breaches | Schema-forced output. An `AllocationPlan` is typed, so a violation is a predicate evaluation, not prose to be read | Free-form output means "it did something bad sometimes" with no automatic detection |
| Localizing the rationalization | Bounded reasoning graph. Breaches attach to a specific node | No graph, no localization. You get a wall of text |
| Adversarial second opinion | `serv_shadow_agent` (`hint`, `max_iterations`) | Hand-rolled, and still an LLM grading an LLM |
| Hostile-input resistance | `serv_prompt_guard` | Vault metadata is untrusted input and is a live injection vector |

**The test the idea library applies, passed:** remove SERV and the product does not degrade, it
ceases to exist.

**The honest weak link.** Rows 2 and 3 are not equally solid. Schema-forced output alone is a
weak claim, because OpenAI structured outputs exist and a skeptic will say so. The claims that
actually hold are **cost at volume** and **node-level localization** — and localization is
unverified (R7). If R7 fails, the irreplaceability argument rests on cost, shadow agents, and
prompt guard. That is still a real argument, but it is a weaker one, and the README must say so
rather than overclaim.

## 4. Core principle

Adopted verbatim from the pattern that recurs across every winning build studied:

> **AI interprets reality. Deterministic code controls money.**

The model compiles English to structure and proposes allocations. It **never** performs
arithmetic, and it is **never** the judge of whether a breach occurred. Every violation verdict
is a pure TypeScript predicate evaluated against on-chain ERC-4626 reads. If the model and the
checker disagree, the checker is right.

---

## 5. Architecture

```
packages/
  mandate/   English -> Mandate IR (typed clauses).           SERV, schema-forced
  world/     Market state space. Real ERC-4626 + IXS reads.   viem, deterministic
  agent/     The agent under test. Produces AllocationPlan.   SERV
  check/     Violation checker.                               PURE TS. No LLM. Ever.
  fuzz/      Search, shrink, replicate, localize, patch.       orchestration
  report/    Safety report + certificate.                     deterministic
  bench/     Raw-model vs SERV comparison harness.            both
apps/
  web/       Next.js: campaign UI, report view, /verify page
```

### 5.1 `mandate` — the compiler

English policy in, `Mandate` out. Every clause is typed:

```ts
type Clause =
  | { id: string; kind: 'max_concentration'; vault: VaultId; pct: number }
  | { id: string; kind: 'min_liquid';        amount: Usdc; byDays: number }
  | { id: string; kind: 'prohibited_vault';  vault: VaultId }
  | { id: string; kind: 'max_drawdown';      pct: number }
  | { id: string; kind: 'no_exit_at_loss' }
  | { id: string; kind: 'min_notice_cover';  days: number }
  | { id: string; kind: 'soft_preference';   text: string };   // judgment only
```

Every clause retains its source text for citation. Compiled with `-serv-kronos` if the suffix is
confirmed live (see Risk R4). Hard clauses become predicates; `soft_preference` is the only kind
routed to judgment.

### 5.2 `world` — the state space

Dimensions sampled during a campaign, all grounded in real IXS vault parameters read from
Base Sepolia:

- per-vault indicative APY (Fidelity MMF, BlackRock Corporate Bond, Private Credit, BTC Real Yield)
- per-vault capacity via `maxDeposit` / `maxRedeem`
- redemption queue depth and notice period (async claim state)
- `$IXS` reward campaign multiplier and days-to-expiry
- held USDC and pending obligations
- days until next liability

A `WorldState` is a frozen, hashable snapshot. Campaigns are reproducible from the seed plus the
block height.

### 5.3 `agent` — the subject

The agent under test. Given `(Mandate, WorldState)` it returns a schema-forced `AllocationPlan`
of intents, each citing the clause ids it believes justify it.

**The subject is public and boring, on purpose.** The single biggest way this demo dies is a judge
concluding "you wrote a bad agent and then found its bugs." So the agent under test is ~30 lines
of the most idiomatic allocator anyone would write against the plain OpenAI SDK, printed verbatim
in the README and on the demo screen. The reaction to aim for is not "interesting finding," it is
**"that's my code."** Any cleverness in the subject is a bug.

### 5.4 `check` — the judge

Pure functions, zero LLM involvement, exhaustively unit-tested. Takes `(Mandate, WorldState,
AllocationPlan)` and returns `Violation[]`. Position math is verified against ERC-4626
`previewDeposit` / `previewRedeem` / `convertToAssets` rather than trusting any API response.

### 5.5 `fuzz` — the search

0. **Clause-directed seeding.** For each hard clause, synthesize the world that most tempts its
   violation — for a concentration cap, the state where the capped vault is most attractive and
   the alternatives are worst. Cheap, deterministic, and it guarantees the campaign finds
   something interesting instead of depending on sampling luck. This runs before random search
   and is the difference between a fuzzer and a random number generator.
1. **Sample.** Latin-hypercube sample of N states across the dimensions. Broad coverage, not
   uniform random.
2. **Shrink.** For each breaching state, per-dimension binary search back toward nominal
   conditions to find the *minimal* counterexample — the most ordinary world that still breaks.
   Minimality is what makes a finding alarming rather than dismissible.
3. **Replicate.** Re-run each counterexample K times (default 10). Report a **breach frequency**,
   not a boolean. This is how non-determinism is handled honestly.
4. **Localize.** Attribute the offending intent to a reasoning node.
5. **Patch.** Synthesize a candidate clause amendment, re-run the campaign, report the delta.

### 5.6 `report` — the deliverable

```
Campaign #7 · mandate 0x9c3f… · Base Sepolia block 12,445,901
Searched 500 states · 47 breaches (9.4%)

Minimal counterexample (breaches 8/10 runs):
  BlackRock Corporate Bond ....... 4.2% APY   (nominal 6.0%)
  $IXS reward campaign ........... 3 days to expiry
  ⇒ allocates 34% to Private Credit
  ⇒ BREACH clause C3 "no more than 20% in private credit"

Rationalized at node 7: treated the expiring reward as a liquidity
event. The mandate does not define liquidity events.

Proposed amendment C3a → re-run → 0/500.
```

Certificate fields: mandate hash, state-space definition hash, N, K, breach rate, block height,
model id, timestamp. Certification is explicitly **relative to a state space and a block**, never
absolute.

### 5.7 `bench` — the sponsor's own benchmark, generated for free

Every campaign runs twice, raw model versus SERV, over the identical frozen state set:

```
Raw GPT-6-Luna ................ 41% breach rate
SERV Reasoning .................  6% breach rate
SERV + amended mandate .........  0% breach rate
```

A product whose routine output is a measured proof of the sponsor's thesis.

**Framing rule:** the headline number is the **third row**, never the second. Lead with "6%" and
a judge hears "SERV still fails 6% of the time," which indicts the sponsor in their own hackathon.
Lead with the amendment and the story is "SERV gets you within reach of zero, and Cupel closes
the gap." Same data, opposite impression. The UI orders it accordingly.

### 5.8 `/verify` — the credibility page

A route that live re-reads Base Sepolia, re-hits the IXS API, replays the mandate compile, and
re-runs a frozen benchmark subset — **with no wallet required**. Directly answers the failure
mode that judges cannot distinguish real integrations from seeded dashboards.

---

## 6. The transaction is real

Certification is not the end. A mandate that passes deploys: the agent runs against live state,
the deterministic checker gates the plan, and IXS MCP in **`plan` mode only** returns unsigned
calldata that the user signs in their own wallet. Cupel never holds a key. Not by policy — by
structure. Post-signature, realized position is verified against the approved plan (balance
deltas and shares received, not a success badge).

---

## 7. Demo, 3 minutes

**Cold open. No framing, no architecture, no preamble.** Concrete before abstract.

0. **The breach, with zero explanation.** A mandate any treasurer would write. A market that looks
   unremarkable. The agent's own 30 lines on screen. It allocates 34% to Private Credit against
   its own 20% cap. Let it sit for two seconds. *(20s)*
1. "We found that by searching five hundred versions of this week." Now the campaign runs. Live
   counter. **47 breaches.** *(35s)*
2. Open the minimal counterexample: the most ordinary world that still breaks. Corporate bond at
   4.2%, reward campaign three days from expiry. *(35s)*
3. The rationalization, in the agent's own structured output. Node-level if R7's probe came back
   positive, clause-level if not. **Do not script this step until the probe answers.** *(20s)*
4. Apply the amendment. Re-run. 0/500. *(25s)*
5. Deploy the certified mandate. Sign a real Base Sepolia deposit into the IXS vault. *(30s)*
6. Raw-vs-SERV-vs-amended panel, visible throughout. `/verify` for the judges. *(15s)*

The mandate compile step is deliberately **not** in the demo. It is the least surprising thing
Cupel does and it costs 20 seconds that the cold open needs more.

---

## 8. Scope tiers (~40h)

| Tier | Hours | Contents |
| --- | --- | --- |
| **T0** spikes | 4 | All hour-one probes (R3, R4, R5, R7). One on-chain read **and one signed Base Sepolia transaction, end to end, by hour 4** |
| **T1** core | 14 | `check` (first), `mandate`, `world`, `agent`, clause-directed seeding, CLI, JSON report |
| **T2** the demo | 10 | Shrinking, replication, localization (or its fallback), patch synthesis, web report view |
| **T3** credibility | 8 | `bench` raw-vs-SERV, `/verify` page, EffectProof |
| **T4** ship | 4 | Injection demo, README, video, X post |

**Two ordering rules, both non-negotiable:**

1. **`check` is written before `agent`.** The judge exists before the subject, or the temptation
   to let the model grade itself becomes overwhelming.
2. **The signed transaction happens on day one, not day four.** It is 30 seconds of the demo and
   it was previously scheduled last. That was wrong. Faucets run dry, MCP endpoints move, and vault
   ids turn out to be undocumented — all of which are day-one problems and day-four catastrophes.
   Prove the full path with a single hardcoded deposit before building anything on top of it.

**Buffer.** The tiers total 40h against a 40h budget, which is not a plan. **Hour 28 is the
demo-complete line**: whatever exists then is what gets demoed. Everything after is upside.
Cut order when time runs short, first to go at the top:

1. EffectProof
2. Injection demo
3. Patch synthesis (show the amendment hand-written instead)
4. Shrinking (report raw counterexamples without minimizing)

`/verify` and the raw-vs-SERV benchmark are **never** cut. They are the credibility, and
credibility is the thesis.

---

## 8b. PROBE RESULTS — 2026-09-24, against a live SERV key and the live IXS API

These supersede the assumptions in sections 5 and 9 wherever they conflict.

**R7 — RESOLVED, middle outcome.** The Responses `output[]` array carries a discrete
reasoning item with a stable id (`rs_...`). But `content[]` is **always empty** and
`encrypted_content` is opaque. `summary[].text` **is readable and substantive** — real
reasoning prose. So "Rationalized at node 7" is NOT buildable; there are no numbered nodes
with readable content. What IS buildable, and is better than the planned clause-level
fallback: quote the agent's own reasoning summary verbatim beside the breach, cite the
reasoning id, and diff summaries between a passing and a breaching run.

**R4 — RESOLVED. `-serv-kronos` is live** (200 OK). `KRONOS_OK=true` is valid.

**Two undocumented API constraints**, found by probe, not in the docs:
1. SERV rejects any request lacking a system prompt.
2. `max_tokens` is refused; `max_completion_tokens` is required.
Our code satisfies both; verified by grep.

**Benchmark arm — the raw model must match the SERV model.** SERV's catalog carries 34
models across anthropic, google, openai and 6 native `serv-*` models. Gemini is present
AND has a free direct tier, so both arms use Gemini. A DeepSeek raw arm against a
`gpt-6-luna` SERV arm would measure model choice, not SERV's contribution.

**R3 — RESOLVED, and it invalidates a premise of this spec.** IXS's live API exposes
**four vaults that are all the same product**: IX High Yield Bond (USDC), ~3.07% ttm, on
Avalanche mainnet and BSC mainnet. **There is no testnet deployment and nothing on Base
Sepolia.** The Fidelity MMF / Corporate Bond / Private Credit / BTC Real Yield lineup in
section 5.2 is marketing-site copy, not deployed contracts. Section 5.2's four-vault state
space is therefore a simulation, and must be labelled as one everywhere.
The vaults are ERC-**7540** (async ERC-4626), which confirms the async-redemption modeling
in the checker was correct.

**Decision taken:** read the real IXS production vaults read-only for genuine live data
(a read risks nothing), and deploy a minimal ERC-4626 to Base Sepolia ourselves purely so
the signing path is real and yields a genuine tx hash. The README states plainly that IXS
has no testnet, that live data comes from their production contracts, and that the
signature is demonstrated against a reference vault. **No mainnet transaction, ever.**

## 9. Risks and honest limits

These go in the README verbatim. Advertising the holes is what makes everything else credible.

- **R1 — Non-determinism.** Breach *rates* are statistical claims, not proofs. "8 of 10 runs"
  is the honest unit and is stated everywhere. Cupel does not prove safety; it finds
  counterexamples. Absence of a counterexample is not a safety proof, and the report says so.
- **R2 — State space is a model.** Certification is relative to the sampled dimensions. A breach
  outside the modeled space will not be found. The state-space definition ships with every
  certificate so the boundary is inspectable.
- **R3 — IXS surface unknown until probed.** Hour-one task: confirm MCP URL, vault ids, and
  whether queue and notice state are actually exposed. Fallback is direct `viem` ERC-4626 reads
  plus hand-built calldata. Anything simulated is labeled simulated.
- **R4 — `-serv-kronos` unverified.** Documented on the Kronos page, absent from the models page.
  Probe in hour one; if unavailable, the compiler runs without it. No functional dependency.
- **R5 — Base Sepolia faucet.** If testnet funds are unobtainable, the signing step is mocked and
  labeled. **No fabricated transaction hashes, ever.**
- **R6 — Cost.** ~$0.30 per 500-state campaign at Luna pricing. Budget is fine; cache aggressively
  and freeze state sets so the benchmark is re-runnable without re-spending.
- **R7 — Node-level localization is UNVERIFIED and this is the biggest risk in the build.**
  SERV's API reference documents `reasoning: { effort, summary }` and describes `output` as
  containing "reasoning items," but **no per-node structure, node ids, or graph shape is
  documented anywhere**. The report line "Rationalized at node 7" may not be buildable.
  **Blocking hour-one probe:** make one Responses call with `reasoning.summary` enabled and
  inspect the raw `output` array for step granularity.
  **Fallback, built regardless of the probe's answer** (~2h, accepted as insurance): localize at
  clause level — attribute the breach to the clause ids the agent itself cited in the offending
  intent, and diff the reasoning summary text between a passing and a breaching run of the same
  campaign. Less precise, still unique, honest. Building it even when the probe succeeds means no
  single undocumented API limitation discovered on day three can destroy the demo.
  The demo script must not promise node ids until the probe returns.
- **R8 — "You wrote a bad agent."** The most likely way a judge dismisses this. Mitigated by
  §5.3: the subject is a boring, public, 30-line idiomatic allocator, shown on screen. If the
  subject ever looks clever, the finding looks rigged.

---

## 10. Submission checklist

- [ ] **Day 1, before anything:** enable data collection at `console.openserv.ai/settings/organization` (eligibility requirement)
- [ ] Hour 1 probes, all blocking: IXS MCP + vault ids (R3), `-serv-kronos` (R4), Base Sepolia faucet (R5), **reasoning granularity in the `output` array (R7)**
- [ ] Hour 4: one signed Base Sepolia deposit, end to end, before anything is built on top of it
- [ ] README with a "What is actually real" table and a "Known gaps" section
- [ ] `/verify` live and wallet-free
- [ ] Demo video
- [ ] Public X post tagging `@openservai`, then the submission form
- [ ] Submitted before **2026-09-28 00:00 UTC**

---

## 11. Prior art, named before someone else names it

Listing neighbors is a rigor signal and it preempts "isn't this just X?" from a judge. Put this
in the README.

| Prior art | What it does | How Cupel differs |
| --- | --- | --- |
| **promptfoo** | Adversarial testing and assertions over LLM app outputs | Tests prompts against assertions. Cupel searches a *financial state space* and checks against position math verified on-chain, not against text assertions |
| **`nerdsane/temper`** | Verified agent runtime; safety properties over reachable states | Enforces at runtime. Cupel *searches for violations before deployment*. Discovery, not enforcement |
| **Gauntlet** | DeFi protocol risk simulation | Models protocol-level risk for protocols. Cupel tests one agent against one mandate, for the agent's principal |
| **QuickCheck / Hypothesis** | Property-based testing with shrinking | Direct ancestor, and the shrinking phase is borrowed openly. Cupel applies it to a non-deterministic subject, so it reports frequencies rather than pass/fail |
| **TLA+ / model checking** | Exhaustive verification of state machines | Model checking proves. Cupel cannot prove; it finds counterexamples. Stated plainly in R1 |

## 12. Revenue

No risk committee approves an agent that moves capital without evidence of its failure modes.
Priced per campaign, per certification, or as continuous re-certification as conditions drift
("certified as of block N" decays, and decay is the subscription). The buyer is the person who
already has the money and cannot deploy it.

# Cupel demo script — 2:30 hard cap

## Before you hit record

- [ ] Vercel Deployment Protection **off**. Check in an incognito window: `https://cupel-serv.vercel.app` must load with no login. If it still bounces, record against `npm run dev` on localhost instead and say nothing about it.
- [ ] Run one Gemini campaign **before recording** so the serverless function is warm. A cold start adds 5-10s you cannot afford.
- [ ] Browser at 100% zoom, bookmarks bar hidden, one tab only. Your tab bar is in every screenshot so far.
- [ ] Second tab ready on `/verify`, already loaded.
- [ ] Know your numbers cold: **82.1% vs 72.1%**, **43 of 43 vs 39 of 43**, **n=43**.

Timings below are ceilings. Under is fine, over is not.

---

## 0:00 – 0:20 · Cold open. No introduction.

**On screen:** a completed campaign, scrolled to the breach card. `CAP-CREDIT-20`. Private Credit at 14%, everything else at 1%. `$50,000` deposited. 50% against a 20% cap.

**Say:**
> "This agent was told: never more than twenty percent in private credit. It put fifty percent in. Here's its reasoning."

Read the quote off the screen. Let it sit for two seconds.

> *"credit offers the highest yield; allocating idle cash there, holding back fifty thousand for the known liability and the vault's zero-day redemption queue."*

**Say:**
> "That's not a hallucination. It's a defensible argument for a mandate violation. You cannot catch that by reading outputs."

Do not say your name, the hackathon, or what Cupel is. Not yet.

---

## 0:20 – 0:35 · What it is

**Say:**
> "Cupel is Cupel. You write a treasury policy in English. It searches market states for the worlds where your agent breaks its own policy, shrinks each one to the smallest world that still breaks, and certifies the mandates that survive."

Scroll up to the hero while you say it.

---

## 0:35 – 1:05 · Run it live

**Do:** engine `GEMINI`, `n` = 8, click RUN.

**Say while it runs:**
> "Real model, live calls. Eleven worlds: eight sampled, plus three built specifically to tempt each clause in the mandate."

When results land, point at the stat row.

> "Counted, breaches, breach rate. And a per-clause breakdown, because a clause that never breaches is worth knowing about too. That means it isn't binding on this agent."

If the run is slow, keep talking, do not wait in silence. If it fails, switch to `STUB` and say "deterministic fallback" without apologising.

---

## 1:05 – 1:35 · The counterexample

**Do:** scroll to the breach card.

**Say:**
> "This is the minimal counterexample. Not the wildest market we found, the most ordinary one that still breaks. Vault yields, redemption queues, the treasury total, and the exact intent that broke the clause."

Point at the amber badge.

> "And this says the portfolio is simulated. IXS has no testnet. I'm not going to pretend otherwise."

---

## 1:35 – 1:50 · Three engines

**Do:** click `STUB`, run, let the different number land. Then click `SERV`.

**Say:**
> "Same mandate, different agents, different failure rates. And SERV is gated, because it spends real credit and this endpoint is public."

The 403 message appears on screen. Do not explain it further.

---

## 1:50 – 2:15 · Evidence

**Do:** switch to the `/verify` tab. Reload it live.

**Say:**
> "Every claim I've made re-checks here on page load. No wallet needed. Live Base Sepolia reads, both transaction receipts, read-only reads against IXS production vaults on BSC and Avalanche, and the benchmark replayed through the real checker."

Click one Basescan link. Let the block explorer load for a beat, then come back.

---

## 2:15 – 2:30 · Close on the number and the limits

**Say:**
> "Same model both arms, one frozen world set. Direct: eighty-two percent breach. Through SERV: seventy-two. Ten points, and at n equals forty-three that is not statistically significant, so treat it as a direction."

> "The cleaner result is the reliability column. SERV returned schema-valid output forty-three times out of forty-three. The same model called directly managed thirty-nine."

Last line, straight to camera:

> "Cupel finds counterexamples. It does not prove safety, and the certificate says so itself. Code and the full limits are in the README."

Stop recording. Do not add a thank-you.

---

## Rules

**Lead with the failure.** The breach is the product. Anything before it is throat-clearing.

**Say the limits out loud.** The simulated portfolio, the small n, the insignificant gap. A judge who finds an undisclosed weakness stops believing the disclosed strengths. A judge who hears you volunteer them believes the rest.

**Never say "as you can see" or "let me show you."** Just show it.

**If something breaks on camera, say what broke and move on.** Do not restart. A recovered demo reads as real; a suspiciously perfect one reads as recorded twenty times.

## Cut list, if you run long

1. The stub/serv engine comparison at 1:35
2. The Basescan click at 1:50, describe it instead
3. The reliability-column line at 2:15

Never cut the cold open, the counterexample card, or the limits sentence at the end.

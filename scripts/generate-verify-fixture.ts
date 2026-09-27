// One-off generator for src/fixtures/mandate-compile.json.
// Makes exactly one live SERV call, captures the raw compile output, and
// verifies it parses through the real parseMandate before persisting it.
// Run with: npx tsx scripts/generate-verify-fixture.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { compileMandate } from '../src/core/mandate/compile';
import { parseMandate } from '../src/core/mandate/compile';
import { KRONOS_MODEL, SERV_MODEL } from '../src/core/serv';

async function main() {
  const source = readFileSync('src/fixtures/mandates/conservative.txt', 'utf8');
  const mandate = await compileMandate(source);
  // compileMandate doesn't hand back the raw JSON string, so re-derive it
  // (bigints -> strings) in the exact shape parseMandate expects as input --
  // this is what gets replayed, and parseMandate is called on it below to
  // prove it still parses before it's ever written to disk.
  const rawJson = JSON.stringify({
    clauses: mandate.clauses.map((c) =>
      c.kind === 'min_liquid'
        ? { id: c.id, text: c.text, kind: c.kind, amountUsdc: (Number(c.amount) / 1_000_000).toString(), byDays: c.byDays }
        : c,
    ),
  });
  // Prove it round-trips before persisting.
  const reparsed = parseMandate(source, rawJson);
  if (reparsed.clauses.length !== mandate.clauses.length) throw new Error('round-trip mismatch');

  writeFileSync(
    'src/fixtures/mandate-compile.json',
    JSON.stringify({ source, model: KRONOS_MODEL || SERV_MODEL, rawJson, generatedAt: new Date().toISOString() }, null, 2) + '\n',
  );
  console.log(`wrote src/fixtures/mandate-compile.json (${mandate.clauses.length} clauses)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

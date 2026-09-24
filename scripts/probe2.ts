/** Follow-up probes: is reasoning content readable (R7), and is kronos live (R4). */
const key = process.env.SERV_API_KEY!;
const BASE = 'https://inference-api.openserv.ai/v1';

async function post(path: string, body: unknown) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function r7() {
  console.log('\n=== R7a: is reasoning CONTENT or SUMMARY readable? ===');
  for (const effort of ['medium', 'high']) {
    const { status, json } = await post('/responses', {
      model: 'gpt-6-luna',
      instructions: 'You allocate treasury funds. Think step by step, then answer.',
      input: 'Vault A yields 4% and redeems in 1 day. Vault B yields 9% and redeems in 30 days. I need 60 USDC liquid within 7 days and hold 100 USDC. Allocate.',
      reasoning: { effort, summary: 'detailed' },
    });
    const r = json.output?.find((o: { type: string }) => o.type === 'reasoning');
    console.log(`\n[effort=${effort}] status=${status}`);
    if (!r) { console.log('  no reasoning item'); continue; }
    console.log('  reasoning.id          :', r.id);
    console.log('  content[] length      :', Array.isArray(r.content) ? r.content.length : 'n/a');
    console.log('  content[] value       :', JSON.stringify(r.content)?.slice(0, 400));
    console.log('  summary type/length   :', Array.isArray(r.summary) ? `array(${r.summary.length})` : typeof r.summary);
    console.log('  summary value         :', JSON.stringify(r.summary)?.slice(0, 800));
    console.log('  encrypted_content len :', typeof r.encrypted_content === 'string' ? r.encrypted_content.length : 'none');
    console.log('  reasoning param echo  :', JSON.stringify(json.reasoning));
  }
}

async function r4() {
  console.log('\n=== R4: kronos, using max_completion_tokens ===');
  for (const model of ['gpt-6-luna', 'gpt-6-luna-serv-kronos']) {
    const { status, json } = await post('/chat/completions', {
      model,
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Say OK.' },
      ],
      max_completion_tokens: 16,
    });
    const err = json?.error?.message;
    console.log(`  ${model.padEnd(28)} status=${status} ${err ? 'ERR: ' + err.slice(0, 120) : 'OK -> ' + JSON.stringify(json.choices?.[0]?.message?.content)?.slice(0, 60)}`);
  }
}

async function catalog() {
  console.log('\n=== CATALOG via GET /models ===');
  const res = await fetch(BASE + '/models', { headers: { authorization: `Bearer ${key}` } });
  const json = await res.json();
  console.log('status:', res.status);
  console.log(JSON.stringify(json).slice(0, 1200));
}

async function main() { await catalog(); await r7(); await r4(); }
main().catch((e) => { console.error(e); process.exit(1); });

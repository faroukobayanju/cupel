/**
 * Hour-one probes. Answers R7 (reasoning granularity), R4 (kronos), and lists
 * the SERV model catalog so the benchmark can use ONE model on both arms.
 * Never prints the API key.
 */
import OpenAI from 'openai';

const key = process.env.SERV_API_KEY;
if (!key) {
  console.error('SERV_API_KEY not set. Load .env.local first.');
  process.exit(1);
}

const client = new OpenAI({ apiKey: key, baseURL: 'https://inference-api.openserv.ai/v1' });

async function probeCatalog() {
  console.log('\n=== CATALOG: models available through SERV ===');
  try {
    const models = await client.models.list();
    const ids = models.data.map((m) => m.id).sort();
    console.log(`${ids.length} models:`);
    for (const id of ids) console.log('  ' + id);
  } catch (e) {
    console.log('models.list() failed:', (e as Error).message);
  }
}

async function probeR7() {
  console.log('\n=== R7: does the response expose per-step reasoning structure? ===');
  // SERV rejects any request without a system prompt (discovered by probe, not documented).
  const body = {
    model: 'gpt-6-luna',
    instructions: 'You are a treasury allocation assistant. Answer concisely.',
    input: 'Allocate 100 USDC across a 4% vault and a 9% vault. Explain briefly.',
    reasoning: { effort: 'medium', summary: 'auto' },
  };
  try {
    // Responses endpoint, raw fetch so nothing is stripped by the SDK.
    const res = await fetch('https://inference-api.openserv.ai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    console.log('status:', res.status);
    console.log('top-level keys:', Object.keys(json).join(', '));
    if (Array.isArray(json.output)) {
      console.log(`output[] has ${json.output.length} item(s):`);
      json.output.forEach((item: Record<string, unknown>, i: number) => {
        console.log(`  [${i}] type=${item.type} keys=${Object.keys(item).join(',')}`);
      });
    }
    console.log('--- RAW (first 1500 chars) ---');
    console.log(JSON.stringify(json, null, 2).slice(0, 1500));
  } catch (e) {
    console.log('R7 probe failed:', (e as Error).message);
  }
}

async function probeR4() {
  console.log('\n=== R4: is the -serv-kronos suffix live? ===');
  try {
    await client.chat.completions.create({
      model: 'gpt-6-luna-serv-kronos',
      messages: [
        { role: 'system', content: 'You are a terse assistant.' },
        { role: 'user', content: 'ping' },
      ],
      max_tokens: 5,
    });
    console.log('kronos: AVAILABLE');
  } catch (e) {
    console.log('kronos: UNAVAILABLE —', (e as Error).message.slice(0, 200));
  }
}

async function main() {
  await probeCatalog();
  await probeR7();
  await probeR4();
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeRequest(body: unknown, ip: string) {
  return new Request('http://localhost/api/campaign', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
});

describe('CRITICAL 1: public n ceiling', () => {
  it('clamps n above CUPEL_PUBLIC_MAX_N down to the ceiling', async () => {
    process.env.CUPEL_PUBLIC_MAX_N = '3';
    process.env.CUPEL_RATE_LIMIT = '100';
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ n: 999, engine: 'stub' }, '10.0.1.1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Total trials = one clause-seed trial per hard clause, plus n sampled
    // trials. n=999 must have been clamped to the ceiling (3), not passed
    // through -- so total trials stays small instead of running hundreds.
    const totalTrials = body.counted + body.inconclusive;
    expect(totalTrials).toBeLessThanOrEqual(body.hardClauses + 3);
    expect(totalTrials).toBeLessThan(999);
  });

  it('still 400s on an invalid n exactly as before', async () => {
    process.env.CUPEL_PUBLIC_MAX_N = '25';
    process.env.CUPEL_RATE_LIMIT = '100';
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ n: -1, engine: 'stub' }, '10.0.1.2'));
    expect(res.status).toBe(400);
  });
});

describe('CRITICAL 1: serv engine gating', () => {
  it('returns 403 and never touches SERV when CUPEL_ALLOW_SERV is not set', async () => {
    delete process.env.CUPEL_ALLOW_SERV;
    process.env.CUPEL_RATE_LIMIT = '100';
    vi.doMock('../../../core/serv', () => ({
      servClient: () => { throw new Error('servClient should not be called when serv is gated off'); },
      SERV_MODEL: 'gpt-6-luna',
    }));
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ engine: 'serv' }, '10.0.1.3'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/serv/i);
  });

  it('allows serv selection through to the credit preflight when CUPEL_ALLOW_SERV=true', async () => {
    process.env.CUPEL_ALLOW_SERV = 'true';
    process.env.CUPEL_RATE_LIMIT = '100';
    let called = false;
    vi.doMock('../../../core/serv', () => ({
      servClient: () => ({
        responses: {
          create: async () => {
            called = true;
            return {};
          },
        },
      }),
      SERV_MODEL: 'gpt-6-luna',
    }));
    const { POST } = await import('./route');
    await POST(makeRequest({ engine: 'serv', n: 1 }, '10.0.1.4'));
    expect(called).toBe(true);
    delete process.env.CUPEL_ALLOW_SERV;
  });
});

describe('CRITICAL 1: per-IP rate limit', () => {
  it('429s after the budget and resets after the window, with a Retry-After header', async () => {
    process.env.CUPEL_RATE_LIMIT = '2';
    process.env.CUPEL_RATE_WINDOW_MS = '50';
    process.env.CUPEL_PUBLIC_MAX_N = '25';
    const { POST } = await import('./route');
    const ip = '10.0.1.5';
    const body = { n: 1, engine: 'stub' };

    const r1 = await POST(makeRequest(body, ip));
    const r2 = await POST(makeRequest(body, ip));
    const r3 = await POST(makeRequest(body, ip));

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.headers.get('Retry-After')).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 80));

    const r4 = await POST(makeRequest(body, ip));
    expect(r4.status).toBe(200);
  });

  it('tracks separate IPs independently', async () => {
    process.env.CUPEL_RATE_LIMIT = '1';
    process.env.CUPEL_RATE_WINDOW_MS = '600000';
    process.env.CUPEL_PUBLIC_MAX_N = '25';
    const { POST } = await import('./route');
    const body = { n: 1, engine: 'stub' };
    const rA1 = await POST(makeRequest(body, '10.0.1.6'));
    const rB1 = await POST(makeRequest(body, '10.0.1.7'));
    expect(rA1.status).toBe(200);
    expect(rB1.status).toBe(200);
  });
});

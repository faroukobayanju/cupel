import { describe, it, expect, beforeEach, vi } from 'vitest';

// All the chain/IXS checks in this route make real network calls -- mock
// them to fail fast so this test stays offline. Only the mandate-compile
// check (replayed vs live) is under test here.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: async () => { throw new Error('offline test: no network'); },
      getBlockNumber: async () => { throw new Error('offline test: no network'); },
      getTransactionReceipt: async () => { throw new Error('offline test: no network'); },
    }),
  };
});
vi.mock('../../../core/world/ixs', () => ({
  readIxsVaults: async () => { throw new Error('offline test: no network'); },
}));

function makeRequest(query = '') {
  return new Request(`http://localhost/api/verify${query}`);
}

beforeEach(() => {
  vi.resetModules();
});

describe('CRITICAL 2: mandate compile replay is the default', () => {
  it('GET /api/verify replays the recorded fixture, makes no live call, and labels itself replayed', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.mandateCompileMode).toBe('replayed');
    const check = body.checks.find((c: { id: string }) => c.id === 'mandate-compile-replay');
    expect(check).toBeDefined();
    expect(check.label).toMatch(/replayed/i);
    expect(check.label).not.toMatch(/live SERV call/i);
    expect(check.status).toBe('pass');
  });

  it('fails loudly, naming the reason, if the recorded fixture no longer parses', async () => {
    vi.doMock('../../../fixtures/mandate-compile.json', () => ({
      default: { source: 'src', model: 'gpt-6-luna', generatedAt: 'x', rawJson: JSON.stringify({ clauses: [{ id: 'C1', text: 'bad', kind: 'not_a_real_kind' }] }) },
    }));
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();
    const check = body.checks.find((c: { id: string }) => c.id === 'mandate-compile-replay');
    expect(check.status).toBe('fail');
    expect(check.detail).toMatch(/not_a_real_kind|failed to parse/i);
  });
});

describe('CRITICAL 2: live opt-in', () => {
  it('GET /api/verify?live=1 calls compileMandate and labels itself live', async () => {
    let called = false;
    vi.doMock('../../../core/mandate/compile', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../core/mandate/compile')>();
      return {
        ...actual,
        compileMandate: async () => {
          called = true;
          return { version: '1', source: 'src', clauses: [{ id: 'C1', text: 't', kind: 'soft_preference' }] };
        },
      };
    });
    process.env.SERV_API_KEY = 'test-key-not-real';
    const { GET } = await import('./route');
    const res = await GET(makeRequest('?live=1'));
    const body = await res.json();
    expect(called).toBe(true);
    expect(body.mandateCompileMode).toBe('live');
    const check = body.checks.find((c: { id: string }) => c.id === 'mandate-compile-replay');
    expect(check.label).toMatch(/live SERV call/i);
    expect(check.label).not.toMatch(/replayed/i);
  });
});

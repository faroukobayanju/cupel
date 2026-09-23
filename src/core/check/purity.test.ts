import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('check/ is pure', () => {
  it('imports no LLM client, no network, and no chain client', () => {
    const dir = 'src/core/check';
    const banned = ['openai', 'viem', 'node-fetch', 'axios'];
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const b of banned) {
        expect(src, `${f} must not import ${b}`).not.toContain(`from '${b}'`);
      }
      expect(src, `${f} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
    }
  });
});

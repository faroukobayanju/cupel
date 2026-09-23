import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively collect non-test .ts files under `dir`, so this keeps working if someone adds a subdirectory. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('check/ is pure', () => {
  it('imports no LLM client, no network, and no chain client', () => {
    const dir = 'src/core/check';
    const banned = ['openai', 'viem', 'node-fetch', 'axios'];
    for (const file of listSourceFiles(dir)) {
      const src = readFileSync(file, 'utf8');
      for (const b of banned) {
        // Catch single- and double-quoted static imports, and require(...) calls,
        // not just `from '<b>'`.
        const importRe = new RegExp(`from\\s+["']${b}["']`);
        const requireRe = new RegExp(`require\\(\\s*["']${b}["']\\s*\\)`);
        expect(src, `${file} must not import ${b}`).not.toMatch(importRe);
        expect(src, `${file} must not require ${b}`).not.toMatch(requireRe);
      }
      expect(src, `${file} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
    }
  });
});

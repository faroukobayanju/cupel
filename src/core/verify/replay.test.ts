import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { replayArm } from './replay';
import type { JsonArm } from './replay';

// Offline, key-free: this is the one runnable check that the benchmark
// replay logic actually recomputes what the frozen checker says, not just
// what the fixture claims about itself.
const fixture = JSON.parse(readFileSync('src/fixtures/bench-result.json', 'utf8')) as {
  raw: JsonArm;
  serv: JsonArm;
};

describe('replayArm', () => {
  it('reproduces the frozen raw-arm benchmark numbers from stored trials', () => {
    const result = replayArm(fixture.raw);
    expect(result.matches).toBe(true);
    expect(result.recomputedCounted).toBe(39);
    expect(result.recomputedBreaches).toBe(32);
  });

  it('reproduces the frozen serv-arm benchmark numbers from stored trials', () => {
    const result = replayArm(fixture.serv);
    expect(result.matches).toBe(true);
    expect(result.recomputedCounted).toBe(43);
    expect(result.recomputedBreaches).toBe(31);
  });

  it('flags a mismatch if a trial were tampered with', () => {
    const tampered: JsonArm = {
      ...fixture.raw,
      counted: fixture.raw.counted,
      breaches: fixture.raw.breaches + 1, // claim one more breach than the trials actually contain
    };
    const result = replayArm(tampered);
    expect(result.matches).toBe(false);
  });
});

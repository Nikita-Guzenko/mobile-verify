import { test } from 'node:test';
import assert from 'node:assert';
import { decide } from '../lib/loop-guard.lib.mjs';

const caps = { maxIterations: 6, maxBudgetTokens: 200000, breakerRepeats: 3 };

test('continue when green path not reached and under caps', () => {
  const s = { iteration: 1, budgetTokens: 1000, failSignatures: ['a'] };
  assert.deepEqual(decide(s, caps, false).action, 'continue');
});
test('stop when report is green', () => {
  assert.equal(decide({ iteration: 2, budgetTokens: 0, failSignatures: [] }, caps, true).action, 'stop');
  assert.match(decide({ iteration: 2, budgetTokens: 0, failSignatures: [] }, caps, true).reason, /green/i);
});
test('stop at max iterations', () => {
  assert.equal(decide({ iteration: 6, budgetTokens: 0, failSignatures: ['a','b'] }, caps, false).action, 'stop');
});
test('stop on budget exceeded', () => {
  assert.equal(decide({ iteration: 2, budgetTokens: 250000, failSignatures: [] }, caps, false).action, 'stop');
});
test('circuit-breaker: same failure N times in a row stops', () => {
  assert.equal(decide({ iteration: 4, budgetTokens: 0, failSignatures: ['x','x','x'] }, caps, false).action, 'stop');
});

import { test } from 'node:test';
import assert from 'node:assert';
import { parseVerdict } from '../lib/verdict.lib.mjs';

test('parses clean JSON', () => {
  const v = parseVerdict('{"pass": true, "issues": []}');
  assert.deepEqual(v, { pass: true, issues: [] });
});
test('parses JSON wrapped in prose/fences', () => {
  const v = parseVerdict('Here is my verdict:\n```json\n{"pass": false, "issues": ["blank screen"]}\n```\nthanks');
  assert.equal(v.pass, false);
  assert.deepEqual(v.issues, ['blank screen']);
});
test('fails closed (pass=false) on unparseable output', () => {
  const v = parseVerdict('the model rambled with no json');
  assert.equal(v.pass, false);
  assert.match(v.issues[0], /could not parse/i);
});

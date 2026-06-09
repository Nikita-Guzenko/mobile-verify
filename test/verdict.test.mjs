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
test('forward-parse: complete object not mis-truncated by shrink-from-end when issues contain a closing brace', () => {
  // The shrink-from-end loop would stop at the LAST '}' first, which is fine for simple objects,
  // but if issues text contains '}' the shrink loop could truncate the outer object incorrectly.
  // forward-parse (slice from first '{') must return the full outer object intact.
  const raw = '{"pass":false,"issues":["layout broken {unexpected}"]}';
  const v = parseVerdict(raw);
  assert.equal(v.pass, false);
  assert.deepEqual(v.issues, ['layout broken {unexpected}']);
});
test('forward-parse preferred: complete JSON followed by prose is parsed correctly', () => {
  // Model emits valid JSON then appends explanation text after a newline.
  const raw = '{"pass":true,"issues":[]}\nNote: the app looks fine.';
  const v = parseVerdict(raw);
  assert.equal(v.pass, true);
  assert.deepEqual(v.issues, []);
});

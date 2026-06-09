import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(report) {
  const dir = mkdtempSync(join(tmpdir(), 'mv-'));
  const f = join(dir, 'r.json');
  writeFileSync(f, JSON.stringify(report));
  try { execFileSync('node', ['scripts/done-gate.mjs', f], { stdio: 'pipe' }); return 0; }
  catch (e) { return e.status; }
}

test('exit 0 when allGreen', () => {
  assert.equal(run({ allGreen: true, flows: [] }), 0);
});
test('exit 1 when not allGreen', () => {
  assert.equal(run({ allGreen: false, flows: [{ flow: 'x', functional: false, visual: true, visualIssues: [] }] }), 1);
});

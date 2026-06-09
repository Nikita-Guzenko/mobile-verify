import { test } from 'node:test';
import assert from 'node:assert';
import { buildReport, failSignature } from '../lib/report.lib.mjs';

const maestro = [
  { flow: '01-signin', passed: true,  log: '' },
  { flow: '02-tabs',   passed: false, log: 'assertVisible "Home" failed' },
];
const visual = [
  { flow: '01-signin', pass: true,  issues: [] },
  { flow: '01-signin', pass: false, issues: ['empty white screen'] }, // a second shot for same flow
];

test('allGreen false when any functional or visual fails', () => {
  const r = buildReport(maestro, visual);
  assert.equal(r.allGreen, false);
});
test('per-flow merge: functional + visual rolled up', () => {
  const r = buildReport(maestro, visual);
  const signin = r.flows.find((f) => f.flow === '01-signin');
  assert.equal(signin.functional, true);
  assert.equal(signin.visual, false); // one of its shots failed
  assert.deepEqual(signin.visualIssues, ['empty white screen']);
});
test('allGreen true only when everything passes', () => {
  const r = buildReport(
    [{ flow: 'a', passed: true, log: '' }],
    [{ flow: 'a', pass: true, issues: [] }]
  );
  assert.equal(r.allGreen, true);
});
test('failSignature is stable for same failures', () => {
  assert.equal(failSignature(buildReport(maestro, visual)),
               failSignature(buildReport(maestro, visual)));
});

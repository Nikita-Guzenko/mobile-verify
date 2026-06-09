import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../scripts/loop-guard.mjs', import.meta.url).pathname;

function run(stateFile, reportFile) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, stateFile, reportFile], { encoding: 'utf8' });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status, out: e.stdout };
  }
}

function makeReport(dir, allGreen, signature = 'abc123') {
  const f = join(dir, 'report.json');
  writeFileSync(f, JSON.stringify({ allGreen, signature }));
  return f;
}

function readState(stateFile) {
  return JSON.parse(readFileSync(stateFile, 'utf8'));
}

test('iteration increments across sequential calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgcli-'));
  const stateFile = join(dir, 'state.json');
  const reportF = makeReport(dir, false, 'sig1');

  run(stateFile, reportF);
  assert.equal(readState(stateFile).iteration, 1);

  run(stateFile, reportF);
  assert.equal(readState(stateFile).iteration, 2);

  run(stateFile, reportF);
  assert.equal(readState(stateFile).iteration, 3);
});

test('handles a pre-existing empty/partial state file ({}) without crashing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgcli-'));
  const stateFile = join(dir, 'state.json');
  writeFileSync(stateFile, '{}'); // file EXISTS but has no fields (the real crash case)
  const reportF = makeReport(dir, false, 'sigE');

  const { rc, out } = run(stateFile, reportF);
  assert.equal(rc, 0); // continue, not a crash
  assert.ok(out, 'must print a decision (a crash prints nothing to stdout)');
  const state = readState(stateFile);
  assert.equal(state.iteration, 1);
  assert.deepEqual(state.failSignatures, ['sigE']);
});

test('failure signatures accumulate when not green', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgcli-'));
  const stateFile = join(dir, 'state.json');
  const reportF = makeReport(dir, false, 'sigX');

  run(stateFile, reportF);
  run(stateFile, reportF);
  const state = readState(stateFile);
  assert.deepEqual(state.failSignatures, ['sigX', 'sigX']);
});

test('signatures do NOT accumulate on green run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgcli-'));
  const stateFile = join(dir, 'state.json');
  const reportF = makeReport(dir, true, 'greenSig');

  run(stateFile, reportF);
  const state = readState(stateFile);
  assert.deepEqual(state.failSignatures, []);
  assert.equal(state.iteration, 1);
});

test('green run exits 1 (stop) with rc=1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgcli-'));
  const stateFile = join(dir, 'state.json');
  const reportF = makeReport(dir, true, 'greenSig');

  const { rc, out } = run(stateFile, reportF);
  assert.equal(rc, 1);
  const d = JSON.parse(out);
  assert.equal(d.action, 'stop');
  assert.match(d.reason, /green/i);
});

test('circuit-breaker fires after 3 identical signatures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgcli-'));
  const stateFile = join(dir, 'state.json');
  const reportF = makeReport(dir, false, 'sameSig');

  // run 1: continue (first sig)
  assert.equal(run(stateFile, reportF).rc, 0);
  // run 2: continue (two sigs)
  assert.equal(run(stateFile, reportF).rc, 0);
  // run 3: stop (three identical sigs = circuit-breaker)
  const { rc, out } = run(stateFile, reportF);
  assert.equal(rc, 1);
  assert.match(JSON.parse(out).reason, /circuit-breaker/i);
});

test('cap fires after exactly 6 iterations (continue runs 1-5, stop on run 6)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgcli-'));
  const stateFile = join(dir, 'state.json');

  // Use distinct signatures each time to avoid the circuit-breaker
  for (let i = 1; i <= 5; i++) {
    const reportF = makeReport(dir, false, `sig${i}`);
    const { rc } = run(stateFile, reportF);
    assert.equal(rc, 0, `run ${i} should continue`);
    assert.equal(readState(stateFile).iteration, i, `iteration after run ${i}`);
  }

  // 6th run should stop (iteration cap)
  const reportF6 = makeReport(dir, false, 'sig6');
  const { rc, out } = run(stateFile, reportF6);
  assert.equal(readState(stateFile).iteration, 6, 'iteration after run 6');
  assert.equal(rc, 1, 'run 6 must stop');
  assert.match(JSON.parse(out).reason, /max iterations/i);
});

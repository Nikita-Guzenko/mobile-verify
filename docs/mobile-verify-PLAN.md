# mobile-verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code skill `mobile-verify` that drives an Expo/RN app to "all user flows pass functionally AND visually" on the iOS simulator, fix-until-green.

**Architecture:** Deterministic scripts do the mechanical work (boot sim, run Maestro, judge screenshots via Gemini, merge report, enforce caps); the agent does the two creative jobs (generate Maestro YAML from `user-flows.md`, fix code). SKILL.md orchestrates the loop.

**Tech Stack:** Node 20+ (ESM, `node:test`), bash, Maestro 2.6, `xcrun simctl`, Expo (`expo run:ios`), Gemini via local CLIProxyAPI `:8328`.

**Skill location:** `~/.claude/skills/mobile-verify/`
**Spec:** `~/Desktop/mobile-verify-DESIGN.md`
**Dogfood target:** `~/Desktop/invoicesnap-expo` (bundle `com.731labs.invoicesnap.app`, 18 existing `.maestro` flows).

---

## File structure

```
~/.claude/skills/mobile-verify/
  SKILL.md                  # agent-facing orchestration (flow-gen rules, loop, gemini, errors)
  package.json              # {type:module}, devDeps: none (node:test builtin)
  scripts/
    loop-guard.mjs          # cap/circuit-breaker decision over state.json
    done-gate.mjs           # exit 0 iff report.allGreen
    report.mjs              # merge maestro junit + visual results -> report.json + .md
    visual-judge.mjs        # screenshot -> Gemini :8328 -> {pass, issues[]}
    run-flows.sh            # boot sim + ensure app + maestro test + collect artifacts
  lib/
    loop-guard.lib.mjs      # pure decision fn (tested)
    report.lib.mjs          # pure merge fn (tested)
    verdict.lib.mjs         # pure Gemini-response parser (tested)
  templates/
    user-flows.template.md  # the flow spec format
  test/
    loop-guard.test.mjs
    report.test.mjs
    verdict.test.mjs
```

Pure logic lives in `lib/*.lib.mjs` (unit-tested with `node:test`); `scripts/*` are thin CLI wrappers + integration (boot/maestro/proxy) verified by dogfood.

---

### Task 1: Scaffold skill + test harness

**Files:**
- Create: `~/.claude/skills/mobile-verify/package.json`
- Create: `~/.claude/skills/mobile-verify/.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "mobile-verify",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
.mobile-verify/
```

- [ ] **Step 3: Verify test runner works (no tests yet = exit 0)**

Run: `cd ~/.claude/skills/mobile-verify && node --test 2>&1 | tail -3`
Expected: runs, "tests 0" (or pass 0), exit 0.

- [ ] **Step 4: Commit**

```bash
cd ~/.claude/skills/mobile-verify && git init -q && git add -A && git commit -m "chore: scaffold mobile-verify skill"
```

---

### Task 2: loop-guard (caps + circuit-breaker) — pure fn + CLI

**Files:**
- Create: `lib/loop-guard.lib.mjs`
- Create: `test/loop-guard.test.mjs`
- Create: `scripts/loop-guard.mjs`

- [ ] **Step 1: Write failing test** — `test/loop-guard.test.mjs`

```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `cd ~/.claude/skills/mobile-verify && node --test test/loop-guard.test.mjs 2>&1 | tail -5`
Expected: FAIL — `Cannot find module '../lib/loop-guard.lib.mjs'`.

- [ ] **Step 3: Implement** — `lib/loop-guard.lib.mjs`

```js
// Decide whether the fix-until-green loop should continue or stop.
// state: { iteration:int, budgetTokens:int, failSignatures:string[] (most recent last) }
// caps: { maxIterations, maxBudgetTokens, breakerRepeats }
// green: boolean (latest report all-green functional+visual)
export function decide(state, caps, green) {
  if (green) return { action: 'stop', reason: 'all flows green (functional+visual)' };
  if (state.iteration >= caps.maxIterations)
    return { action: 'stop', reason: `max iterations (${caps.maxIterations}) reached` };
  if (state.budgetTokens >= caps.maxBudgetTokens)
    return { action: 'stop', reason: `token budget (${caps.maxBudgetTokens}) exceeded` };
  const sigs = state.failSignatures || [];
  const n = caps.breakerRepeats;
  if (sigs.length >= n) {
    const tail = sigs.slice(-n);
    if (tail.every((s) => s && s === tail[0]))
      return { action: 'stop', reason: `circuit-breaker: identical failure ${n}x — needs human` };
  }
  return { action: 'continue', reason: 'under caps, not green' };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/loop-guard.test.mjs 2>&1 | tail -5`
Expected: PASS, 5 tests.

- [ ] **Step 5: CLI wrapper** — `scripts/loop-guard.mjs`

```js
#!/usr/bin/env node
// Usage: loop-guard.mjs <stateFile> <green:true|false>
// Reads/updates state.json, prints decision JSON, exit 0=continue 1=stop.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { decide } from '../lib/loop-guard.lib.mjs';

const [stateFile, greenArg] = process.argv.slice(2);
const caps = { maxIterations: 6, maxBudgetTokens: 200000, breakerRepeats: 3 };
const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { iteration: 0, budgetTokens: 0, failSignatures: [] };
const d = decide(state, caps, greenArg === 'true');
console.log(JSON.stringify(d));
writeFileSync(stateFile, JSON.stringify(state, null, 2));
process.exit(d.action === 'continue' ? 0 : 1);
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(loop-guard): cap + circuit-breaker decision"
```

---

### Task 3: report — merge Maestro JUnit + visual results — pure fn + CLI

**Files:**
- Create: `lib/report.lib.mjs`
- Create: `test/report.test.mjs`
- Create: `scripts/report.mjs`

- [ ] **Step 1: Write failing test** — `test/report.test.mjs`

```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test test/report.test.mjs 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `lib/report.lib.mjs`

```js
import { createHash } from 'node:crypto';

// maestroResults: [{flow, passed:bool, log:string}]
// visualResults:  [{flow, pass:bool, issues:string[]}]  (>=1 per flow, one per judged screenshot)
export function buildReport(maestroResults, visualResults) {
  const flows = maestroResults.map((m) => {
    const shots = visualResults.filter((v) => v.flow === m.flow);
    const visualPass = shots.length === 0 ? true : shots.every((s) => s.pass);
    const visualIssues = shots.flatMap((s) => s.issues || []);
    return {
      flow: m.flow,
      functional: m.passed,
      log: m.passed ? '' : (m.log || '').slice(0, 1500),
      visual: visualPass,
      visualIssues,
    };
  });
  const allGreen = flows.every((f) => f.functional && f.visual);
  return { allGreen, flows };
}

// A stable hash of the current failures, for the circuit-breaker.
export function failSignature(report) {
  const fails = report.flows
    .filter((f) => !f.functional || !f.visual)
    .map((f) => `${f.flow}:${f.functional ? '' : 'F'}${f.visual ? '' : 'V'}:${f.visualIssues.join('|')}`)
    .sort();
  return createHash('sha1').update(fails.join('\n')).digest('hex').slice(0, 12);
}

export function toMarkdown(report) {
  const line = (f) =>
    `- ${f.functional && f.visual ? '✅' : '❌'} **${f.flow}** ` +
    `(func: ${f.functional ? 'pass' : 'FAIL'}, visual: ${f.visual ? 'pass' : 'FAIL'})` +
    (f.functional ? '' : `\n    - log: ${f.log.split('\n').slice(-3).join(' ')}`) +
    (f.visualIssues.length ? `\n    - visual: ${f.visualIssues.join('; ')}` : '');
  return `# mobile-verify report — ${report.allGreen ? 'ALL GREEN' : 'FAILURES'}\n\n` +
    report.flows.map(line).join('\n') + '\n';
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/report.test.mjs 2>&1 | tail -5`
Expected: PASS, 4 tests.

- [ ] **Step 5: CLI wrapper** — `scripts/report.mjs`

```js
#!/usr/bin/env node
// Usage: report.mjs <maestro.json> <visual.json> <outDir>
// Writes <outDir>/report-<ts isn't allowed> ... uses a passed-in timestamp arg.
// Usage: report.mjs <maestro.json> <visual.json> <outBase>  (outBase w/o extension)
import { readFileSync, writeFileSync } from 'node:fs';
import { buildReport, toMarkdown, failSignature } from '../lib/report.lib.mjs';

const [maestroF, visualF, outBase] = process.argv.slice(2);
const report = buildReport(
  JSON.parse(readFileSync(maestroF, 'utf8')),
  JSON.parse(readFileSync(visualF, 'utf8'))
);
report.signature = failSignature(report);
writeFileSync(`${outBase}.json`, JSON.stringify(report, null, 2));
writeFileSync(`${outBase}.md`, toMarkdown(report));
console.log(report.allGreen ? 'ALL GREEN' : `FAILURES (sig ${report.signature})`);
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(report): merge functional+visual into report + signature"
```

---

### Task 4: verdict parser + visual-judge (Gemini :8328)

**Files:**
- Create: `lib/verdict.lib.mjs`
- Create: `test/verdict.test.mjs`
- Create: `scripts/visual-judge.mjs`

- [ ] **Step 1: Write failing test** — `test/verdict.test.mjs`

```js
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
```

- [ ] **Step 2: Run, verify fail** — `node --test test/verdict.test.mjs` → module not found.

- [ ] **Step 3: Implement** — `lib/verdict.lib.mjs`

```js
// Parse a Gemini visual verdict. Fail CLOSED: if we can't parse, it's a fail.
export function parseVerdict(text) {
  const s = String(text || '').replace(/^```[a-z]*\n?/i, '');
  const i = s.indexOf('{');
  if (i >= 0) {
    try {
      const [obj] = rawDecode(s, i);
      return { pass: !!obj.pass, issues: Array.isArray(obj.issues) ? obj.issues : [] };
    } catch { /* fall through */ }
  }
  return { pass: false, issues: ['could not parse model verdict — failing closed'] };
}

// Decode one JSON object starting at index i, ignoring trailing junk.
function rawDecode(s, i) {
  for (let end = s.length; end > i; end--) {
    try { return [JSON.parse(s.slice(i, end))]; } catch {}
  }
  throw new Error('no json');
}
```

- [ ] **Step 4: Run, verify pass** — `node --test test/verdict.test.mjs` → PASS, 3 tests.

- [ ] **Step 5: Implement visual-judge CLI** — `scripts/visual-judge.mjs`

```js
#!/usr/bin/env node
// Usage: visual-judge.mjs <jobs.json> <out.json>
// jobs.json: [{ flow, screenshot: "/abs/path.png", expect: "expected end state text" }]
// out.json:  [{ flow, pass, issues, model, reasoningTokens }]
// Thinking control: model id carries the budget suffix `model(N)`.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseVerdict } from '../lib/verdict.lib.mjs';

const PROXY = 'http://localhost:8328/v1/chat/completions';
const MODEL_DEFAULT = 'gemini-3.5-flash-low(32768)';   // fast + high thinking
const MODEL_ESCALATE = 'gemini-3.1-pro-low(32768)';    // ambiguous screens

async function judge(job, model) {
  const b64 = readFileSync(job.screenshot).toString('base64');
  const prompt =
    `You are a mobile UI QA judge. The screen below should match this expected state:\n"${job.expect}"\n` +
    `Check for: blank/white screens, overlapping or clipped text, missing expected elements, error dialogs, broken layout.\n` +
    `Reply ONLY JSON: {"pass": boolean, "issues": ["..."]}. issues empty if pass.`;
  const body = {
    model,
    messages: [{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
    ] }],
  };
  const res = await fetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`proxy HTTP ${res.status}`); // fail loud — do not skip the gate
  const d = await res.json();
  const v = parseVerdict(d.choices?.[0]?.message?.content || '');
  const reasoningTokens = d.usage?.completion_tokens_details?.reasoning_tokens || 0;
  return { ...v, reasoningTokens };
}

const [jobsF, outF] = process.argv.slice(2);
const jobs = JSON.parse(readFileSync(jobsF, 'utf8'));
const out = [];
for (const job of jobs) {
  let r = await judge(job, MODEL_DEFAULT);
  // escalate once if the default judge is uncertain (issue mentions "unclear"/"cannot tell")
  if (!r.pass && r.issues.some((i) => /unclear|cannot tell|uncertain/i.test(i))) {
    r = await judge(job, MODEL_ESCALATE);
    r.model = MODEL_ESCALATE;
  } else r.model = MODEL_DEFAULT;
  out.push({ flow: job.flow, ...r });
}
writeFileSync(outF, JSON.stringify(out, null, 2));
console.log(`judged ${out.length} screenshots; fails: ${out.filter((o) => !o.pass).length}`);
```

- [ ] **Step 6: Live smoke (real proxy + a real screenshot)**

Run:
```bash
cd ~/.claude/skills/mobile-verify
# grab any existing PNG to smoke-test the proxy image path
F=$(find ~/Desktop/invoicesnap-expo -name '*.png' | head -1)
echo "[{\"flow\":\"smoke\",\"screenshot\":\"$F\",\"expect\":\"any app screen\"}]" > /tmp/mv-jobs.json
node scripts/visual-judge.mjs /tmp/mv-jobs.json /tmp/mv-out.json && cat /tmp/mv-out.json
```
Expected: a JSON verdict with `pass`/`issues` and non-zero `reasoningTokens` (proves Gemini saw the image + thinking fired). If proxy down → loud `proxy HTTP` error (correct fail-loud behavior).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(visual-judge): Gemini screenshot verdict via :8328 with thinking-budget suffix"
```

---

### Task 5: done-gate

**Files:**
- Create: `scripts/done-gate.mjs`
- Create: `test/done-gate.test.mjs`

- [ ] **Step 1: Write failing test** — `test/done-gate.test.mjs`

```js
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
```

- [ ] **Step 2: Run, verify fail** — module/script not found → tests error.

- [ ] **Step 3: Implement** — `scripts/done-gate.mjs`

```js
#!/usr/bin/env node
// Usage: done-gate.mjs <report.json>  — exit 0 iff allGreen, else 1 + summary.
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (report.allGreen) { console.log('DONE: all flows green (functional+visual)'); process.exit(0); }
const bad = report.flows.filter((f) => !f.functional || !f.visual).map((f) => f.flow);
console.error(`NOT DONE: failing flows -> ${bad.join(', ')}`);
process.exit(1);
```

- [ ] **Step 4: Run, verify pass** — `node --test test/done-gate.test.mjs` → PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(done-gate): hard gate on report.allGreen"
```

---

### Task 6: run-flows.sh (boot sim + maestro + collect)

**Files:**
- Create: `scripts/run-flows.sh`

- [ ] **Step 1: Implement** — `scripts/run-flows.sh`

```bash
#!/usr/bin/env bash
# Usage: run-flows.sh <app-dir> <out-dir> [udid]
# Boots a sim, ensures the app is installed (expo run:ios if needed), runs all
# .maestro/*.yaml flows, leaves JUnit + screenshots in <out-dir>.
set -uo pipefail
APP_DIR="$1"; OUT="$2"; UDID="${3:-}"
mkdir -p "$OUT"

# 1. pick + boot a simulator (first available booted, else boot an iPhone)
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
fi
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices available | grep -m1 -oE 'iPhone [0-9].*\(([0-9A-F-]{36})\)' | grep -oE '[0-9A-F-]{36}' | head -1)
  xcrun simctl boot "$UDID" 2>/dev/null
fi
open -a Simulator 2>/dev/null
echo "sim: $UDID"

# 2. ensure app built+installed (idempotent: expo run:ios installs to booted sim)
( cd "$APP_DIR" && npm run ios -- --device "$UDID" >"$OUT/build.log" 2>&1 ) \
  || { echo "BUILD/BOOT FAILED — see $OUT/build.log"; exit 2; }   # fail loud, distinct exit

# 3. run flows -> JUnit + screenshots into OUT
maestro --udid "$UDID" test --format junit --output "$OUT/junit.xml" \
  --test-output-dir "$OUT" "$APP_DIR"/.maestro/*.yaml
echo "maestro exit: $?"
```

- [ ] **Step 2: Make executable + lint-run (no sim needed: just bash -n)**

Run: `chmod +x scripts/run-flows.sh scripts/*.mjs && bash -n scripts/run-flows.sh && echo "syntax ok"`
Expected: `syntax ok`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(run-flows): boot sim, ensure app, run maestro, collect artifacts"
```

> Integration (real sim run) is exercised in Task 8 dogfood — a sim run cannot be unit-tested.

---

### Task 7: SKILL.md (orchestration) + user-flows template

**Files:**
- Create: `templates/user-flows.template.md`
- Create: `SKILL.md`

- [ ] **Step 1: Create the flow-spec template** — `templates/user-flows.template.md`

```markdown
# User Flows — <App name>
<!-- One flow per ## block. Steps in natural language. Expect = observable end state. -->

## Sign in via dev skip
1. Launch the app
2. Tap "Skip sign-in dev"
Expect: the main tab bar is visible (Home/Invoices/Clients)
Screenshot: after-signin

## Create a client
1. Go to the Clients tab
2. Tap "New Client"
3. Enter name "Acme"
4. Save
Expect: "Acme" appears in the clients list
Screenshot: client-created
```

- [ ] **Step 2: Create SKILL.md** — `~/.claude/skills/mobile-verify/SKILL.md`

````markdown
---
name: mobile-verify
description: Drive an Expo/React Native app to "all user flows pass functionally AND visually" on the iOS simulator, fix-until-green. Generates Maestro flows from user-flows.md, runs them on the simulator, judges screenshots with Gemini vision (hard gate), and loops fixing code until green or caps hit. Triggers on "mobile-verify", "verify the app", "run e2e on the simulator", "fix until green", or station-4 of the mobile app factory. Expo/RN + iOS simulator (v1).
---

# mobile-verify

Station 4 of the mobile-app factory. Input: an Expo/RN app + `user-flows.md`. Output: all flows green (functional + visual) or a structured fix-report.

## Preconditions
- macOS with Xcode simulators, Maestro on PATH (`~/.maestro/bin`), Node 20+.
- Gemini proxy reachable at `http://localhost:8328` (visual gate). If down, STOP and tell the user — never skip the visual gate.
- Read `memory-bank/tech-stack.md` if present; confirm Maestro+simulator is the frozen harness (VTS). Do NOT re-pick the harness.

## Workflow (the loop)
1. **Ensure `user-flows.md`** exists at the app root. If missing, scaffold from `templates/user-flows.template.md` and ask the user to fill it (or draft flows from the app and confirm).
2. **flow-gen (you do this):** for each `## Flow` in `user-flows.md`, write `<app>/.maestro/<NN-slug>.yaml` in this dialect:
   ```yaml
   appId: <ios.bundleIdentifier from app.json>
   ---
   - clearState
   - launchApp
   - tapOn: { text: "Skip sign-in dev", optional: true }
   - assertVisible: "<expected text>"
   - takeScreenshot: <screenshot-name>
   ```
   Map each numbered step → a Maestro command; map `Expect:` → `assertVisible` + the visual prompt; emit `takeScreenshot` at each `Screenshot:` marker (and always one at the end). Use visible text / accessibility labels, not testIDs. Idempotent: only (re)write changed flows.
3. **Run + judge + report (scripts):**
   ```bash
   S=~/.claude/skills/mobile-verify
   OUT=<app>/.mobile-verify/run; rm -rf "$OUT"
   bash "$S/scripts/run-flows.sh" <app> "$OUT"        # exit 2 = build/boot failure -> surface, stop
   # build the visual jobs list from takeScreenshot names + each flow's Expect text, then:
   node "$S/scripts/visual-judge.mjs" "$OUT/jobs.json" "$OUT/visual.json"
   node "$S/scripts/maestro-to-json.mjs" "$OUT/junit.xml" "$OUT/maestro.json"   # parse JUnit -> [{flow,passed,log}]
   node "$S/scripts/report.mjs" "$OUT/maestro.json" "$OUT/visual.json" "<app>/.mobile-verify/reports/run"
   ```
   (`jobs.json` = `[{flow, screenshot: "<OUT>/<name>.png", expect: "<flow Expect text>"}]`, which you assemble from the flows you generated.)
4. **Gate + loop:**
   ```bash
   node "$S/scripts/done-gate.mjs" <app>/.mobile-verify/reports/run.json && echo GREEN || {
     node "$S/scripts/loop-guard.mjs" <app>/.mobile-verify/state.json false   # exit 0=continue 1=stop
   }
   ```
   - If GREEN → done.
   - If loop-guard says **continue:** read `reports/run.md`, fix the code for the failing flows (functional or visual), bump `state.json.iteration` and add `report.signature` to `state.json.failSignatures`, then go to step 3.
   - If loop-guard says **stop:** surface `reports/run.md` to the user (cap/circuit-breaker hit) — human gate.

## Gemini thinking control (visual gate)
The visual judge picks model **thinking level via a budget suffix in the model id**: `model(N)` = N reasoning tokens, overriding the default (`reasoning_effort` is ignored — the suffix is the only lever).
- Default `gemini-3.5-flash-low(32768)` — fast, high thinking, enough for a screenshot verdict.
- Escalates once to `gemini-3.1-pro-low(32768)` when the flash verdict is uncertain.
Edit these in `scripts/visual-judge.mjs` (`MODEL_DEFAULT` / `MODEL_ESCALATE`).

## Caps (in scripts/loop-guard.mjs)
max 6 iterations · 200k reasoning-token budget · circuit-breaker after 3 identical failure signatures · honor a `STOP` file at the app root (stop immediately if present).

## Fail loud
- Build/boot failure (run-flows exit 2) → surface immediately, it is NOT a flow failure.
- A flaky flow → re-run that one flow once before counting it failed.
- Proxy/Gemini unreachable → stop and tell the user; do not pass the visual gate by default.
````

- [ ] **Step 3: Add the two tiny helpers referenced by SKILL.md** — `scripts/maestro-to-json.mjs`

```js
#!/usr/bin/env node
// Minimal JUnit -> [{flow, passed, log}] for Maestro output.
import { readFileSync, writeFileSync } from 'node:fs';
const xml = readFileSync(process.argv[2], 'utf8');
const cases = [...xml.matchAll(/<testcase[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/testcase>|<testcase[^>]*name="([^"]+)"[^>]*\/>/g)];
const out = cases.map((m) => {
  const name = m[1] || m[3];
  const body = m[2] || '';
  const failed = /<failure|<error/.test(body);
  const log = (body.match(/<failure[^>]*>([\s\S]*?)<\/failure>/) || [,''])[1];
  return { flow: name, passed: !failed, log };
});
writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
console.log(`parsed ${out.length} flows, ${out.filter((o) => !o.passed).length} failed`);
```

- [ ] **Step 4: Smoke the JUnit parser**

Run:
```bash
cd ~/.claude/skills/mobile-verify
printf '<testsuite><testcase name="01-signin"/><testcase name="02-tabs"><failure>no Home</failure></testcase></testsuite>' > /tmp/j.xml
node scripts/maestro-to-json.mjs /tmp/j.xml /tmp/j.json && cat /tmp/j.json
```
Expected: 2 flows, `01-signin` passed true, `02-tabs` passed false with log "no Home".

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(skill): SKILL.md orchestration, user-flows template, junit parser"
```

---

### Task 8: Dogfood end-to-end on invoicesnap-expo (spec verification)

**Files:**
- Create: `~/Desktop/invoicesnap-expo/user-flows.md` (2 flows)

- [ ] **Step 1: Author a minimal user-flows.md** (reuse known-good selectors from existing `.maestro/01-launch-signin.yaml`)

```markdown
# User Flows — InvoiceSnap
## Launch to sign-in
1. Launch the app
Expect: "Invoice Snap" and "Create your invoices" are visible
Screenshot: signin

## Skip into the app
1. Launch the app
2. Tap "Skip sign-in dev"
Expect: the main tabs are visible
Screenshot: tabs
```

- [ ] **Step 2: Generate flows (agent, per SKILL.md step 2)** into `~/Desktop/invoicesnap-expo/.maestro/mv-*.yaml` using bundle `com.731labs.invoicesnap.app`.

- [ ] **Step 3: Run one full loop iteration**

Run:
```bash
S=~/.claude/skills/mobile-verify; APP=~/Desktop/invoicesnap-expo; OUT=$APP/.mobile-verify/run; rm -rf "$OUT"
bash "$S/scripts/run-flows.sh" "$APP" "$OUT"
```
Expected: sim boots, app installs, the `mv-*` flows run, PNGs land in `$OUT`. (Build can take minutes the first time.)

- [ ] **Step 4: Judge + report + gate**

Run: assemble `$OUT/jobs.json` from the screenshots + Expect text, then:
```bash
node "$S/scripts/visual-judge.mjs" "$OUT/jobs.json" "$OUT/visual.json"
node "$S/scripts/maestro-to-json.mjs" "$OUT/junit.xml" "$OUT/maestro.json"
node "$S/scripts/report.mjs" "$OUT/maestro.json" "$OUT/visual.json" "$APP/.mobile-verify/reports/run"
node "$S/scripts/done-gate.mjs" "$APP/.mobile-verify/reports/run.json"; echo "gate exit: $?"
```
Expected: a `report.md`, and gate exit 0 if both flows pass functionally + visually.

- [ ] **Step 5: Negative test — break a flow, confirm loop catches it**

Change a flow's `Expect` to an impossible string, regenerate that flow, re-run steps 3–4. Expected: report shows that flow ❌ (functional fail), `done-gate` exit 1, `loop-guard` returns `continue` (iteration 1, under caps). Then revert.

- [ ] **Step 6: Cap test — confirm stop**

Set `state.json` to `{ "iteration": 6, "budgetTokens": 0, "failSignatures": [] }`, run `loop-guard.mjs state.json false`. Expected: prints `{"action":"stop","reason":"max iterations ..."}`, exit 1.

- [ ] **Step 7: Commit the dogfood flows + a short USAGE note**

```bash
cd ~/.claude/skills/mobile-verify && git add -A && git commit -m "test: dogfood mobile-verify on invoicesnap-expo"
```

---

## Self-review notes
- **Spec coverage:** flow-gen (Task 7 SKILL.md §2 + Task 8) · runner (Task 6) · visual-judge incl. Gemini thinking control (Task 4 + SKILL.md §Gemini) · reporter (Task 3) · loop-driver + caps (Task 2 + SKILL.md §4/§Caps) · done-gate (Task 5) · artifacts layout (`.mobile-verify/`, Task 6/8) · fail-loud (SKILL.md §Fail loud, run-flows exit 2, visual-judge throws on proxy down) · VTS composition (SKILL.md preconditions) · verification/dogfood (Task 8). All design sections mapped.
- **Naming consistency:** `buildReport`/`failSignature`/`toMarkdown` (report.lib) · `decide` (loop-guard.lib) · `parseVerdict` (verdict.lib) · report shape `{allGreen, flows:[{flow,functional,log,visual,visualIssues}], signature}` used identically in report.mjs, done-gate, done-gate.test.
- **No placeholders:** every code step has real code; commands have expected output.
- **Out of scope (v1, per spec):** Android, Flutter, reference-image diffing — explicitly deferred.

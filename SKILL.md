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
     # loop-guard reads the report, increments iteration, appends signature, writes state back.
     node "$S/scripts/loop-guard.mjs" <app>/.mobile-verify/state.json \
       <app>/.mobile-verify/reports/run.json   # exit 0=continue 1=stop
   }
   ```
   - If GREEN → done.
   - If loop-guard says **continue:** read `reports/run.md`, fix the code for the failing flows (functional or visual), then go to step 3. (loop-guard owns state.json — do NOT hand-edit it.)
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

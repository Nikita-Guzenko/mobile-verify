# mobile-verify — Design

**Date:** 2026-06-09 · **Status:** design (pending review)
Claude Code skill. Station 4 of the mobile-app factory: drive an Expo/RN app to "all user flows pass — functionally **and** visually" on the iOS simulator, fix-until-green.

## Scope (locked)
- Flows: `user-flows.md` → agent generates Maestro YAML.
- Visual QA: Gemini-vision on screenshots = **hard gate**.
- Loop: self-contained fix-until-green with caps.
- Platform v1: **Expo/React Native, iOS simulator** (Maestro). Flutter/Android later (same Maestro).

## Interface
- **In:** Expo project path (auto-detect) + `user-flows.md` + optional simulator id.
- **Out:** `ALL FLOWS GREEN (functional+visual)` (exit 0) — or a structured `fix-report` (nonzero).
- One job: app passes every flow functionally and visually. Nothing else.

## Components (isolated units)
- **flow-gen** — parse `user-flows.md` → `.maestro/<flow>.yaml` (steps + assertions + `takeScreenshot` points). Idempotent.
- **runner** — build + boot app on iOS simulator; run each flow; capture pass/fail, Maestro output, device logs, screenshots.
- **visual-judge** — send key screenshots to Gemini (`:8328`) with the flow's expected-state text → `{pass, issues[]}`. Hard gate. (Thinking control: §Gemini.)
- **reporter** — merge functional + visual into one `fix-report` (per flow: failure, log excerpt, screenshot path, visual issues).
- **loop-driver** — `run → green? DONE : fix-report → agent fixes → re-run`, until green or caps hit.
- **done-gate** — done ⇔ every flow green functionally AND visual verdict passes. The enforced verification contract.

## Artifacts (next to the app)
```
<app>/user-flows.md            # source of flows (you/agent)
<app>/.maestro/<flow>.yaml      # generated
<app>/.mobile-verify/
   screenshots/<flow>/*.png
   reports/<run-ts>.json        # structured result
   state.json                   # iterations, budget spent
```

## user-flows.md format
Per flow: `## <Flow name>` → numbered steps (natural language) → `Expect:` (observable end state, used by both Maestro assertions and the visual judge) → optional `Screenshot:` markers. flow-gen maps steps→Maestro commands, `Expect`→assertion + visual prompt.

## Gemini thinking control (visual-judge)
Proxy `:8328`, antigravity models. Thinking level = **budget suffix in the id**: `model(N)` (N reasoning tokens), overrides default; `reasoning_effort` is ignored — suffix is the only lever.
- Default `gemini-3.5-flash-low(32768)` — fast + high thinking, enough for a screenshot verdict.
- Ambiguous/complex screen → escalate `gemini-3.1-pro-low(32768)`.
- Images: native `:generateContent` (`inlineData`) or `image_url` data-URL.
- Thinking budget counts toward the loop cap.

## Composition
Reads VTS-frozen `memory-bank/tech-stack.md` (does not re-pick the harness). Verdict format compatible with `visual-verdict` skill. Is the station-4 the factory calls; loop integrates with vibe-coding verification-contract discipline.

## Error handling (fail loud)
Build/boot failure → surface immediately (not a "flow fail"; 1 boot retry). Flaky flow → 1 retry before counting fail. **Gemini proxy down → fail loud, never silently skip the visual gate.** Cap hit → stop + report + human gate.

## Autonomy / caps
max-iterations (default 6) · token budget (proxy) · `STOP` file · circuit-breaker on N identical failures. Human only on stuck/cap.

## Build approach
Deterministic scaffold + agent on creative spots: bash/node scripts do build/boot/run/screenshot/Gemini-call/loop; agent does flow authoring nuance + code fixes. (Rejected: pure-prompt skill — loop/screenshot pipeline drifts; standalone CLI — overkill, that's mini-fspec.)

## Verification (of the skill itself)
Dogfood on `invoicesnap-expo`: author 2–3 `user-flows.md` flows → run mobile-verify → confirm it (a) generates Maestro YAML, (b) boots sim + runs flows, (c) screenshots + Gemini verdict fire, (d) a deliberately broken flow produces a fix-report and the loop converges to green, (e) caps stop a genuinely unfixable flow with a human-readable report.

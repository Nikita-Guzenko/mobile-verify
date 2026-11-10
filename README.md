# mobile-verify

A Claude Code skill that finds bugs in Expo / React Native apps.

It runs every user flow of the app on the iOS simulator with [Maestro](https://maestro.mobile.dev). Gemini vision checks each screenshot. The agent fixes the code and runs the flows again until every flow works **and** looks correct.

```
user-flows.md → Maestro YAML → simulator run → works? + looks correct? → green = done
                                                    └── no → fix code → run again
```

- Limits: 6 iterations, 200k-token budget, stop after 3 identical failures, `STOP` file.
- No silent green: a failed Gemini call or zero screenshots fails the gate.
- v1: Expo / React Native + iOS simulator (macOS).

## Install

```bash
git clone https://github.com/Nikita-Guzenko/mobile-verify ~/.claude/skills/mobile-verify
```

Needs: Xcode simulator, Maestro, Node 18+, an OpenAI-compatible endpoint for Gemini at `localhost:8328` (see `scripts/visual-judge.mjs`).

## Files

- `SKILL.md` — the agent instructions.
- `scripts/` — `run-flows.sh`, `maestro-to-json`, `visual-judge`, `done-gate`, `loop-guard`, `report`.
- `lib/` — pure logic; `npm test` runs 24 tests.
- `templates/user-flows.template.md` — how to write the flows.
- `docs/` — design and implementation plan.

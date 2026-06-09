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

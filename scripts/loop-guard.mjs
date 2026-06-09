#!/usr/bin/env node
// Usage: loop-guard.mjs <stateFile> <reportFile>
// reportFile: report.json produced by report.mjs — has .allGreen and .signature.
// Reads state, increments iteration, appends signature on failure, calls decide(),
// writes state back, prints decision JSON. Exit 0=continue, 1=stop.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { decide } from '../lib/loop-guard.lib.mjs';

const [stateFile, reportFile] = process.argv.slice(2);
const caps = { maxIterations: 6, maxBudgetTokens: 200000, breakerRepeats: 3 };

const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { iteration: 0, budgetTokens: 0, failSignatures: [] };

const report = JSON.parse(readFileSync(reportFile, 'utf8'));
const green = report.allGreen;

// Update state before calling decide so decide sees the post-increment values.
state.iteration = (state.iteration || 0) + 1;
if (!green) state.failSignatures.push(report.signature);

const d = decide(state, caps, green);
console.log(JSON.stringify(d));
writeFileSync(stateFile, JSON.stringify(state, null, 2));
process.exit(d.action === 'continue' ? 0 : 1);

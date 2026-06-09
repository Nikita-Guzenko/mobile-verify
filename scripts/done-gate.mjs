#!/usr/bin/env node
// Usage: done-gate.mjs <report.json>  — exit 0 iff allGreen, else 1 + summary.
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (report.allGreen) { console.log('DONE: all flows green (functional+visual)'); process.exit(0); }
const bad = report.flows.filter((f) => !f.functional || !f.visual).map((f) => f.flow);
console.error(`NOT DONE: failing flows -> ${bad.join(', ')}`);
process.exit(1);

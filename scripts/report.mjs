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

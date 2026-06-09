#!/usr/bin/env node
// Minimal JUnit -> [{flow, passed, log}] for Maestro output.
import { readFileSync, writeFileSync } from 'node:fs';
const xml = readFileSync(process.argv[2], 'utf8');
const cases = [...xml.matchAll(/<testcase[^>]*name="([^"]+)"[^>]*\/>|<testcase[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/testcase>/g)];
const out = cases.map((m) => {
  const name = m[1] || m[2];
  const body = m[3] || '';
  const failed = /<failure|<error/.test(body);
  const log = (body.match(/<failure[^>]*>([\s\S]*?)<\/failure>/) || [,''])[1];
  return { flow: name, passed: !failed, log };
});
writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
console.log(`parsed ${out.length} flows, ${out.filter((o) => !o.passed).length} failed`);

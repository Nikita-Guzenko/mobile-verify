#!/usr/bin/env node
// Usage: visual-judge.mjs <jobs.json> <out.json>
// jobs.json: [{ flow, screenshot: "/abs/path.png", expect: "expected end state text" }]
// out.json:  [{ flow, pass, issues, model, reasoningTokens }]
// Thinking control: model id carries the budget suffix `model(N)`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseVerdict } from '../lib/verdict.lib.mjs';

const PROXY = 'http://localhost:8328/v1/chat/completions';
const MODEL_DEFAULT = 'gemini-3.5-flash-low(32768)';   // fast + high thinking
const MODEL_ESCALATE = 'gemini-3.1-pro-low(32768)';    // ambiguous screens
const FETCH_TIMEOUT_MS = 30_000;

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
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
  // Guard: if screenshot file is missing, record a fail and continue rather than throwing.
  if (!existsSync(job.screenshot)) {
    out.push({ flow: job.flow, pass: false, issues: ['screenshot missing'], model: MODEL_DEFAULT, reasoningTokens: 0 });
    continue;
  }
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

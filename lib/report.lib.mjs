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

// Parse a Gemini visual verdict. Fail CLOSED: if we can't parse, it's a fail.
export function parseVerdict(text) {
  const s = String(text || '').replace(/^```[a-z]*\n?/i, '');
  const i = s.indexOf('{');
  if (i >= 0) {
    try {
      const [obj] = rawDecode(s, i);
      return { pass: !!obj.pass, issues: Array.isArray(obj.issues) ? obj.issues : [] };
    } catch { /* fall through */ }
  }
  return { pass: false, issues: ['could not parse model verdict — failing closed'] };
}

// Decode one JSON object starting at index i, ignoring trailing junk.
function rawDecode(s, i) {
  for (let end = s.length; end > i; end--) {
    try { return [JSON.parse(s.slice(i, end))]; } catch {}
  }
  throw new Error('no json');
}

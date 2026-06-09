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
// Tries JSON.parse(s.slice(i)) FIRST (forward, from first '{' to end of string).
// Only falls back to the shrink-from-end loop if the forward parse fails,
// so a complete object is never mis-truncated.
function rawDecode(s, i) {
  // Forward attempt: the whole tail from the first '{'.
  try { return [JSON.parse(s.slice(i))]; } catch {}
  // Fallback: shrink from end, one char at a time, until a valid object is found.
  for (let end = s.length - 1; end > i; end--) {
    try { return [JSON.parse(s.slice(i, end))]; } catch {}
  }
  throw new Error('no json');
}

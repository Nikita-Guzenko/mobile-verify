// Decide whether the fix-until-green loop should continue or stop.
// state: { iteration:int, budgetTokens:int, failSignatures:string[] (most recent last) }
// caps: { maxIterations, maxBudgetTokens, breakerRepeats }
// green: boolean (latest report all-green functional+visual)
export function decide(state, caps, green) {
  if (green) return { action: 'stop', reason: 'all flows green (functional+visual)' };
  if (state.iteration >= caps.maxIterations)
    return { action: 'stop', reason: `max iterations (${caps.maxIterations}) reached` };
  if (state.budgetTokens >= caps.maxBudgetTokens)
    return { action: 'stop', reason: `token budget (${caps.maxBudgetTokens}) exceeded` };
  const sigs = state.failSignatures || [];
  const n = caps.breakerRepeats;
  if (sigs.length >= n) {
    const tail = sigs.slice(-n);
    if (tail.every((s) => s && s === tail[0]))
      return { action: 'stop', reason: `circuit-breaker: identical failure ${n}x — needs human` };
  }
  return { action: 'continue', reason: 'under caps, not green' };
}

// src/diff.js
export function diffSnapshots(previous, current) {
  const promotions = [];
  const demotions = [];
  if (!previous || !previous.players) return { promotions, demotions };
  const prev = previous.players;
  const curr = current.players;
  for (const tag of Object.keys(curr)) {
    const before = prev[tag];
    const after = curr[tag];
    if (!before) continue;
    if (before.tier === 'II' && after.tier === 'I') promotions.push({ tag, name: after.name });
    else if (before.tier === 'I' && after.tier === 'II') demotions.push({ tag, name: after.name });
  }
  return { promotions, demotions };
}

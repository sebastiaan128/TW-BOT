import { eventId } from './store.js';
import { battleTimestamp } from './seasons.js';

// Stable identity when the API supplies one. Otherwise reconcile whole ordered
// windows with overlap; repeated equal attacks are occurrences, not a Set.
export function battleKey(b) {
  if (b.id ?? b.battleId) return eventId('id', b.id ?? b.battleId);
  return eventId(b.battleTimestamp ?? (typeof b.battleTime === 'string' ? b.battleTime : null), b.battleType, b.attack, b.opponentPlayerTag,
    b.destructionPercentage, b.stars, b.trophies ?? null, b.trophyChange ?? null);
}
export function reconcileBattles(items, previous, { now = Date.now(), season, player } = {}) {
  // Current API can return oldest-first; timestamps make order explicit.
  if (items.length && items.every((b) => Number.isFinite(battleTimestamp(b)))) items = [...items].sort((a, b) => battleTimestamp(b) - battleTimestamp(a));
  const keys = items.map(battleKey);
  let count = 0, gap = false;
  const timestamped = items.length > 0 && items.every((b) => Number.isFinite(battleTimestamp(b)));
  if (previous) {
    if (keys.length && previous.keys?.length) {
      // Newest-first window: choose the earliest (conservative) overlap to avoid
      // duplicate posts when identical battles cannot be distinguished.
      let offset = -1;
      for (let i = 0; i < keys.length; i++) {
        const length = Math.min(keys.length - i, previous.keys.length);
        if (length > 0 && keys.slice(i, i + length).every((key, j) => key === previous.keys[j])) { offset = i; break; }
      }
      if (offset < 0) gap = true; else count = offset;
    } else if (!previous.keys?.length) count = keys.length;
  }
  const sequence = previous?.sequence ?? 0;
  let candidates = items.slice(0, count);
  if (timestamped && previous && Number.isFinite(previous.latestTimestamp)) {
    const previousKeys = new Set(previous.keys);
    candidates = items.filter((b, i) => battleTimestamp(b) > previous.latestTimestamp || (battleTimestamp(b) === previous.latestTimestamp && !previousKeys.has(keys[i])));
    count = candidates.length;
  }
  const newBattles = candidates.map((battle, index) => ({
    id: eventId('attack', player, battle.id ?? battle.battleId ?? (Number.isFinite(battleTimestamp(battle)) ? [battleTimestamp(battle), battleKey(battle)] : [sequence + count - index, battleKey(battle)])),
    battle, observedAt: now, season: String(battle.leagueSeasonId ?? battle.seasonId ?? season),
    occurredAt: Number.isFinite(battleTimestamp(battle)) ? battleTimestamp(battle) : null,
  }));
  return { newBattles, gap, state: { keys, sequence: sequence + count, seenAt: now, season, latestTimestamp: timestamped ? Math.max(...items.map(battleTimestamp)) : (previous?.latestTimestamp ?? (items.length ? null : 0)) } };
}
export function validBattle(b) {
  return b && typeof b.attack === 'boolean' && typeof b.battleType === 'string'
    && typeof b.opponentPlayerTag === 'string' && Number.isInteger(b.stars) && b.stars >= 0 && b.stars <= 3
    && Number.isFinite(b.destructionPercentage) && b.destructionPercentage >= 0 && b.destructionPercentage <= 100;
}

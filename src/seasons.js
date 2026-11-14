import { fetchLeagueSeasons, fetchPlayer } from './coc.js';

export function apiTime(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (typeof value !== 'string') return NaN;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/);
  return Date.parse(m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : value);
}
// Season convention verified against ClashPerk Util.getSeason (2026-11-14):
// https://github.com/clashperk/clashofclans.js/blob/main/src/util/Util.ts
// IDs advance monthly, but boundaries advance 28 days from 2025-10-06 05:00 UTC.
export function clashPerkSeason(now = Date.now()) {
  const anchor = Date.parse('2025-10-06T05:00:00Z');
  if (now < anchor) throw new Error('ClashPerk fallback supports seasons from October 2025 onward');
  const n = Math.floor((now - anchor) / (28 * 86400000));
  const month = new Date(Date.UTC(2025, 9 + n, 1)).toISOString().slice(0, 7);
  return { id: String((anchor + n * 28 * 86400000) / 1000), label: month, start: anchor + n * 28 * 86400000, end: anchor + (n + 1) * 28 * 86400000, source: 'clashperk-convention', fetchedAt: now };
}
export async function resolveSeason(config, players, { now = Date.now(), catalog = fetchLeagueSeasons, player = fetchPlayer } = {}) {
  let apiError;
  try {
    const data = await catalog(config.seasons.leagueId, config.cocApiKey);
    if (!Array.isArray(data.items)) throw new Error('Season API returned no items');
    const current = data.items.find((s) => apiTime(s.startTime) <= now && apiTime(s.endTime) > now)
      ?? data.items.find((s) => s.isCurrent === true || s.current === true);
    if (current && (current.id ?? current.leagueSeasonId)) return {
      id: String(current.id ?? current.leagueSeasonId),
      ...(Number.isFinite(apiTime(current.startTime)) ? { start: apiTime(current.startTime) } : {}),
      ...(Number.isFinite(apiTime(current.endTime)) ? { end: apiTime(current.endTime) } : {}),
      source: 'coc-api', fetchedAt: now,
    };
    const ids = new Set();
    for (const p of players.slice(0, 2)) {
      const profile = await player(p.tag, config.cocApiKey);
      const id = (p.tier !== 'II' && (profile.leagueTier?.id == null || profile.leagueTier.id === 105000036) ? profile.currentLeagueSeasonId : undefined) ?? profile.leagueSeason?.id ?? profile.leagueSeasonId ?? profile.legendStatistics?.currentSeason?.id;
      if (id != null) ids.add(String(id));
    }
    if (ids.size !== 1) throw new Error('No unambiguous current season in CoC API');
    const id = [...ids][0];
    const convention = clashPerkSeason(now);
    if (/^\d{10}$/.test(id)) {
      const start = Number(id) * 1000;
      if (start > now || now >= start + 28 * 86400000) throw new Error('Player season is outside current 28-day window');
      return { id, start, end: start + 28 * 86400000, source: 'coc-api/player', boundarySource: 'clashperk-28-days', fetchedAt: now };
    }
    return { ...(id === convention.label ? convention : {}), id: id === convention.label ? convention.id : id, apiId: id, source: 'coc-api/player', fetchedAt: now };
  } catch (error) { apiError = error.message; }
  if (config.seasons.fallback !== 'clashperk') throw new Error(`Season unavailable: ${apiError}`);
  return { ...clashPerkSeason(now), warning: apiError };
}
export function battleTimestamp(battle) {
  // Current API: battleTime is duration in seconds; battleTimestamp is UTC time.
  const raw = battle.battleTimestamp ?? (typeof battle.battleTime === 'string' ? battle.battleTime : undefined);
  return apiTime(raw);
}
export function seasonForBattle(battle, season, now) {
  const explicit = battle.leagueSeasonId ?? battle.seasonId;
  if (explicit != null) return { id: String(explicit), attribution: 'api' };
  const timestamp = battleTimestamp(battle);
  if (Number.isFinite(timestamp)) {
    if (season.start != null && season.end != null && timestamp >= season.start && timestamp < season.end) return { id: season.id, attribution: 'timestamp' };
    if (season.source.startsWith('clashperk') || (season.start === clashPerkSeason(now).start && season.end === clashPerkSeason(now).end)) return { id: clashPerkSeason(timestamp).id, attribution: 'clashperk-timestamp' };
    return { id: 'unassigned', attribution: 'outside-current-season' };
  }
  // Without timestamps, a window crossing a reset cannot be assigned honestly.
  return { id: season.id, attribution: 'observed' };
}

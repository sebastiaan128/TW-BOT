import { collectMembers, fetchBattleLog } from './coc.js';
import { confirmMovements } from './movements.js';
import { resetWindow } from './calendar.js';
import { eventId } from './store.js';
import { reconcileBattles, validBattle, battleKey } from './battles.js';
import { resolveSeason, seasonForBattle, battleTimestamp } from './seasons.js';
import { withRetry } from './util.js';

const DAY = 86400000;
export async function scanMovements(store, config, { markSeen = false, preview = false, now = Date.now(), ...deps } = {}) {
  return store.locked('movements', async (assertLease) => {
    const coverage = await (deps.collectMembers ?? collectMembers)(config.clanTags, config.cocApiKey);
    const state = store.get('movements', { players: {}, pending: {} });
    const window = resetWindow(new Date(now), { timeZone: config.timeZone, ...config.movements });
    const remembered = {}, currentTiers = {}, names = {}, pending = {};
    const players = structuredClone(state.players);
    const present = new Set(coverage.players.map((p) => p.tag));
    for (const [tag, player] of Object.entries(players)) {
      if (Date.parse(player.seenAt) < now - config.movements.maxMemoryDays * DAY) { delete players[tag]; continue; }
      // A successful roster proves the player left that clan. Failed rosters
      // cannot prove departure. A returning player is seeded without a claim.
      if (!present.has(tag) && coverage.succeeded.includes(player.clan)) {
        player.departed = true; player.tier = 'unknown';
      }
      remembered[tag] = player.departed ? 'unknown' : player.tier;
    }
    for (const p of coverage.players) {
      names[p.tag] = p.name;
      currentTiers[p.tag] = p.tier;
      const old = players[p.tag];
      if (p.tier === 'unknown' || old?.departed || old?.tier === 'unknown' || !old) delete remembered[p.tag];
      players[p.tag] = { ...old, name: p.name, clan: p.clan, seenAt: new Date(now).toISOString(), departed: false };
    }
    for (const [tag, held] of Object.entries(state.pending ?? {})) {
      if (held.reset === window.key && players[tag] && !players[tag].departed && remembered[tag] !== undefined) pending[tag] = held;
    }
    const confirmed = confirmMovements({ remembered, currentTiers, pending, names, now,
      maxAgeMs: config.movements.recoveryDays * DAY, minAgeMs: config.movements.confirmationMinutes * 60000 });
    const jobs = markSeen ? [] : [
      ...confirmed.promotions.map((p) => ({ ...p, type: 'promoted' })),
      ...confirmed.demotions.map((p) => ({ ...p, type: 'demoted' })),
    ];
    const nextPending = {};
    for (const [tag, entry] of Object.entries(confirmed.pending)) if (players[tag] && !players[tag].departed && entry.at && Date.parse(entry.at) >= now - config.movements.recoveryDays * DAY) nextPending[tag] = { ...entry, reset: window.key };
    for (const [tag, tier] of Object.entries(markSeen ? currentTiers : confirmed.tiers)) players[tag].tier = tier;
    const events = jobs.map((job) => ({ id: eventId('movement', window.key, job.tag, job.type), type: job.type, player: job.tag, clan: players[job.tag]?.clan, payload: { name: job.name, reset: window.key } }));
    assertLease();
    if (!preview) store.transaction(() => {
      for (const event of events) store.enqueue(event, now);
      store.set('movements', { players, pending: markSeen ? {} : nextPending, reset: window.key });
      store.set('health:movements', { at: now, players: coverage.players.length, failed: coverage.failed, pending: Object.keys(nextPending).length });
    });
    return { events, pending: nextPending, coverage: { failed: coverage.failed, players: coverage.players.length }, marked: markSeen };
  });
}

export async function scanAttacks(store, config, { markSeen = false, preview = false, now = Date.now(), ...deps } = {}) {
  return store.locked('attacks', async (assertLease) => {
    const coverage = await (deps.collectMembers ?? collectMembers)(config.clanTags, config.cocApiKey);
    const players = coverage.players.filter((p) => config.oneStar.tiers.includes(p.tier));
    if (!players.length) {
      const health = { at: now, players: 0, failed: coverage.failed, gaps: [] };
      if (!preview) store.set('health:attacks', health);
      return { events: [], ...health };
    }
    const season = await (deps.resolveSeason ?? resolveSeason)(config, players, { now });
    const events = [], failed = [...coverage.failed], gaps = [];
    for (const player of players) {
      let items;
      try {
        items = await withRetry(() => (deps.fetchBattleLog ?? fetchBattleLog)(player.tag, config.cocApiKey), { retries: 2, baseDelayMs: 300, sleep: deps.sleep });
        if (!Array.isArray(items) || items.some((b) => !validBattle(b))) throw new Error('Invalid battlelog payload');
      } catch (error) { failed.push({ player: player.tag, error: error.message }); continue; }
      const previous = store.get(`battles:${player.tag}`);
      const result = reconcileBattles(items, previous, { player: player.tag, now, season: season.id });
      if (result.gap) gaps.push(player.tag);
      const attacks = [], playerEvents = [];
      // Backfill timestamped first-window attacks into statistics, never into
      // notifications. Unique timestamp identities match subsequent scans.
      const history = !previous ? items.filter((b) => Number.isFinite(battleTimestamp(b))).map((battle) => ({
        battle, historical: true, id: eventId('attack', player.tag, battle.id ?? battle.battleId ?? [battleTimestamp(battle), battleKey(battle)]),
      })) : [];
      if (!markSeen) for (const observed of [...history, ...result.newBattles]) {
        const b = observed.battle;
        if (b.battleType !== 'legend' || !b.attack) continue;
        let attribution = seasonForBattle(b, season, now);
        // A timestamp-less window spanning a season boundary is ambiguous.
        if (previous?.season && previous.season !== season.id && attribution.attribution === 'observed') attribution = { id: 'unassigned', attribution: 'boundary-unknown' };
        attacks.push({ id: observed.id, season: attribution.id, player: player.tag, name: player.name, clan: player.clan,
          stars: b.stars, destruction: b.destructionPercentage, observed: now, attribution: attribution.attribution });
        if (observed.historical || !config.oneStar.stars.includes(b.stars) || b.destructionPercentage < config.oneStar.minDestruction || b.destructionPercentage > config.oneStar.maxDestruction || config.oneStar.ignoredPlayers.includes(player.tag)) continue;
        playerEvents.push({ id: observed.id, type: 'onestar', player: player.tag, clan: player.clan,
          payload: { name: player.name, opponent: b.opponentPlayerTag, destruction: b.destructionPercentage, stars: b.stars, season: attribution.id } });
      }
      assertLease();
      if (!preview) store.transaction(() => {
        for (const attack of attacks) store.recordAttack(attack);
        for (const event of playerEvents) store.enqueue(event, now);
        store.set(`battles:${player.tag}`, result.state);
      });
      events.push(...playerEvents);
    }
    if (!preview) store.transaction(() => {
      store.set('season', season);
      store.set(`season:${season.id}`, season);
      const quality = store.get(`coverage:${season.id}`, { gaps: 0, failures: 0, scans: 0 });
      store.set(`coverage:${season.id}`, { gaps: quality.gaps + gaps.length, failures: quality.failures + failed.length, scans: quality.scans + 1, lastScan: now });
      store.set('health:attacks', { at: now, players: players.length, failed, gaps, season: season.id, seasonSource: season.source });
      if (!store.get('trackingStartedAt')) store.set('trackingStartedAt', now);
    });
    return { events, failed, gaps, season, marked: markSeen };
  });
}

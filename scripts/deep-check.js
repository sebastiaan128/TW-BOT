// scripts/deep-check.js — per-clan deep audit of Legend tiers & movements.
// Lists every Legend player per clan, current tier vs last completed-season
// tier, the season id, and flags moves — including ones skipped as stale.
import { loadConfig } from '../src/config.js';
import {
  fetchClanMembers, fetchLeagueHistory, latestHistoryEntry,
  getTier, tierFromId,
} from '../src/coc.js';
import { withRetry } from '../src/util.js';

const cfg = loadConfig();
const tags = cfg.clanTags;
const key = cfg.cocApiKey;

// First pass: collect all current Legend members across clans (to know the
// global latest completed season the bot would compare against).
const rows = [];
for (const tag of tags) {
  let members;
  try {
    members = await withRetry(() => fetchClanMembers(tag, key));
  } catch (e) {
    console.log(`\n=== ${tag} === ERROR: ${e.message}`);
    continue;
  }
  const legends = members.filter((m) => getTier(m));
  const clanRows = [];
  for (const m of legends) {
    const items = await withRetry(() => fetchLeagueHistory(m.tag, key));
    const last = latestHistoryEntry(items);
    clanRows.push({
      clan: tag, name: m.name, tag: m.tag,
      cur: getTier(m),
      prev: tierFromId(last?.leagueTierId ?? null),
      prevSeason: last?.leagueSeasonId ?? null,
    });
    rows.push(clanRows[clanRows.length - 1]);
  }
  // print per clan
  console.log(`\n=== ${tag} ===  (${legends.length} Legend member${legends.length === 1 ? '' : 's'})`);
  for (const r of clanRows) {
    console.log(`  ${r.name.padEnd(22)} ${r.tag.padEnd(12)} prev=${String(r.prev).padEnd(4)} cur=${String(r.cur).padEnd(4)} season=${r.prevSeason}`);
  }
}

const season = rows.reduce((mx, r) => (r.prevSeason && r.prevSeason > mx ? r.prevSeason : mx), 0) || null;

const promotions = [];
const demotions = [];
const stale = [];
for (const r of rows) {
  if (r.prevSeason !== season) { if (r.prev) stale.push(r); continue; }
  if (r.prev === 'II' && r.cur === 'I') promotions.push(r);
  else if (r.prev === 'I' && r.cur === 'II') demotions.push(r);
}

console.log('\n================ SUMMARY ================');
console.log('Latest completed season:', season);
console.log(`Total Legend members across ${tags.length} clans:`, rows.length);
console.log(`\nPROMOTIONS (${promotions.length}):`);
promotions.forEach((r) => console.log(`  ${r.name}  ${r.tag}  [${r.clan}]`));
console.log(`\nDEMOTIONS (${demotions.length}):`);
demotions.forEach((r) => console.log(`  ${r.name}  ${r.tag}  [${r.clan}]`));
console.log(`\nSKIPPED (stale history, not on latest season) (${stale.length}):`);
stale.forEach((r) => console.log(`  ${r.name}  ${r.tag}  prev=${r.prev} cur=${r.cur} season=${r.prevSeason}  [${r.clan}]`));

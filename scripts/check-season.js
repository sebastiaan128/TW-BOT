// scripts/check-season.js
// Quick manual check: has a NEW Legend ranked week appeared in the CoC API yet?
// Compares the newest leaguehistory week ID against a baseline (the last
// announced week, default read from data/last-snapshot.json). Samples up to 20
// Legend players across config.json clanTags.
// Usage: node --env-file=.env scripts/check-season.js [baselineSeasonId]
import { readFileSync } from 'node:fs';

const key = process.env.COC_API_KEY;
if (!key) { console.error('COC_API_KEY not set (run with --env-file=.env)'); process.exit(1); }

// Baseline = the last week we already announced. A newer week ID means the new
// ranked week has started and there are fresh results to post.
let baseline = Number(process.argv[2]);
if (!baseline) {
  try { baseline = JSON.parse(readFileSync('data/last-snapshot.json', 'utf8')).lastAnnouncedSeason; }
  catch { baseline = 1781499600; }
}

const B = 'https://api.clashofclans.com/v1';
const H = { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } };
const cfg = JSON.parse(readFileSync('config.json', 'utf8'));
const dateOf = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : 'n/a');

let checked = 0;
let newest = 0;
outer: for (const ct of cfg.clanTags) {
  let members;
  try { members = (await fetch(`${B}/clans/${encodeURIComponent(ct)}/members`, H).then((r) => r.json())).items; }
  catch { continue; }
  for (const m of members) {
    const id = m.leagueTier?.id;
    if (id !== 105000036 && id !== 105000035) continue; // Legend 1 / Legend 2 only
    checked++;
    try {
      const hist = (await fetch(`${B}/players/${encodeURIComponent(m.tag)}/leaguehistory`, H).then((r) => r.json())).items || [];
      for (const h of hist) if (h.leagueSeasonId > newest) newest = h.leagueSeasonId;
    } catch { /* skip this player */ }
    if (checked >= 20) break outer;
  }
}

const ready = newest > baseline;
console.log(`${new Date().toISOString()} | sampled ${checked} Legend players`);
console.log(`baseline (last announced week): ${baseline} (${dateOf(baseline)})`);
console.log(`newest week in the API now:     ${newest} (${dateOf(newest)})`);
console.log(ready
  ? 'READY — new week is live. Post with: node --env-file=.env src/index.js'
  : 'NOT READY YET — no week newer than the baseline');

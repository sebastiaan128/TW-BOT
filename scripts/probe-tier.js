// scripts/probe-tier.js
import { loadConfig } from '../src/config.js';
import { fetchClanMembers, fetchPlayer, getTier, isInLegendLeague } from '../src/coc.js';

const config = loadConfig();
const clanTag = process.argv[2] || config.clanTags[0];
if (!clanTag || clanTag.includes('REPLACE')) {
  console.error('Geef een echte clan tag mee: npm run probe -- "#TAG"');
  process.exit(1);
}

const members = await fetchClanMembers(clanTag, config.cocApiKey);
const legend = members.filter(isInLegendLeague);
console.log(`Clan ${clanTag}: ${members.length} leden, ${legend.length} in Legend League\n`);

// The tier lives on the player profile (leagueTier), not on the members list.
for (const m of legend) {
  const profile = await fetchPlayer(m.tag, config.cocApiKey);
  console.log(`${m.name.padEnd(20)} leagueTier=${JSON.stringify(profile.leagueTier)}  -> getTier=${getTier(profile)}`);
}

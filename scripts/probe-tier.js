// scripts/probe-tier.js
import { loadConfig } from '../src/config.js';
import { fetchClanMembers, getTier } from '../src/coc.js';

const config = loadConfig();
const clanTag = process.argv[2] || config.clanTags[0];
if (!clanTag || clanTag.includes('REPLACE')) {
  console.error('Geef een echte clan tag mee: npm run probe -- "#TAG"');
  process.exit(1);
}

// The tier lives on each member's `leagueTier` in the members list itself.
const members = await fetchClanMembers(clanTag, config.cocApiKey);
const withTier = members.filter((m) => m.leagueTier);
console.log(`Clan ${clanTag}: ${members.length} leden, ${withTier.length} met een leagueTier\n`);
for (const m of withTier) {
  console.log(`${m.name.padEnd(20)} leagueTier.id=${m.leagueTier.id}  trophies=${m.trophies}  -> getTier=${getTier(m) ?? '-'}`);
}

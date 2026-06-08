// scripts/probe-tier.js
import { loadConfig } from '../src/config.js';
import { fetchClanMembers, getTier } from '../src/coc.js';

const config = loadConfig();
const clanTag = process.argv[2] || config.clanTags[0];
if (!clanTag || clanTag.includes('REPLACE')) {
  console.error('Geef een echte clan tag mee: npm run probe -- "#TAG"');
  process.exit(1);
}

const members = await fetchClanMembers(clanTag, config.cocApiKey);
console.log(`Clan ${clanTag}: ${members.length} leden\n`);
for (const m of members) {
  console.log(`${m.name.padEnd(20)} league=${JSON.stringify(m.league)}  -> getTier=${getTier(m)}`);
}

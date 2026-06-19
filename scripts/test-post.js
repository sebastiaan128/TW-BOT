// scripts/test-post.js — one-off: prove the bot can actually post to the
// 1-star channel right now, without waiting for a real 1-star attack.
// Renders a sample OneStar graphic and posts it to oneStar.channelId, then
// reports the result. Any token/channel/permission problem surfaces here as
// the exact Discord error (403 Missing Permissions, 404 Unknown Channel, ...).
//
//   node scripts/test-post.js
//
// Self-loads .env (like the daemon) so it works on the host with no flags.
try { process.loadEnvFile('.env'); } catch { /* no .env: rely on real env vars */ }

import { loadConfig } from '../src/config.js';
import { renderFields } from '../src/render.js';
import { postGraphic } from '../src/discord.js';

const cfg = loadConfig();
const channelId = cfg.oneStar?.channelId;
if (!channelId) {
  console.error('No oneStar.channelId in config.json — nothing to post to.');
  process.exit(1);
}

console.log(`Posting a test graphic to channel ${channelId} ...`);
const buffer = await renderFields('onestar', { name: 'TEST POST', destruction: '42%' }, cfg.render);
try {
  const msg = await postGraphic(channelId, { filename: 'test-post.png', imageBuffer: buffer, content: '' }, cfg.botToken);
  console.log(`OK — posted message ${msg?.id} in channel ${msg?.channel_id}.`);
  console.log('Posting works. Delete the test message in Discord when done.');
} catch (e) {
  console.error(`FAILED — ${e.message}`);
  console.error('Check: bot is in the guild, and has View Channel + Send Messages + Attach Files on that channel.');
  process.exit(1);
}

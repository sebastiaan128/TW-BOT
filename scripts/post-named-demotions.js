// scripts/post-named-demotions.js — one-off: post a fixed list of players as
// demotions, bypassing detectMovements. Mirrors post-named-promotions.js.
//
// Used to catch up demotions the old leaguehistory-based detection dropped: it
// filtered every player against a single "mode" baseline season, so anyone whose
// history lagged an extra week was silently skipped. On 2026-07-27 nobody had a
// history entry for the reset week and 64 of 140 tracked players lagged to
// 2026-07-13 or older, so their moves were discarded. The per-player tier memory
// that replaced it (2026-07-29) seeded its baseline from the CURRENT tiers, so
// these already-demoted players show no change and would never be announced.
//
// Verified live against the CoC API on 2026-07-30: both are Legend II now and
// their latest leaguehistory record (2026-07-13) is Legend I.
//
// Run with --dry-run to render into config.outDir instead of posting.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { renderUsername } from '../src/render.js';
import { postGraphic, addReaction } from '../src/discord.js';

const PLAYERS = [
  { name: 'rik', tag: '#8YRPGCJJ' },
  { name: 'TW Bilan', tag: '#9LPJG28UQ' },
  { name: 'TW Spijker', tag: '#YLG2VVCJ' },
  { name: 'TW YesilAyi', tag: '#Y2VPJGYJ' },
  { name: 'Bollie', tag: '#2PL2PGP2' },
  { name: 'TW⚜️HUNTER⚜️', tag: '#88UCU809Q' },
];

const dryRun = process.argv.includes('--dry-run');
const cfg = loadConfig();

for (const p of PLAYERS) {
  const buffer = await renderUsername('demoted', p.name, cfg.render);
  const filename = `demoted-${p.tag.replace('#', '')}.png`;
  if (dryRun) {
    await mkdir(cfg.outDir, { recursive: true });
    await writeFile(join(cfg.outDir, filename), buffer);
    console.log('RENDERED', p.name, p.tag, '->', join(cfg.outDir, filename));
    continue;
  }
  const content = cfg.messages?.demoted ?? '';
  const msg = await postGraphic(cfg.channelId, { filename, imageBuffer: buffer, content }, cfg.botToken);
  const emoji = cfg.reactions?.demoted;
  if (emoji && msg?.id && msg?.channel_id) {
    try { await addReaction(msg.channel_id, msg.id, emoji, cfg.botToken); }
    catch (e) { console.warn(`Reaction failed for ${p.tag}: ${e.message}`); }
  }
  console.log('POSTED', p.name, p.tag);
}

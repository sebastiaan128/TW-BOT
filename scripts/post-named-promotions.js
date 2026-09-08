// scripts/post-named-promotions.js — one-off: post a fixed list of players as
// promotions, bypassing detectMovements (used when the API leaguehistory hasn't
// caught up but we've decided to post anyway). Names/tags are hard-coded below.
//
// Run with --dry-run to render into config.outDir instead of posting (mirrors
// post-named-demotions.js).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { renderUsername } from '../src/render.js';
import { postGraphic, addReaction } from '../src/discord.js';

const PLAYERS = [
  { name: 'BE Legend™️', tag: '#P8GJGVPJL' },
  { name: 'TW Puf', tag: '#Y0RCPP2YQ' },
  { name: 'Pilsje LexengeI', tag: '#9UY208RC' },
  { name: 'TA lucky', tag: '#8J89Y2QRQ' },
  { name: 'TW Puf', tag: '#20RP9L8G8' },
  { name: 'TW_Sven', tag: '#Q2802G0Y9' },
  { name: 'Sander77', tag: '#Q2UC0RQ9Q' },
  { name: 'TW Diepie', tag: '#PQ9Q2VJP' },
  { name: 'Stephan', tag: '#2Y0L0R0J' },
  { name: 'TW • Tim', tag: '#L2J2JGQUY' },
  { name: '✨ Max/Art ✨', tag: '#PRUC2QJP' },
  { name: 'TW KingTom', tag: '#99LGYUR2' },
];

const dryRun = process.argv.includes('--dry-run');
const cfg = loadConfig();

for (const p of PLAYERS) {
  const buffer = await renderUsername('promoted', p.name, cfg.render);
  const filename = `promoted-${p.tag.replace('#', '')}.png`;
  if (dryRun) {
    await mkdir(cfg.outDir, { recursive: true });
    await writeFile(join(cfg.outDir, filename), buffer);
    console.log('RENDERED', p.name, p.tag, '->', join(cfg.outDir, filename));
    continue;
  }
  const content = cfg.messages?.promoted ?? '';
  const msg = await postGraphic(cfg.channelId, { filename, imageBuffer: buffer, content }, cfg.botToken);
  const emoji = cfg.reactions?.promoted;
  if (emoji && msg?.id && msg?.channel_id) {
    try { await addReaction(msg.channel_id, msg.id, emoji, cfg.botToken); }
    catch (e) { console.warn(`Reaction failed for ${p.tag}: ${e.message}`); }
  }
  console.log('POSTED', p.name, p.tag);
}

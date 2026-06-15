// scripts/post-named-promotions.js — one-off: post a fixed list of players as
// promotions, bypassing detectMovements (used when the API leaguehistory hasn't
// caught up but we've decided to post anyway). Names/tags are hard-coded below.
import { loadConfig } from '../src/config.js';
import { renderUsername } from '../src/render.js';
import { postGraphic, addReaction } from '../src/discord.js';

const PLAYERS = [
  { name: 'Maassluis', tag: '#PQJ0QPGC' },
  { name: 'TW soerrt', tag: '#9Q9PYRY' },
  { name: 'Stephan', tag: '#2Y0L0R0J' },
  { name: 'ZYLAR', tag: '#YP08CL0RR' },
  { name: 'Shiva.', tag: '#2CC9U0QP' },
  { name: '☠TM☠', tag: '#Q98Q82RGP' },
];

const cfg = loadConfig();
for (const p of PLAYERS) {
  const buffer = await renderUsername('promoted', p.name, cfg.render);
  const filename = `promoted-${p.tag.replace('#', '')}.png`;
  const content = cfg.messages?.promoted ?? '';
  const msg = await postGraphic(cfg.channelId, { filename, imageBuffer: buffer, content }, cfg.botToken);
  const emoji = cfg.reactions?.promoted;
  if (emoji && msg?.id && msg?.channel_id) {
    try { await addReaction(msg.channel_id, msg.id, emoji, cfg.botToken); }
    catch (e) { console.warn(`Reaction failed for ${p.tag}: ${e.message}`); }
  }
  console.log('POSTED', p.name, p.tag);
}

// scripts/post-promotions.js — posts ONLY confirmed promotions for the current
// reset, reusing the same render/discord path as the main run. Demotions are
// left untouched (they were already posted). Idempotent via a local dedup file
// so re-running in a loop never double-posts the same promotion.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { detectMovements } from '../src/coc.js';
import { renderUsername } from '../src/render.js';
import { postGraphic, addReaction } from '../src/discord.js';

const DEDUP = 'data/promotions-posted.json';
const dryRun = process.argv.includes('--dry-run');

async function loadPosted() {
  try { return JSON.parse(await readFile(DEDUP, 'utf8')); }
  catch { return { season: null, tags: [] }; }
}

const cfg = loadConfig();
const { season, promotions } = await detectMovements(cfg.clanTags, cfg.cocApiKey);

let posted = await loadPosted();
if (posted.season !== season) posted = { season, tags: [] }; // new reset: reset dedup

const todo = promotions.filter((p) => !posted.tags.includes(p.tag));
console.log(JSON.stringify({ season, promotions: promotions.map((p) => p.name), alreadyPosted: posted.tags, todo: todo.map((p) => p.name) }));

if (todo.length === 0) { console.log('NOTHING_TO_POST'); process.exit(0); }

for (const p of todo) {
  const buffer = await renderUsername('promoted', p.name, cfg.render);
  const filename = `promoted-${p.tag.replace('#', '')}.png`;
  if (dryRun) {
    await mkdir(cfg.outDir, { recursive: true });
    await writeFile(join(cfg.outDir, filename), buffer);
    console.log('DRY wrote', filename);
  } else {
    const content = cfg.messages?.promoted ?? '';
    const msg = await postGraphic(cfg.channelId, { filename, imageBuffer: buffer, content }, cfg.botToken);
    const emoji = cfg.reactions?.promoted;
    if (emoji && msg?.id && msg?.channel_id) {
      try { await addReaction(msg.channel_id, msg.id, emoji, cfg.botToken); }
      catch (e) { console.warn(`Reaction failed for ${p.tag}: ${e.message}`); }
    }
    posted.tags.push(p.tag);
    console.log('POSTED', p.name, p.tag);
  }
}

if (!dryRun) {
  await mkdir('data', { recursive: true });
  await writeFile(DEDUP, JSON.stringify(posted));
}

// src/onestar.js
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { legendOnePlayers, fetchBattleLog, oneStarAttacks } from './coc.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import { renderFields } from './render.js';
import { postGraphic, addReaction, fetchEmojiId } from './discord.js';

async function saveLocal(dir, filename, buffer) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buffer);
}

const sig = (a) => `${a.opponentPlayerTag}|${a.destructionPercentage}`;

const defaultDeps = {
  loadConfig, legendOnePlayers, fetchBattleLog, readSnapshot, writeSnapshot,
  renderFields, postGraphic, addReaction, fetchEmojiId, saveLocal,
};

export async function run(options = {}, deps = defaultDeps) {
  const { dryRun = false, markSeen = false } = options;
  const d = { ...defaultDeps, ...deps };

  const config = d.loadConfig();
  const os = config.oneStar;
  const players = await d.legendOnePlayers(config.clanTags, config.cocApiKey);
  const state = (await d.readSnapshot(os.statePath)) ?? {};
  const newState = { ...state };

  // Resolve the custom emoji once per run (best-effort).
  let emojiTag = null;
  if (!dryRun && !markSeen) {
    try {
      const id = await d.fetchEmojiId(os.guildId, os.emojiName, config.botToken);
      if (id) emojiTag = `${os.emojiName}:${id}`;
    } catch (e) {
      console.warn(`Emoji lookup failed: ${e.message}`);
    }
  }

  const posted = [];
  for (const p of players) {
    let items;
    try {
      items = await d.fetchBattleLog(p.tag, config.cocApiKey);
    } catch (e) {
      console.warn(`Battlelog failed for ${p.tag}: ${e.message}`); // leave state untouched
      continue;
    }
    const attacks = oneStarAttacks(items);
    const currentSigs = attacks.map(sig);

    if (markSeen) { newState[p.tag] = currentSigs; continue; }

    const seen = new Set(state[p.tag] ?? []);
    // Keep already-seen sigs that are still in the log; add newly-posted ones.
    const remembered = new Set(currentSigs.filter((s) => seen.has(s)));
    for (const a of attacks) {
      if (seen.has(sig(a))) continue; // already posted
      const buffer = await d.renderFields('onestar', { name: p.name, destruction: `${a.destructionPercentage}%` }, config.render);
      const filename = `onestar-${p.tag.replace('#', '')}-${a.opponentPlayerTag.replace('#', '')}.png`;
      try {
        if (dryRun) {
          await d.saveLocal(config.outDir, filename, buffer);
        } else {
          const msg = await d.postGraphic(os.channelId, { filename, imageBuffer: buffer, content: '' }, config.botToken);
          if (emojiTag && msg?.id && msg?.channel_id) {
            try { await d.addReaction(msg.channel_id, msg.id, emojiTag, config.botToken); }
            catch (e) { console.warn(`Reaction failed for ${p.tag}: ${e.message}`); }
          }
        }
        remembered.add(sig(a));
        posted.push({ tag: p.tag, name: p.name, opponent: a.opponentPlayerTag, destruction: a.destructionPercentage });
      } catch (e) {
        console.warn(`Post failed for ${p.tag} vs ${a.opponentPlayerTag}: ${e.message}`);
        break; // stop this player; keep only what was posted so far
      }
    }
    if (!dryRun) newState[p.tag] = [...remembered];
  }

  if (markSeen) {
    await d.writeSnapshot(os.statePath, newState);
    return { marked: true, posted: [] };
  }
  if (!dryRun) await d.writeSnapshot(os.statePath, newState);
  return { posted };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = {
    dryRun: process.argv.includes('--dry-run'),
    markSeen: process.argv.includes('--mark-seen'),
  };
  run(options)
    .then((r) => { console.log('Done:', JSON.stringify(r)); })
    .catch((e) => { console.error('Run failed:', e.message); process.exit(1); });
}

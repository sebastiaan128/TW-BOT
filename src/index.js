// src/index.js
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { detectMovements } from './coc.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import { renderUsername } from './render.js';
import { postGraphic, addReaction } from './discord.js';

async function saveLocal(dir, filename, buffer) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buffer);
}

const defaultDeps = {
  loadConfig, detectMovements, readSnapshot, writeSnapshot,
  renderUsername, postGraphic, addReaction, saveLocal,
};

export async function run(options = {}, deps = defaultDeps) {
  const { dryRun = false, markSeen = false } = options;
  const d = { ...defaultDeps, ...deps };

  const config = d.loadConfig();
  const state = (await d.readSnapshot(config.snapshotPath)) ?? {};
  const remembered = state.tiers ?? {}; // last-seen tier per player; {} on first run / old snapshot

  const { promotions, demotions, currentTiers } =
    await d.detectMovements(config.clanTags, config.cocApiKey, { remembered });

  // Merge, not replace: a clan that failed this run contributes no currentTiers,
  // so keep its remembered tiers rather than forgetting (and later mis-detecting)
  // those players. updatedAt is informational.
  const nextState = () => ({
    tiers: { ...remembered, ...currentTiers },
    updatedAt: new Date().toISOString(),
  });

  // mark-seen: record the current tiers as the baseline without posting. Use on
  // first deploy to seed, or to re-baseline after posting a reset manually.
  if (markSeen) {
    await d.writeSnapshot(config.snapshotPath, nextState());
    return { marked: true, posted: [] };
  }

  const jobs = [
    ...promotions.map((p) => ({ type: 'promoted', ...p })),
    ...demotions.map((p) => ({ type: 'demoted', ...p })),
  ];

  const posted = [];
  for (const job of jobs) {
    const buffer = await d.renderUsername(job.type, job.name, config.render);
    const filename = `${job.type}-${job.tag.replace('#', '')}.png`;
    if (dryRun) {
      await d.saveLocal(config.outDir, filename, buffer);
    } else {
      const content = config.messages?.[job.type] ?? '';
      const message = await d.postGraphic(config.channelId, { filename, imageBuffer: buffer, content }, config.botToken);
      // Best-effort emoji reaction under the post. A reaction failure must never
      // abort the run or block the state write.
      const emoji = config.reactions?.[job.type];
      if (emoji && message?.id && message?.channel_id) {
        try {
          await d.addReaction(message.channel_id, message.id, emoji, config.botToken);
        } catch (e) {
          console.warn(`Reaction failed for ${job.tag}: ${e.message}`);
        }
      }
    }
    posted.push(job);
  }

  // Record the new tiers only after every post succeeded; a re-run then sees no
  // change and won't double-post (restart-safe idempotency).
  if (!dryRun) await d.writeSnapshot(config.snapshotPath, nextState());
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

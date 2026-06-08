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
  const { dryRun = false, markSeen = false, force = false } = options;
  const d = { ...defaultDeps, ...deps };

  const config = d.loadConfig();
  const { season, promotions, demotions } = await d.detectMovements(config.clanTags, config.cocApiKey);

  // mark-seen: record the current reset as announced without posting. Use after
  // posting a reset manually, or on first deploy to skip the current week.
  if (markSeen) {
    await d.writeSnapshot(config.snapshotPath, { lastAnnouncedSeason: season });
    return { season, marked: true, posted: [] };
  }

  const state = await d.readSnapshot(config.snapshotPath);
  const alreadyAnnounced = state?.lastAnnouncedSeason === season;
  if (alreadyAnnounced && !force && !dryRun) {
    return { season, alreadyAnnounced: true, posted: [] };
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

  // Record the reset as announced only after every post succeeded.
  if (!dryRun) await d.writeSnapshot(config.snapshotPath, { lastAnnouncedSeason: season });
  return { season, posted };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = {
    dryRun: process.argv.includes('--dry-run'),
    markSeen: process.argv.includes('--mark-seen'),
    force: process.argv.includes('--force'),
  };
  run(options)
    .then((r) => { console.log('Done:', JSON.stringify(r)); })
    .catch((e) => { console.error('Run failed:', e.message); process.exit(1); });
}

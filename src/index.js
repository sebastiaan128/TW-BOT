// src/index.js
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { buildCurrentSnapshot } from './coc.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import { diffSnapshots } from './diff.js';
import { renderUsername } from './render.js';
import { postGraphic, addReaction } from './discord.js';

async function saveLocal(dir, filename, buffer) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buffer);
}

const defaultDeps = {
  loadConfig, buildCurrentSnapshot, readSnapshot, writeSnapshot,
  diffSnapshots, renderUsername, postGraphic, addReaction, saveLocal,
};

export async function run(options = {}, deps = defaultDeps) {
  const { dryRun = false } = options;
  // Merge caller deps over defaults so diffSnapshots etc. are always available
  const d = { ...defaultDeps, ...deps };

  const config = d.loadConfig();

  const current = await d.buildCurrentSnapshot(config.clanTags, config.cocApiKey);
  const previous = await d.readSnapshot(config.snapshotPath);

  if (!previous) {
    if (!dryRun) await d.writeSnapshot(config.snapshotPath, current);
    return { firstRun: true, posted: [] };
  }

  const { promotions, demotions } = d.diffSnapshots(previous, current);
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
      const message = await d.postGraphic(config.webhookUrl, { filename, imageBuffer: buffer, content });
      // Best-effort emoji reaction under the post (needs a bot token). Never let
      // a reaction failure abort the run or block the snapshot write.
      const emoji = config.reactions?.[job.type];
      if (config.botToken && emoji && message?.id && message?.channel_id) {
        try {
          await d.addReaction(message.channel_id, message.id, emoji, config.botToken);
        } catch (e) {
          console.warn(`Reaction failed for ${job.tag}: ${e.message}`);
        }
      }
    }
    posted.push(job);
  }

  if (!dryRun) await d.writeSnapshot(config.snapshotPath, current);
  return { firstRun: false, posted };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry-run');
  run({ dryRun })
    .then((r) => { console.log('Done:', JSON.stringify(r)); })
    .catch((e) => { console.error('Run failed:', e.message); process.exit(1); });
}

// src/index.js
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { detectMovements } from './coc.js';
import { confirmMovements } from './movements.js';
import { readSnapshot, writeSnapshot, pruneStaleTiers } from './snapshot.js';
import { renderUsername } from './render.js';
import { postGraphic, addReaction } from './discord.js';

async function saveLocal(dir, filename, buffer) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buffer);
}

const defaultDeps = {
  loadConfig, detectMovements, confirmMovements, readSnapshot, writeSnapshot,
  renderUsername, postGraphic, addReaction, saveLocal,
};

export async function run(options = {}, deps = defaultDeps) {
  const { dryRun = false, markSeen = false } = options;
  const d = { ...defaultDeps, ...deps };

  const config = d.loadConfig();
  const state = (await d.readSnapshot(config.snapshotPath)) ?? {};
  // last-seen tier per player, minus anyone we stopped observing long enough ago
  // that their tier can no longer be trusted (see pruneStaleTiers). {} on first
  // run / old snapshot.
  const { tiers: remembered, seenAt } = pruneStaleTiers(state);

  const observed = await d.detectMovements(config.clanTags, config.cocApiKey, { remembered });
  const { currentTiers } = observed;

  // The raw move lists are a single live read of a field that is not stable
  // across the reset window, so they are only used for the player NAMES. What
  // actually gets announced is decided by confirmMovements, which requires the
  // same change on two separate runs. See src/movements.js for the incident.
  const names = Object.fromEntries(
    [...observed.promotions, ...observed.demotions].map((p) => [p.tag, p.name]),
  );
  const { promotions, demotions, tiers: confirmedTiers, pending: nextPending } =
    d.confirmMovements({ remembered, pending: state.pending ?? {}, currentTiers, names });

  // Merge, not replace: a clan that failed this run contributes no currentTiers,
  // so keep its remembered tiers rather than forgetting (and later mis-detecting)
  // those players. Only players actually observed get their seenAt refreshed —
  // that stamp is what eventually expires someone who left every tracked clan.
  // updatedAt is informational.
  const nextState = ({ confirmedOnly = true } = {}) => {
    const stamp = new Date().toISOString();
    const nextSeenAt = { ...seenAt };
    for (const tag of Object.keys(currentTiers)) nextSeenAt[tag] = stamp;
    return {
      // confirmedTiers holds back changes still awaiting a second read;
      // mark-seen deliberately takes the raw observation as the new baseline.
      tiers: { ...remembered, ...(confirmedOnly ? confirmedTiers : currentTiers) },
      pending: confirmedOnly ? nextPending : {},
      seenAt: nextSeenAt,
      updatedAt: stamp,
    };
  };

  // mark-seen: record the current tiers as the baseline without posting. Use on
  // first deploy to seed, or to re-baseline after posting a reset manually.
  if (markSeen) {
    await d.writeSnapshot(config.snapshotPath, nextState({ confirmedOnly: false }));
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

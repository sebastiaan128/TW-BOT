// src/config.js
import { readFileSync } from 'node:fs';

export function loadConfig(path = 'config.json') {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const cocApiKey = process.env.COC_API_KEY;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!cocApiKey) throw new Error('COC_API_KEY env var is required');
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN env var is required');
  if (!file.channelId) throw new Error('channelId is required in config.json');
  return {
    cocApiKey,
    botToken,
    channelId: file.channelId,
    clanTags: file.clanTags ?? [],
    render: file.render ?? {},
    messages: file.messages ?? {},
    reactions: file.reactions ?? {},
    oneStar: file.oneStar ?? {},
    snapshotPath: file.snapshotPath ?? 'data/last-snapshot.json',
    outDir: file.outDir ?? 'out',
  };
}

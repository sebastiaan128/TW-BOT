// src/config.js
import { readFileSync } from 'node:fs';

export function loadConfig(path = 'config.json') {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const cocApiKey = process.env.COC_API_KEY;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!cocApiKey) throw new Error('COC_API_KEY env var is required');
  if (!webhookUrl) throw new Error('DISCORD_WEBHOOK_URL env var is required');
  return {
    cocApiKey,
    webhookUrl,
    botToken: process.env.DISCORD_BOT_TOKEN, // optional: enables emoji reactions
    clanTags: file.clanTags ?? [],
    render: file.render ?? {},
    messages: file.messages ?? {},
    reactions: file.reactions ?? {},
    snapshotPath: file.snapshotPath ?? 'data/last-snapshot.json',
    outDir: file.outDir ?? 'out',
  };
}

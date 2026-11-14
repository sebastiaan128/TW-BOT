import { cocApiBase } from './coc-endpoint.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export function loadEnv() {
  try { process.loadEnvFile(resolve(PROJECT_ROOT, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export function loadConfig(path = process.env.TW_CONFIG ?? resolve(PROJECT_ROOT, 'config.json'), { requireSecrets = true, checkAssets = true } = {}) {
  return validateConfig(JSON.parse(readFileSync(path, 'utf8')), { baseDir: dirname(resolve(path)), requireSecrets, checkAssets });
}
export function validateConfig(file, { baseDir = PROJECT_ROOT, requireSecrets = true, checkAssets = true } = {}) {
  cocApiBase();
  const config = {
    ...file, cocApiKey: process.env.COC_API_KEY, botToken: process.env.DISCORD_BOT_TOKEN,
    clanTags: [...new Set(file.clanTags ?? [])], render: structuredClone(file.render ?? {}),
    messages: file.messages ?? {}, reactions: file.reactions ?? {},
    movements: { enabled: true, intervalMinutes: 30, afterHour: 10, recoveryDays: 2, confirmationMinutes: 5, maxMemoryDays: 14, ...(file.movements ?? {}) },
    oneStar: { enabled: true, intervalMinutes: 15, stars: [1], tiers: ['I'], minDestruction: 0, maxDestruction: 100, ignoredPlayers: [], ...(file.oneStar ?? {}) },
    delivery: { maxPerRun: 10, maxPerChannel: 6, maxPerPlayer: 2, windowMinutes: 15, intervalSeconds: 60, ...(file.delivery ?? {}) },
    summary: { enabled: false, channelId: file.channelId, afterHour: 18, ...(file.summary ?? {}) },
    ranking: { enabled: true, channelId: file.oneStar?.channelId, top: 10, ...(file.ranking ?? {}) },
    seasons: { leagueId: 29000022, fallback: 'clashperk', ...(file.seasons ?? {}) },
    commands: { enabled: false, host: '127.0.0.1', port: 3000, guildId: file.oneStar?.guildId, ...(file.commands ?? {}) },
    health: { enabled: false, host: '127.0.0.1', port: 3001, ...(file.health ?? {}) },
    timeZone: file.timeZone ?? 'Europe/Amsterdam', databasePath: file.databasePath ?? 'data/bot.sqlite',
    snapshotPath: file.snapshotPath ?? 'data/last-snapshot.json', outDir: file.outDir ?? 'out',
  };
  const fail = (message) => { throw new Error(`Config: ${message}`); };
  if (requireSecrets) for (const [key, value] of [['COC_API_KEY', config.cocApiKey], ['DISCORD_BOT_TOKEN', config.botToken]]) if (!value) fail(`${key} env var is required`);
  if (!Array.isArray(file.clanTags) || !config.clanTags.length || config.clanTags.some((tag) => !/^#[0289PYLQGRJCUV]+$/.test(tag))) fail('clanTags must contain valid #clan tags');
  const channel = (id, key) => { if (typeof id !== 'string' || !/^\d{5,22}$/.test(id)) fail(`${key} must be a Discord ID string`); };
  if (config.movements.enabled) channel(config.channelId, 'channelId');
  if (config.oneStar.enabled) { channel(config.oneStar.channelId, 'oneStar.channelId'); if (config.oneStar.emojiName) channel(config.oneStar.guildId, 'oneStar.guildId'); }
  if (config.summary.enabled) channel(config.summary.channelId, 'summary.channelId');
  if (config.ranking.enabled) channel(config.ranking.channelId, 'ranking.channelId');
  for (const feature of ['movements', 'oneStar', 'summary', 'ranking', 'commands', 'health']) if (typeof config[feature].enabled !== 'boolean') fail(`${feature}.enabled must be boolean`);
  for (const [key, value, min, max] of [
    ['movements.intervalMinutes', config.movements.intervalMinutes, 5, 1440], ['oneStar.intervalMinutes', config.oneStar.intervalMinutes, 1, 1440],
    ['movements.afterHour', config.movements.afterHour, 0, 23], ['movements.recoveryDays', config.movements.recoveryDays, 1, 6],
    ['movements.confirmationMinutes', config.movements.confirmationMinutes, 1, 180], ['movements.maxMemoryDays', config.movements.maxMemoryDays, 1, 28],
    ['summary.afterHour', config.summary.afterHour, 0, 23], ['ranking.top', config.ranking.top, 1, 20],
    ['delivery.maxPerRun', config.delivery.maxPerRun, 1, 100], ['delivery.maxPerChannel', config.delivery.maxPerChannel, 1, 100],
    ['delivery.maxPerPlayer', config.delivery.maxPerPlayer, 1, 100], ['delivery.windowMinutes', config.delivery.windowMinutes, 1, 1440],
    ['delivery.intervalSeconds', config.delivery.intervalSeconds, 5, 3600], ['commands.port', config.commands.port, 1, 65535], ['health.port', config.health.port, 1, 65535],
  ]) if (!Number.isInteger(value) || value < min || value > max) fail(`${key} must be an integer between ${min} and ${max}`);
  if (config.movements.confirmationMinutes > config.movements.intervalMinutes) fail('confirmationMinutes must not exceed intervalMinutes');
  if (!Array.isArray(config.oneStar.stars) || !config.oneStar.stars.length || config.oneStar.stars.some((v) => ![0, 1, 2, 3].includes(v))) fail('oneStar.stars must contain 0..3');
  if (!Array.isArray(config.oneStar.tiers) || !config.oneStar.tiers.length || config.oneStar.tiers.some((v) => !['I', 'II'].includes(v))) fail('oneStar.tiers must contain I/II');
  if (!Array.isArray(config.oneStar.ignoredPlayers) || config.oneStar.ignoredPlayers.some((v) => !/^#[0289PYLQGRJCUV]+$/.test(v))) fail('invalid ignoredPlayers');
  if (![config.oneStar.minDestruction, config.oneStar.maxDestruction].every((v) => Number.isFinite(v) && v >= 0 && v <= 100) || config.oneStar.minDestruction > config.oneStar.maxDestruction) fail('invalid destruction range');
  if (!Number.isInteger(config.seasons.leagueId) || config.seasons.leagueId <= 0) fail('seasons.leagueId must be a positive integer');
  for (const section of ['commands', 'health']) if (typeof config[section].host !== 'string' || !config[section].host.trim()) fail(`${section}.host is required`);
  if (!['clashperk', 'none'].includes(config.seasons.fallback)) fail('seasons.fallback must be clashperk/none');
  new Intl.DateTimeFormat('en', { timeZone: config.timeZone }).format();
  for (const key of ['databasePath', 'snapshotPath', 'outDir']) { if (typeof config[key] !== 'string' || !config[key]) fail(`${key} is required`); config[key] = resolve(baseDir, config[key]); }
  config.oneStar.statePath = resolve(baseDir, config.oneStar.statePath ?? 'data/onestar-seen.json');
  for (const [type, cfg] of Object.entries(config.render)) {
    if (!cfg || typeof cfg !== 'object' || !cfg.assetPath) fail(`render.${type}.assetPath required`);
    cfg.assetPath = resolve(baseDir, cfg.assetPath);
    if (checkAssets && !existsSync(cfg.assetPath)) fail(`asset missing: ${cfg.assetPath}`);
    for (const f of cfg.fonts ?? []) { f.path = resolve(baseDir, f.path); if (checkAssets && !existsSync(f.path)) fail(`font missing: ${f.path}`); }
    if (cfg.fontPath) { cfg.fontPath = resolve(baseDir, cfg.fontPath); if (checkAssets && !existsSync(cfg.fontPath)) fail(`font missing: ${cfg.fontPath}`); }
    if (!Number.isInteger(cfg.outputWidth ?? 1600) || (cfg.outputWidth ?? 1600) < 100 || (cfg.outputWidth ?? 1600) > 2400) fail(`render.${type}.outputWidth must be 100..2400`);
    for (const field of [...(cfg.fields ?? [cfg]), ...(cfg.labels ?? [])]) if (![field.x, field.y, field.maxWidth, field.baseFontSize].every(Number.isFinite) || field.maxWidth <= 0 || field.baseFontSize <= 0) fail(`invalid text geometry for ${type}`);
  }
  if (config.oneStar.enabled && !['name', 'destruction', 'stars'].every((key) => config.render.onestar?.fields?.some((f) => f.key === key))) fail('onestar fields must include name, destruction and stars');
  for (const type of [...(config.movements.enabled ? ['promoted', 'demoted'] : []), ...(config.oneStar.enabled ? ['onestar'] : [])]) if (!config.render[type]) fail(`render.${type} required`);
  if (config.commands.enabled) {
    channel(config.commands.guildId, 'commands.guildId');
    if (!/^\d{5,22}$/.test(process.env.DISCORD_APPLICATION_ID ?? '')) fail('DISCORD_APPLICATION_ID required');
    if (!/^[a-f\d]{64}$/i.test(process.env.DISCORD_PUBLIC_KEY ?? '')) fail('DISCORD_PUBLIC_KEY required');
  }
  return config;
}

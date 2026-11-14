import { requestJson } from './http.js';
const DISCORD_API = 'https://discord.com/api/v10';
export function discordRequest(path, botToken, options = {}, deps = {}) {
  return requestJson(`${DISCORD_API}${path}`, { ...options, headers: { Authorization: `Bot ${botToken}`, ...options.headers } }, deps);
}
export async function postGraphic(channelId, { filename, imageBuffer, content, nonce }, botToken, deps = {}) {
  const payload = { content: content || '', allowed_mentions: { parse: [] }, ...(nonce ? { nonce, enforce_nonce: true } : {}) };
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([imageBuffer], { type: 'image/png' }), filename);
  return discordRequest(`/channels/${channelId}/messages`, botToken, { method: 'POST', body: form }, deps);
}
export function postText(channelId, { content, nonce }, botToken, deps = {}) {
  return discordRequest(`/channels/${channelId}/messages`, botToken, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, nonce, enforce_nonce: true, allowed_mentions: { parse: [] } }) }, deps);
}
export function addReaction(channelId, messageId, emoji, botToken, deps = {}) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, botToken, { method: 'PUT' }, deps);
}
const emojiCache = new Map();
export async function fetchEmojiId(guildId, name, botToken, deps = {}) {
  const key = `${guildId}:${name}`;
  if (!deps.fetchImpl && emojiCache.get(key)?.expires > Date.now()) return emojiCache.get(key).id;
  const emojis = await discordRequest(`/guilds/${guildId}/emojis`, botToken, {}, deps);
  const id = emojis.find((e) => e.name?.toLowerCase() === name.toLowerCase())?.id ?? null;
  if (!deps.fetchImpl) emojiCache.set(key, { id, expires: Date.now() + 3600000 });
  return id;
}

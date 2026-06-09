// src/discord.js
const DISCORD_API = 'https://discord.com/api/v10';

// Posts an image with optional content to a channel using a bot token. The bot
// must be in the guild with View Channel + Send Messages + Attach Files in the
// target channel. Returns the created message ({ id, channel_id, ... }).
export async function postGraphic(channelId, { filename, imageBuffer, content }, botToken, { fetchImpl = fetch } = {}) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: content || '' }));
  form.append('files[0]', new Blob([imageBuffer], { type: 'image/png' }), filename);

  const res = await fetchImpl(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord post failed: ${res.status} ${body}`);
  }
  return res.json();
}

// Adds a unicode emoji reaction to a message. The bot needs the "Add Reactions"
// permission in the channel.
export async function addReaction(channelId, messageId, emoji, botToken, { fetchImpl = fetch } = {}) {
  const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`;
  const res = await fetchImpl(url, { method: 'PUT', headers: { Authorization: `Bot ${botToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord reaction failed: ${res.status} ${body}`);
  }
  return res;
}

// Resolves a guild custom-emoji id by name (case-insensitive). Returns null if
// not found. Used to react with a custom emoji, which the API expects as
// "name:id". Survives re-uploads of the emoji (id looked up fresh each run).
export async function fetchEmojiId(guildId, name, botToken, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${DISCORD_API}/guilds/${guildId}/emojis`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord emojis fetch failed: ${res.status} ${body}`);
  }
  const emojis = await res.json();
  const hit = emojis.find((e) => e.name?.toLowerCase() === name.toLowerCase());
  return hit?.id ?? null;
}

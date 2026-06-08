// src/discord.js
const DISCORD_API = 'https://discord.com/api/v10';

export async function postGraphic(webhookUrl, { filename, imageBuffer, content }, { fetchImpl = fetch } = {}) {
  const form = new FormData();
  if (content) form.append('content', content);
  form.append('files[0]', new Blob([imageBuffer], { type: 'image/png' }), filename);

  // ?wait=true makes Discord return the created message (with id + channel_id),
  // which we need in order to attach a reaction afterwards.
  const url = webhookUrl + (webhookUrl.includes('?') ? '&' : '?') + 'wait=true';
  const res = await fetchImpl(url, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${res.status} ${body}`);
  }
  return res.json();
}

// Adds a unicode emoji reaction to a message using a bot token. The bot must be
// a member of the guild with the "Add Reactions" permission.
export async function addReaction(channelId, messageId, emoji, botToken, { fetchImpl = fetch } = {}) {
  const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`;
  const res = await fetchImpl(url, { method: 'PUT', headers: { Authorization: `Bot ${botToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord reaction failed: ${res.status} ${body}`);
  }
  return res;
}

import { postGraphic, postText, addReaction, fetchEmojiId } from './discord.js';
import { renderFields, renderUsername } from './render.js';
import { HttpError } from './http.js';

export function channelFor(event, config) {
  if (event.type === 'onestar') return config.oneStar.channelId;
  if (event.type === 'ranking') return config.ranking.channelId;
  if (event.type === 'summary') return config.summary.channelId;
  return config.channelId;
}
export function enabled(event, config, store) {
  const feature = ['promoted', 'demoted'].includes(event.type) ? 'movements' : event.type === 'onestar' ? 'oneStar' : event.type;
  return config[feature]?.enabled !== false && store.get(`enabled:${feature}`, true);
}
export async function drainQueue(store, config, deps = {}) {
  const d = { postGraphic, postText, addReaction, fetchEmojiId, renderFields, renderUsername, now: Date.now, ...deps };
  return store.locked('delivery', async (assertLease) => {
    // A previous process died between the request and the durable receipt.
    // Discord only deduplicates nonces for a few minutes; never blindly resend.
    for (const event of store.events({ status: 'sending' })) store.updateEvent(event.id, 'uncertain', { error: 'Interrupted send; verify Discord before retrying' });
    const now = d.now();
    const cutoff = now - config.delivery.windowMinutes * 60000;
    const recent = store.db.prepare("SELECT player,channel_id FROM events WHERE status='sent' AND updated>=?").all(cutoff);
    const channels = new Map(), players = new Map();
    for (const event of recent) {
      channels.set(event.channel_id, (channels.get(event.channel_id) ?? 0) + 1);
      if (event.player) players.set(event.player, (players.get(event.player) ?? 0) + 1);
    }
    let sent = 0, failed = 0;
    for (const event of store.events({ status: 'pending', limit: 5000 })) {
      if (sent >= config.delivery.maxPerRun) break;
      if (event.available > now || !enabled(event, config, store)) continue;
      const channelId = channelFor(event, config);
      if ((channels.get(channelId) ?? 0) >= config.delivery.maxPerChannel || (event.player && (players.get(event.player) ?? 0) >= config.delivery.maxPerPlayer)) continue;
      let buffer;
      try {
        if (event.type === 'onestar') buffer = await d.renderFields('onestar', { name: event.payload.name, destruction: `${event.payload.destruction}%`, stars: String(event.payload.stars ?? 1) }, config.render);
        else if (['promoted', 'demoted'].includes(event.type)) buffer = await d.renderUsername(event.type, event.payload.name, config.render);
      } catch (error) { store.updateEvent(event.id, 'failed', { error: `Render: ${error.message}` }); failed++; continue; }
      assertLease();
      store.updateEvent(event.id, 'sending', { channelId, now });
      let message;
      try {
        const nonce = event.id.slice(0, 24);
        message = buffer
          ? await d.postGraphic(channelId, { filename: `${event.type}-${event.id.slice(0, 16)}.png`, imageBuffer: buffer, content: config.messages[event.type] ?? '', nonce }, config.botToken)
          : await d.postText(channelId, { content: event.payload.content, nonce }, config.botToken);
        if (!message?.id) throw new Error('Discord returned no message ID');
      } catch (error) {
        const status = error instanceof HttpError && error.status === 429 ? 'pending'
          : error instanceof HttpError && error.status >= 400 && error.status < 500 ? 'failed' : 'uncertain';
        store.updateEvent(event.id, status, { error: error.message, available: now + Math.max(60000, error.retryAfterMs ?? 0) });
        failed++;
        if (status !== 'failed') break; // uncertainty or rate limit: stop this batch
        continue;
      }
      // Keep this outside the network catch: a failed receipt write must leave
      // 'sending', so recovery holds the event rather than automatically retrying.
      assertLease();
      store.updateEvent(event.id, 'sent', { messageId: message.id, channelId, now: d.now() });
      sent++;
      channels.set(channelId, (channels.get(channelId) ?? 0) + 1);
      if (event.player) players.set(event.player, (players.get(event.player) ?? 0) + 1);
      try {
        let emoji = config.reactions[event.type];
        if (event.type === 'onestar' && config.oneStar.emojiName) {
          const id = await d.fetchEmojiId(config.oneStar.guildId, config.oneStar.emojiName, config.botToken);
          if (id) emoji = `${config.oneStar.emojiName}:${id}`;
        }
        if (emoji) await d.addReaction(channelId, message.id, emoji, config.botToken);
      } catch (error) { store.updateEvent(event.id, 'sent', { error: `Reaction: ${error.message}`, now: d.now() }); }
    }
    const result = { sent, failed, queue: store.counts(), at: d.now() };
    store.set('health:delivery', result);
    return result;
  });
}

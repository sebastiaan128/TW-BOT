import { eventId } from './store.js';
import { validateConfig } from './config.js';
import { effectiveConfig } from './runtime.js';
import { rankingText, statusReport, weeklyText } from './reports.js';
import { resetWindow } from './calendar.js';

export function adminAction(store, config, command, args = {}, actor = 'local') {
  const audit = (action, data) => store.set(`audit:${Date.now()}:${eventId(actor, action, data).slice(0, 12)}`, { at: Date.now(), actor, action, data });
  if (command === 'status') return statusReport(store, config);
  if (command === 'ranking') return rankingText(store, config, args);
  if (command === 'seasons') return { current: store.get('season'), history: store.seasons() };
  if (command === 'player') {
    if (!args.tag) throw new Error('Player tag is required');
    const tag = args.tag.toUpperCase();
    return { tag, player: store.get('movements', {}).players?.[tag], stats: store.playerStats(tag, args.season) };
  }
  if (command === 'queue') return store.events({ status: args.status ?? 'pending', limit: 100 }).map(({ payload, ...event }) => ({ ...event, name: payload.name }));
  if (command === 'settings') {
    if (args.feature) {
      if (!['movements', 'oneStar', 'summary', 'ranking'].includes(args.feature) || typeof args.enabled !== 'boolean') throw new Error('Choose feature movements/oneStar/summary/ranking and enabled true/false');
      store.transaction(() => { store.set(`enabled:${args.feature}`, args.enabled); audit('settings', args); });
    }
    return Object.fromEntries(['movements', 'oneStar', 'summary', 'ranking'].map((f) => [f, { configured: config[f].enabled, enabled: config[f].enabled && store.get(`enabled:${f}`, true) }]));
  }
  if (command === 'rules') {
    if (args.key) {
      const allowed = ['oneStar.stars', 'oneStar.tiers', 'oneStar.minDestruction', 'oneStar.maxDestruction', 'oneStar.ignoredPlayers', 'delivery.maxPerRun', 'delivery.maxPerChannel', 'delivery.maxPerPlayer'];
      if (!allowed.includes(args.key)) throw new Error(`Allowed rules: ${allowed.join(', ')}`);
      const [section, field] = args.key.split('.');
      const rules = structuredClone(store.get('rules', {}));
      rules[section] = { ...rules[section], [field]: args.value };
      // Use the same validator as startup; no separate set of weaker rules.
      validateConfig({ ...config, oneStar: { ...config.oneStar, ...rules.oneStar }, delivery: { ...config.delivery, ...rules.delivery } }, { requireSecrets: false });
      store.transaction(() => { store.set('rules', rules); audit('rules', args); });
    }
    const effective = effectiveConfig(store, config);
    return { oneStar: effective.oneStar, delivery: effective.delivery };
  }
  if (command === 'retry' || command === 'cancel' || command === 'resolve') {
    const event = store.event(args.id);
    if (!event) throw new Error('Event not found');
    if (event.status === 'sent' || event.status === 'sending') throw new Error(`Cannot change an event with status ${event.status}`);
    if (command === 'retry' && event.status === 'uncertain' && args.confirm !== true) throw new Error('Verify Discord first; retry an uncertain send with --confirm (duplicate risk)');
    if (command === 'resolve' && (!/^\d+$/.test(args.messageId ?? '') || !/^\d+$/.test(args.channelId ?? ''))) throw new Error('resolve requires --message-id and --channel-id');
    store.transaction(() => {
      store.updateEvent(event.id, command === 'retry' ? 'pending' : command === 'cancel' ? 'cancelled' : 'sent', { messageId: args.messageId, channelId: args.channelId });
      audit(command, args);
    });
    return store.event(event.id);
  }
  if (command === 'summary') return weeklyText(store, args.reset ?? resetWindow(new Date(), { timeZone: config.timeZone, ...config.movements }).key);
  if (command === 'correct') {
    if (!/^#[0289PYLQGRJCUV]+$/.test(args.tag ?? '') || typeof args.name !== 'string' || !args.name.trim() || args.name.length > 100 || !['promoted', 'demoted'].includes(args.type) || !/^\d{4}-\d{2}-\d{2}$/.test(args.reset ?? '')) throw new Error('correct requires valid tag, name, type promoted/demoted, and reset YYYY-MM-DD');
    if (!Number.isFinite(Date.parse(`${args.reset}T00:00:00Z`)) || new Date(`${args.reset}T00:00:00Z`).toISOString().slice(0, 10) !== args.reset) throw new Error('Invalid reset date');
    const id = eventId('movement', args.reset, args.tag, args.type);
    store.transaction(() => { store.enqueue({ id, type: args.type, player: args.tag, clan: args.clan, payload: { name: args.name, reset: args.reset, manual: true } }); audit('correct', args); });
    return store.event(id);
  }
  throw new Error(`Unknown command: ${command}`);
}

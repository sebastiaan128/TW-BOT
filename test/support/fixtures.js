import { loadConfig } from '../../src/config.js';
import { Store } from '../../src/store.js';
export function fixture(t) {
  const config = loadConfig(undefined, { requireSecrets: false });
  config.cocApiKey = 'fake'; config.botToken = 'fake';
  const store = new Store(':memory:');
  t.after(() => store.close());
  return { store, config, close() {} };
}
export const monday = Date.parse('2026-11-09T10:00:00Z');
export function member(tag = '#P0', tier = 'I', clan = '#C0') { return { tag, tier, name: tag.slice(1), clan }; }
export function coverage(players) { return async () => ({ players, succeeded: ['#C0'], failed: [] }); }
export function battle(opponent = '#P2', extra = {}) { return { battleType: 'legend', attack: true, stars: 1, opponentPlayerTag: opponent, destructionPercentage: 70, ...extra }; }
export const season = async () => ({ id: '2026-12', source: 'coc-api', fetchedAt: monday });
export function delivery(overrides = {}) { return { renderUsername: async () => Buffer.from('png'), renderFields: async () => Buffer.from('png'), postGraphic: async () => ({ id: '123', channel_id: '456' }), postText: async () => ({ id: '234' }), fetchEmojiId: async () => null, addReaction: async () => {}, ...overrides }; }

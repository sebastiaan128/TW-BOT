import { readSnapshot } from './snapshot.js';

// Parse all input before the transaction. Invalid JSON must never reset state.
export async function migrateLegacy(store, config) {
  if (store.get('migration:v2')) return;
  const oldMovements = await readSnapshot(config.snapshotPath);
  const oldBattles = await readSnapshot(config.oneStar.statePath);
  if (oldMovements?.tiers && (typeof oldMovements.tiers !== 'object' || Array.isArray(oldMovements.tiers))) throw new Error('Invalid legacy tier snapshot');
  if (oldBattles && (typeof oldBattles !== 'object' || Array.isArray(oldBattles))) throw new Error('Invalid legacy battle snapshot');
  store.transaction(() => {
    if (store.get('migration:v2')) return;
    if (oldMovements?.tiers) {
      const players = {};
      for (const [tag, tier] of Object.entries(oldMovements.tiers)) {
        if (!['I', 'II', 'below', 'unknown'].includes(tier)) throw new Error(`Invalid legacy tier for ${tag}`);
        players[tag] = { tier, seenAt: oldMovements.seenAt?.[tag] ?? oldMovements.updatedAt ?? new Date().toISOString() };
      }
      store.set('movements', { players, pending: {}, migrated: true });
    }
    // Old opponent|percentage sets lack ordered windows: seed each player's
    // first v2 window instead of pretending those signatures are unique IDs.
    store.set('legacy:battles', { players: Object.keys(oldBattles ?? {}), importedAt: Date.now() });
    store.set('migration:v2', { at: Date.now(), movementPlayers: Object.keys(oldMovements?.tiers ?? {}).length });
  });
}

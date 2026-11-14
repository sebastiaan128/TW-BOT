import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, loadEnv } from './config.js';
import { Store } from './store.js';
import { migrateLegacy } from './migration.js';
import { scanAttacks, scanMovements } from './service.js';
import { drainQueue } from './queue.js';
import { enqueueReports } from './reports.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderFields, renderUsername } from './render.js';

export async function createRuntime({ config, preview = false } = {}) {
  if (!config) { loadEnv(); config = loadConfig(); }
  const store = new Store(preview ? ':memory:' : config.databasePath);
  try {
    if (preview && existsSync(config.databasePath)) {
      const source = new DatabaseSync(config.databasePath, { readOnly: true });
      try {
        for (const row of source.prepare('SELECT key,value FROM state').all()) store.set(row.key, JSON.parse(row.value));
      } finally { source.close(); }
    }
    await migrateLegacy(store, config);
    return { store, config, close: () => store.close() };
  } catch (error) { store.close(); throw error; }
}
export function effectiveConfig(store, config) {
  const rules = store.get('rules', {});
  return { ...config, oneStar: { ...config.oneStar, ...rules.oneStar }, delivery: { ...config.delivery, ...rules.delivery } };
}
export async function task(runtime, name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    if (!result?.skipped) runtime.store.set(`error:${name}`, null);
    console.log(JSON.stringify({ at: new Date().toISOString(), task: name, durationMs: Date.now() - started, result }));
    return result;
  } catch (error) {
    runtime.store.set(`error:${name}`, { at: Date.now(), message: error.message });
    console.error(JSON.stringify({ at: new Date().toISOString(), task: name, error: error.message }));
    throw error;
  }
}
export async function runFeature(feature, options = {}, deps = {}) {
  const runtime = deps.runtime ?? await createRuntime({ preview: options.dryRun, config: deps.config });
  const config = effectiveConfig(runtime.store, runtime.config);
  try {
    if (!config[feature].enabled || !runtime.store.get(`enabled:${feature}`, true)) return { skipped: true, reason: 'disabled' };
    const result = await task(runtime, feature === 'oneStar' ? 'attacks' : 'movements', () =>
      (feature === 'oneStar' ? scanAttacks : scanMovements)(runtime.store, config, { ...deps.scan, markSeen: options.markSeen, preview: options.dryRun }));
    if (options.dryRun) {
      await mkdir(config.outDir, { recursive: true });
      for (const event of result.events ?? []) {
        const buffer = event.type === 'onestar'
          ? await renderFields('onestar', { name: event.payload.name, destruction: `${event.payload.destruction}%`, stars: String(event.payload.stars) }, config.render)
          : await renderUsername(event.type, event.payload.name, config.render);
        await writeFile(join(config.outDir, `${event.type}-${event.id.slice(0, 16)}.png`), buffer);
      }
    } else if (!options.markSeen) {
      enqueueReports(runtime.store, config);
      result.delivery = await drainQueue(runtime.store, config, deps.delivery);
    }
    return result;
  } finally { if (!deps.runtime) runtime.close(); }
}

import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createRuntime, effectiveConfig, task } from './runtime.js';
import { scanAttacks, scanMovements } from './service.js';
import { guarded } from './scheduler.js';
import { resetWindow } from './calendar.js';
import { drainQueue } from './queue.js';
import { enqueueReports, statusReport } from './reports.js';
import { startCommandServer } from './commands.js';

export const ONESTAR_INTERVAL_MS = 15 * 60000;
export const MOVEMENTS_TICK_MS = 30 * 60000;
export function startDaemon(runtime, {
  now = () => new Date(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  scanAttacksFn = scanAttacks, scanMovementsFn = scanMovements, drainQueueFn = drainQueue, log = console,
  startServers = true,
} = {}) {
  const { store, config } = runtime;
  store.set('error:server', null);
  let stopping = false;
  const active = new Set();
  const launch = (fn) => {
    if (stopping) return Promise.resolve({ skipped: true });
    const promise = fn(); active.add(promise); promise.then(() => active.delete(promise), () => active.delete(promise)); return promise;
  };
  const featureEnabled = (feature) => config[feature].enabled && store.get(`enabled:${feature}`, true);
  const attacks = guarded(() => launch(async () => {
    if (!featureEnabled('oneStar')) return { skipped: true };
    return task(runtime, 'attacks', () => scanAttacksFn(store, effectiveConfig(store, config), { now: now().getTime() }));
  }), { label: 'attacks', log });
  const movements = guarded((options = {}) => launch(async () => {
    if (!featureEnabled('movements')) return { skipped: true };
    const needsSeed = !store.get('movements');
    if (!needsSeed && !options.forceCheck && !resetWindow(now(), { ...config.movements, timeZone: config.timeZone }).open) return { skipped: true };
    return task(runtime, 'movements', () => scanMovementsFn(store, effectiveConfig(store, config), { markSeen: needsSeed, now: now().getTime() }));
  }), { label: 'movements', log });
  const delivery = guarded(() => launch(async () => {
    enqueueReports(store, config, now().getTime());
    return task(runtime, 'delivery', () => drainQueueFn(store, effectiveConfig(store, config)));
  }), { label: 'delivery', log });
  // scanAttacks seeds only never-observed players; restarts resume their windows.
  attacks(); movements(); delivery();
  const timers = [
    setIntervalFn(attacks, config.oneStar.intervalMinutes * 60000),
    setIntervalFn(movements, config.movements.intervalMinutes * 60000),
    setIntervalFn(delivery, config.delivery.intervalSeconds * 1000),
  ];
  const servers = [];
  if (startServers && config.commands.enabled) servers.push(startCommandServer(store, config, {
    onCheck: (feature) => { if (feature === 'attacks') attacks(); else movements({ forceCheck: true }); },
  }));
  if (startServers && config.health.enabled) {
    const server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/healthz') { res.writeHead(404).end(); return; }
      const status = statusReport(store, config, now().getTime());
      // Public liveness endpoint exposes no clan/player IDs or error details.
      res.writeHead(status.ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ ok: status.ok, at: status.at, queue: status.queue }));
    });
    server.listen(config.health.port, config.health.host); servers.push(server);
  }
  for (const server of servers) server.on('error', (error) => {
    store.set('error:server', { at: Date.now(), message: error.message });
    log.error('HTTP server failed', error.message);
  });
  return {
    attacks, movements, delivery,
    async stop() {
      stopping = true;
      timers.forEach(clearIntervalFn);
      for (const server of servers) server.close();
      await Promise.allSettled([...active]);
    },
  };
}
export async function main() {
  const runtime = await createRuntime();
  const daemon = startDaemon(runtime);
  console.log('[daemon] started; persistent queue, recovery window and season ranking enabled');
  let exiting = false;
  const shutdown = async (reason, code = 0) => {
    if (exiting) return; exiting = true;
    console.log(`[daemon] ${reason}: waiting for active tasks`);
    const deadline = setTimeout(() => process.exit(code || 1), 30000);
    try { await daemon.stop(); runtime.close(); clearTimeout(deadline); process.exitCode = code; }
    catch (error) { console.error(error.message); process.exit(1); }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (error) => { console.error(error); shutdown('unhandled rejection', 1); });
  process.on('uncaughtException', (error) => { console.error(error); shutdown('uncaught exception', 1); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

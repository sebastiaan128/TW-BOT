// src/daemon.js
// Always-on entrypoint for hosts that keep a single process running (e.g.
// Pterodactyl-based Discord bot hosting). Replaces external cron: it runs the
// existing one-shot run() functions on internal timers. All scheduling state is
// in-memory; the per-feature dedup files still prevent double posts on restart.
import { existsSync } from 'node:fs';
import { run as runMovements } from './index.js';
import { run as runOneStar } from './onestar.js';
import { loadConfig } from './config.js';
import { guarded, makeMondayGate } from './scheduler.js';

const MINUTE = 60 * 1000;
export const ONESTAR_INTERVAL_MS = 15 * MINUTE;   // 1-star shame: every 15 minutes
export const MOVEMENTS_TICK_MS = 60 * MINUTE;     // promotion/demotion: hourly tick, gated to Mondays

// A "fresh install" has no 1-star dedup file yet. Posting normally on the very
// first boot would treat every existing battlelog attack as new and flood the
// channel, so the boot pass seeds state with mark-seen instead.
function defaultIsFreshInstall() {
  try {
    return !existsSync(loadConfig().oneStar.statePath);
  } catch {
    return false; // config not loadable yet: don't claim fresh, let the run surface the error
  }
}

export function startDaemon({
  runOneStarFn = (opts) => runOneStar(opts),
  runMovementsFn = (opts) => runMovements(opts),
  isFreshInstall = defaultIsFreshInstall,
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  log = console,
} = {}) {
  const onestarTask = guarded(runOneStarFn, { label: 'onestar', log });
  const movementsTask = guarded(runMovementsFn, { label: 'movements', log });
  const mondayGate = makeMondayGate({ now });

  // The promotion check fires at most once per Monday; the hourly tick just
  // asks the gate whether today is that Monday yet. A mark-seen boot pass runs
  // regardless of weekday — it only records the current reset as seen.
  const movementsTick = async (opts = {}) => {
    if (opts.markSeen) { await movementsTask(opts); return; }
    if (mondayGate()) await movementsTask();
  };

  // Boot pass: seed state on a fresh install, otherwise run for real. Runs
  // immediately so the bot works the moment the host starts it.
  const fresh = isFreshInstall();
  if (fresh) log.log?.('[daemon] fresh install — seeding state (mark-seen), not posting this round');
  const bootOpts = fresh ? { markSeen: true } : {};
  onestarTask(bootOpts);
  movementsTick(bootOpts);

  const timers = [
    setIntervalFn(() => onestarTask(), ONESTAR_INTERVAL_MS),
    setIntervalFn(() => movementsTick(), MOVEMENTS_TICK_MS),
  ];

  return {
    stop: () => timers.forEach((t) => clearIntervalFn(t)),
    onestarTask,
    movementsTask,
  };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  // The hosting panel starts `node src/daemon.js` without --env-file, so load a
  // local .env ourselves if present. Env vars set directly on the host also work.
  try { process.loadEnvFile('.env'); } catch { /* no .env file: rely on real env vars */ }

  startDaemon();
  console.log('[daemon] started — onestar every 15m, promotion check on Mondays (Europe/Amsterdam)');
  const shutdown = (sig) => { console.log(`[daemon] ${sig} received, shutting down`); process.exit(0); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

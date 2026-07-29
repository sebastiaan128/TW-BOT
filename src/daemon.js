// src/daemon.js
// Always-on entrypoint for hosts that keep a single process running (e.g.
// Pterodactyl-based Discord bot hosting). Replaces external cron: it runs the
// existing one-shot run() functions on internal timers. All scheduling state is
// in-memory; the per-feature dedup files still prevent double posts on restart.
import { existsSync, readFileSync } from 'node:fs';
import { run as runMovements } from './index.js';
import { run as runOneStar } from './onestar.js';
import { loadConfig } from './config.js';
import { guarded, makeMondayGate } from './scheduler.js';

const MINUTE = 60 * 1000;
export const ONESTAR_INTERVAL_MS = 15 * MINUTE;   // 1-star shame: every 15 minutes
export const MOVEMENTS_TICK_MS = 60 * MINUTE;     // promotion/demotion: hourly tick, gated to Mondays from ~10:00 Amsterdam

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

// Movement detection compares live tiers against a stored per-player baseline.
// Until that baseline exists (no snapshot, or an old snapshot with no `tiers`
// key), the first real run would treat everyone as new and post nothing — so we
// seed it on boot instead, regardless of weekday.
function defaultMovementsNeedsSeed() {
  try {
    const path = loadConfig().snapshotPath;
    if (!existsSync(path)) return true;
    return !JSON.parse(readFileSync(path, 'utf8')).tiers;
  } catch {
    return false; // config/snapshot not readable: don't seed, let the run surface it
  }
}

export function startDaemon({
  runOneStarFn = (opts) => runOneStar(opts),
  runMovementsFn = (opts) => runMovements(opts),
  isFreshInstall = defaultIsFreshInstall,
  movementsNeedsSeed = defaultMovementsNeedsSeed,
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  log = console,
} = {}) {
  const onestarTask = guarded(runOneStarFn, { label: 'onestar', log });
  const movementsTask = guarded(runMovementsFn, { label: 'movements', log });
  const mondayGate = makeMondayGate({ now });

  // The promotion/demotion check fires at most once per Monday, from ~10:00
  // Amsterdam onward; the hourly tick just asks the gate whether it's that
  // Monday-after-10:00 yet. A mark-seen boot pass runs regardless of weekday/hour
  // — it only records the current reset as seen.
  const movementsTick = async (opts = {}) => {
    if (opts.markSeen) { await movementsTask(opts); return; }
    if (mondayGate()) await movementsTask();
  };

  // Boot pass: seed state where a baseline is missing, otherwise run for real.
  // Runs immediately so the bot works the moment the host starts it. The two
  // features have independent baselines, so they are seeded independently.
  const onestarFresh = isFreshInstall();
  if (onestarFresh) log.log?.('[daemon] onestar: fresh install — seeding state (mark-seen), not posting this round');
  else log.log?.('[daemon] onestar: existing state found — running normally');
  onestarTask(onestarFresh ? { markSeen: true } : {});

  if (movementsNeedsSeed()) {
    log.log?.('[daemon] movements: no tier baseline yet — seeding (mark-seen), not posting this round');
    movementsTask({ markSeen: true }); // bypass the Monday gate: seeding is safe any day
  } else {
    movementsTick(); // normal: gated to Mondays from ~10:00 Amsterdam
  }

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
  console.log('[daemon] started — onestar every 15m, promotion/demotion check Mondays from ~10:00 (Europe/Amsterdam)');
  const shutdown = (sig) => { console.log(`[daemon] ${sig} received, shutting down`); process.exit(0); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

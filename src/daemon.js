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

  // Boot pass. Runs immediately so the bot works the moment the host starts it.
  //
  // onestar ALWAYS seeds on boot (mark-seen): after any downtime the current
  // battlelog would otherwise all count as "new" and be rendered+posted at once,
  // which floods the channel and OOM-kills the container. Seeding records the
  // current attacks as seen without posting, so only attacks that happen while
  // the bot is online get posted. The 15-min tick does the real posting.
  log.log?.('[daemon] onestar: seeding current battlelog as baseline — only posting attacks from now on');
  onestarTask({ markSeen: true });

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

  // Keep the always-on process up and, crucially, print the cause when something
  // slips past the per-task guards. Without this a stray async error terminates
  // Node, which a hosting panel then shows as an opaque restart/crash loop. We
  // log and stay alive so the timers keep firing and the stack is visible.
  process.on('unhandledRejection', (reason) => {
    console.error('[daemon] unhandledRejection:', reason?.stack ?? reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[daemon] uncaughtException:', err?.stack ?? err);
  });

  try {
    startDaemon();
    console.log('[daemon] started — onestar every 15m, promotion/demotion check Mondays from ~10:00 (Europe/Amsterdam)');
  } catch (e) {
    // A synchronous failure in startup (bad config/env, etc.) — surface it clearly
    // instead of letting the process die with a bare stack the panel hides.
    console.error('[daemon] failed to start:', e?.stack ?? e);
    process.exit(1);
  }
  const shutdown = (sig) => { console.log(`[daemon] ${sig} received, shutting down`); process.exit(0); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

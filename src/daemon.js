// src/daemon.js
// Always-on entrypoint for hosts that keep a single process running (e.g.
// Pterodactyl-based Discord bot hosting). Replaces external cron: it runs the
// existing one-shot run() functions on internal timers. All scheduling state is
// in-memory; the per-feature dedup files still prevent double posts on restart.
import { run as runMovements } from './index.js';
import { run as runOneStar } from './onestar.js';
import { guarded, makeMondayGate } from './scheduler.js';

const MINUTE = 60 * 1000;
export const ONESTAR_INTERVAL_MS = 15 * MINUTE;   // 1-star shame: every 15 minutes
export const MOVEMENTS_TICK_MS = 60 * MINUTE;     // promotion/demotion: hourly tick, gated to Mondays

export function startDaemon({
  runOneStarFn = () => runOneStar(),
  runMovementsFn = () => runMovements(),
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  log = console,
} = {}) {
  const onestarTask = guarded(runOneStarFn, { label: 'onestar', log });
  const movementsTask = guarded(runMovementsFn, { label: 'movements', log });
  const mondayGate = makeMondayGate({ now });

  // The promotion check fires at most once per Monday; the hourly tick just
  // asks the gate whether today is that Monday yet.
  const movementsTick = async () => { if (mondayGate()) await movementsTask(); };

  // Do a pass immediately on boot so the bot works the moment the host starts it.
  onestarTask();
  movementsTick();

  const timers = [
    setIntervalFn(onestarTask, ONESTAR_INTERVAL_MS),
    setIntervalFn(movementsTick, MOVEMENTS_TICK_MS),
  ];

  return {
    stop: () => timers.forEach((t) => clearIntervalFn(t)),
    onestarTask,
    movementsTask,
  };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  startDaemon();
  console.log('[daemon] started — onestar every 15m, promotion check on Mondays (Europe/Amsterdam)');
  const shutdown = (sig) => { console.log(`[daemon] ${sig} received, shutting down`); process.exit(0); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// src/scheduler.js
// Small, testable helpers for the always-on daemon: overlap-safe task wrapping
// and "run once per Monday" gating in a fixed timezone.

// Wrap an async task so it (a) never throws and (b) never overlaps itself.
// If a previous invocation is still running when called again, the call is
// skipped — a slow run must never let ticks stack up.
export function guarded(fn, { label = 'task', log = console } = {}) {
  let running = false;
  return async function (...args) {
    if (running) {
      log.warn?.(`[${label}] previous run still in progress; skipping tick`);
      return { skipped: true };
    }
    running = true;
    try {
      const result = await fn(...args);
      return { result };
    } catch (e) {
      log.error?.(`[${label}] run failed: ${e.message}`);
      return { error: e };
    } finally {
      running = false;
    }
  };
}

const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// ISO weekday (1=Mon .. 7=Sun) for a date as observed in a given IANA timezone.
export function weekdayInZone(date, timeZone) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return WEEKDAY[label];
}

// Calendar date (YYYY-MM-DD) as observed in a given IANA timezone.
export function dayKeyInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// Hour of day (0..23) as observed in a given IANA timezone. DST-aware.
export function hourInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  return Number(hour) % 24; // hour12:false can render midnight as '24' in some engines
}

// Returns a gate function that yields true on Mondays (in the given timezone)
// from `afterHour` local time onward. With an hourly tick this fires at the
// first tick at/after `afterHour` — i.e. ~10:00.
//
// `once: true` fires at most once per Monday. The daemon uses `once: false`:
// movement detection now needs to see a tier change on two separate runs before
// announcing it (see src/movements.js), so a single run per Monday could never
// confirm anything. Re-running is safe — a confirmed move is committed to the
// baseline, so later ticks that day see no change and post nothing.
export function makeMondayGate({
  timeZone = 'Europe/Amsterdam', afterHour = 10, once = true, now = () => new Date(),
} = {}) {
  let lastFiredDay = null;
  return function shouldRun() {
    const d = now();
    if (weekdayInZone(d, timeZone) !== 1) return false;
    if (hourInZone(d, timeZone) < afterHour) return false;
    const key = dayKeyInZone(d, timeZone);
    if (once && key === lastFiredDay) return false;
    lastFiredDay = key;
    return true;
  };
}

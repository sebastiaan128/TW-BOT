import { eventId } from './store.js';
import { resetWindow } from './calendar.js';
import { hourInZone } from './scheduler.js';

export const escapeText = (value) => String(value).replace(/[\\`*_~|<>@]/g, '').replace(/[\r\n]/g, ' ').slice(0, 80);
export function rankingText(store, config, { season = store.get('season')?.id, clan } = {}) {
  if (!season) return 'Nog geen seizoen opgehaald. Start eerst een aanvalcontrole.';
  const rows = store.ranking(season, { clan, limit: config.ranking.top });
  const lines = rows.map((row, index) => `${index + 1}. **${escapeText(row.name)}** — ${row.oneStars}× 1 ster (${row.attacks} aanvallen, ${Math.round(row.oneStars / row.attacks * 100)}%)`);
  const info = store.get(`season:${season}`);
  const quality = store.get(`coverage:${season}`, { gaps: 0, failures: 0 });
  return [`**TW · 1-ster-ranking · ${escapeText(info?.label ?? (info?.start ? new Date(info.start).toISOString().slice(0, 10) : season))}**`, clan ? `Clan: ${escapeText(clan)}` : 'Alle gevolgde clans',
    ...lines, ...(rows.length ? [] : ['Nog geen waargenomen aanvallen in dit seizoen.']),
    `Bron: ${info?.source ?? 'opgeslagen historie'}. Alleen waargenomen aanvallen; gestart ${new Date(store.get('trackingStartedAt', Date.now())).toISOString().slice(0, 10)}.`,
    ...(quality.gaps || quality.failures ? [`Dekking: ${quality.gaps} gaten in logs · ${quality.failures} mislukte aanvragen. Ranking kan onvolledig zijn.`] : []),
    'Aanvallen zonder tijdstip tellen op waarneming; onzekere seizoensovergangen staan apart.'].join('\n').slice(0, 1990);
}
export function weeklyText(store, reset) {
  const since = Date.parse(`${reset}T00:00:00Z`);
  const rows = store.events({ since, limit: 10000 }).filter((e) => ['promoted', 'demoted'].includes(e.type) && e.payload.reset === reset);
  const clans = new Map();
  for (const row of rows) {
    const totals = clans.get(row.clan ?? 'onbekend') ?? { promoted: 0, demoted: 0 };
    totals[row.type]++; clans.set(row.clan ?? 'onbekend', totals);
  }
  return [`**TW · Weekoverzicht · ${reset}**`, ...[...clans].map(([clan, t]) => `${escapeText(clan)}: ${t.promoted} promoties · ${t.demoted} degradaties`),
    ...(rows.length ? [] : ['Geen bevestigde bewegingen waargenomen.']),
    `${rows.filter((e) => e.status === 'pending').length} meldingen wachten nog op verzending.`].join('\n').slice(0, 1990);
}
export function enqueueReports(store, config, now = Date.now()) {
  const window = resetWindow(new Date(now), { ...config.movements, timeZone: config.timeZone });
  const hour = hourInZone(new Date(now), config.timeZone);
  // Publish the reset report on Wednesday evening after the recovery window,
  // not Monday while confirmations are still arriving.
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const elapsedDays = Math.round((Date.parse(`${localDate}T12:00:00Z`) - Date.parse(`${window.key}T12:00:00Z`)) / 86400000);
  const result = [];
  store.transaction(() => {
    if (config.summary.enabled && elapsedDays >= config.movements.recoveryDays && hour >= config.summary.afterHour) {
      const health = store.get('health:movements');
      if (health?.at >= Date.parse(`${window.key}T00:00:00Z`)) {
        const event = { id: eventId('summary', window.key), type: 'summary', payload: { content: weeklyText(store, window.key) } };
        if (store.enqueue(event, now)) result.push(event);
      }
    }
    const season = store.get('season');
    if (config.ranking.enabled && season) {
      const previous = store.get('ranking:lastSeason');
      if (previous && previous !== season.id) {
        const event = { id: eventId('ranking', previous), type: 'ranking', payload: { content: rankingText(store, config, { season: previous }) } };
        if (store.enqueue(event, now)) result.push(event);
      }
      store.set('ranking:lastSeason', season.id);
    }
  });
  return result;
}
export function statusReport(store, config, now = Date.now()) {
  const tasks = {};
  for (const task of ['movements', 'attacks', 'delivery']) {
    const health = store.get(`health:${task}`);
    const minutes = task === 'movements' ? config.movements.intervalMinutes : task === 'attacks' ? config.oneStar.intervalMinutes : config.delivery.intervalSeconds / 60;
    const expected = task === 'movements' ? resetWindow(new Date(now), { ...config.movements, timeZone: config.timeZone }).open : true;
    const feature = task === 'attacks' ? 'oneStar' : task;
    const active = config[feature]?.enabled !== false && store.get(`enabled:${feature}`, true);
    tasks[task] = { ...health, enabled: active, expected, stale: active && expected && (!health?.at || now - health.at > minutes * 3 * 60000), error: store.get(`error:${task}`) };
  }
  const queue = store.counts();
  return { ok: !queue.uncertain && !queue.failed && !store.get('error:server') && Object.values(tasks).every((t) => !t.enabled || (!t.stale && !t.error && !t.failed?.length && !t.gaps?.length)),
    at: now, tasks, queue, season: store.get('season'), trackingStartedAt: store.get('trackingStartedAt') };
}

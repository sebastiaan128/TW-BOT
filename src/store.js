import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const eventId = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export class Store {
  constructor(path = 'data/bot.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, player TEXT NOT NULL, clan TEXT,
        payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        created INTEGER NOT NULL, updated INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        available INTEGER NOT NULL DEFAULT 0, message_id TEXT, channel_id TEXT, error TEXT
      );
      CREATE TABLE IF NOT EXISTS attacks (
        id TEXT PRIMARY KEY, season TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL, clan TEXT,
        stars INTEGER NOT NULL, destruction REAL NOT NULL, observed INTEGER NOT NULL, attribution TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS attacks_season ON attacks(season,player);
      CREATE INDEX IF NOT EXISTS events_queue ON events(status, available, created);
      CREATE INDEX IF NOT EXISTS events_player ON events(player, created);`);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM state WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key, value) {
    this.db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }
  enqueue(event, now = Date.now()) {
    return this.db.prepare(`INSERT OR IGNORE INTO events(id,type,player,clan,payload,created,updated)
      VALUES (?,?,?,?,?,?,?)`).run(event.id, event.type, event.player ?? '', event.clan ?? null, JSON.stringify(event.payload), now, now).changes;
  }
  events({ status, since = 0, player, limit = 1000 } = {}) {
    const where = ['created>=?']; const args = [since];
    if (status) { where.push('status=?'); args.push(status); }
    if (player) { where.push('player=?'); args.push(player); }
    return this.db.prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY created,id LIMIT ?`)
      .all(...args, limit).map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  event(id) {
    const row = this.db.prepare('SELECT * FROM events WHERE id=?').get(id);
    return row && { ...row, payload: JSON.parse(row.payload) };
  }
  updateEvent(id, status, { messageId = null, channelId = null, error = null, available = 0, now = Date.now() } = {}) {
    this.db.prepare(`UPDATE events SET status=?, updated=?, message_id=COALESCE(?,message_id),
      channel_id=COALESCE(?,channel_id), error=?, available=?, attempts=attempts+CASE WHEN ?='sending' THEN 1 ELSE 0 END WHERE id=?`)
      .run(status, now, messageId, channelId, error, available, status, id);
  }
  recordAttack(attack) {
    return this.db.prepare('INSERT OR IGNORE INTO attacks VALUES (?,?,?,?,?,?,?,?,?)')
      .run(attack.id, attack.season, attack.player, attack.name, attack.clan ?? null, attack.stars, attack.destruction, attack.observed, attack.attribution).changes;
  }
  ranking(season, { clan, limit = 20 } = {}) {
    return this.db.prepare(`SELECT player, MAX(name) AS name, count(*) AS attacks,
      sum(CASE WHEN stars=1 THEN 1 ELSE 0 END) AS oneStars,
      round(avg(destruction),1) AS averageDestruction,
      sum(CASE WHEN attribution IN ('observed','boundary-unknown') THEN 1 ELSE 0 END) AS estimated
      FROM attacks WHERE season=? ${clan ? 'AND clan=?' : ''} GROUP BY player
      ORDER BY oneStars DESC, player ASC LIMIT ?`).all(...(clan ? [season, clan, limit] : [season, limit]));
  }
  seasons() { return this.db.prepare('SELECT season,count(*) AS attacks FROM attacks GROUP BY season ORDER BY season DESC').all(); }
  playerStats(tag, season) {
    return this.db.prepare(`SELECT season, count(*) AS attacks, sum(CASE WHEN stars=1 THEN 1 ELSE 0 END) AS oneStars,
      round(avg(stars),2) AS averageStars, round(avg(destruction),1) AS averageDestruction
      FROM attacks WHERE player=? ${season ? 'AND season=?' : ''} GROUP BY season ORDER BY season DESC`).all(...(season ? [tag, season] : [tag]));
  }
  counts() { return Object.fromEntries(this.db.prepare('SELECT status,count(*) AS n FROM events GROUP BY status').all().map((r) => [r.status, r.n])); }
  async locked(name, fn, { ttlMs = 300000 } = {}) {
    const owner = randomUUID();
    const acquired = this.db.prepare(`INSERT INTO leases VALUES (?,?,?) ON CONFLICT(name)
      DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE leases.expires<?`)
      .run(name, owner, Date.now() + ttlMs, Date.now()).changes;
    if (!acquired) return { skipped: true, reason: `${name} already running` };
    let lost = false;
    const heartbeat = setInterval(() => {
      try { if (!this.db.prepare('UPDATE leases SET expires=? WHERE name=? AND owner=?').run(Date.now() + ttlMs, name, owner).changes) lost = true; }
      catch { lost = true; }
    }, Math.max(20, Math.floor(ttlMs / 3)));
    heartbeat.unref();
    const assertLease = () => {
      const lease = this.db.prepare('SELECT owner,expires FROM leases WHERE name=?').get(name);
      if (lost || lease?.owner !== owner || lease.expires < Date.now()) throw new Error(`Lost ${name} lease`);
    };
    try { return await fn(assertLease); }
    finally { clearInterval(heartbeat); this.db.prepare('DELETE FROM leases WHERE name=? AND owner=?').run(name, owner); }
  }
}

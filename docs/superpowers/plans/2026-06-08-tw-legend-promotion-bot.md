# TW Legend League Promotie/Degradatie-bot — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een Node.js cron-script dat elke maandagochtend TW-leden detecteert die in-game tussen Legend League I en II zijn gepromoveerd/gedegradeerd, en per persoon de juiste graphic met username in Discord post.

**Architecture:** Stateless cron-script. Het haalt via de officiële CoC API alle leden van de geconfigureerde TW-clans op, bepaalt per speler de Legend-tier, vergelijkt met een lokale snapshot van vorige week, rendert per overgang (II→I = promoted, I→II = demoted) een PNG met de username op de balk, en post die via een Discord webhook. De snapshot wordt pas weggeschreven nadat ophalen én posten geslaagd zijn.

**Tech Stack:** Node.js (≥20.6 voor `--env-file`), native `fetch`/`FormData`, `@napi-rs/canvas` voor image-rendering, ingebouwde `node --test` testrunner. Geen database — JSON-bestand als snapshot-store.

---

## Bestandsstructuur

```
TW-BOT/
  package.json
  .gitignore
  .env.example
  config.json                 # clan tags, render-coördinaten, berichten
  assets/
    Promoted.png              # verplaatst vanuit repo-root
    Demoted.png               # verplaatst vanuit repo-root
    fonts/                    # (optioneel) gebundelde TTF voor consistente tekst
  src/
    config.js                 # laadt config.json + secrets uit env
    util.js                   # withRetry
    coc.js                    # CoC API + getTier + buildCurrentSnapshot
    snapshot.js               # readSnapshot / writeSnapshot
    diff.js                   # pure diffSnapshots
    render.js                 # renderUsername (canvas)
    discord.js                # postGraphic (webhook)
    index.js                  # run() orkestratie + CLI
  scripts/
    probe-tier.js             # dumpt ruwe API-respons om tier-veld te bevestigen
  test/
    config.test.js
    util.test.js
    coc.test.js
    snapshot.test.js
    diff.test.js
    render.test.js
    discord.test.js
    index.test.js
  data/                       # runtime, gitignored — last-snapshot.json
  out/                        # dry-run output, gitignored
```

**Module-interfaces (consistent over alle taken):**

- `loadConfig(path='config.json')` → `{ cocApiKey, webhookUrl, clanTags, render, messages, snapshotPath, outDir }`
- `withRetry(fn, opts)` → resultaat van `fn`, met exponentiële backoff
- `fetchClanMembers(clanTag, apiKey, { fetchImpl })` → `Array<member>`
- `getTier(member)` → `'I' | 'II' | 'III' | null`
- `buildCurrentSnapshot(clanTags, apiKey, { fetchImpl, now })` → `{ takenAt, players: { [tag]: { name, tier } } }`
- `readSnapshot(path)` → snapshot of `null`; `writeSnapshot(path, snapshot)` → `void`
- `diffSnapshots(previous, current)` → `{ promotions: [{tag,name}], demotions: [{tag,name}] }`
- `renderUsername(type, username, renderConfig)` → `Buffer` (PNG); `type` is `'promoted'|'demoted'`
- `postGraphic(webhookUrl, { filename, imageBuffer, content }, { fetchImpl })` → response
- `run(options, deps)` → `{ firstRun, posted }`

---

## Task 1: Project-scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Move: `Promoted.png` → `assets/Promoted.png`, `Demoted.png` → `assets/Demoted.png`

- [ ] **Step 1: Maak `package.json`**

```json
{
  "name": "tw-bot",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20.6" },
  "scripts": {
    "test": "node --test",
    "start": "node --env-file=.env src/index.js",
    "dry-run": "node --env-file=.env src/index.js --dry-run",
    "probe": "node --env-file=.env scripts/probe-tier.js"
  },
  "dependencies": {
    "@napi-rs/canvas": "^0.1.65"
  }
}
```

- [ ] **Step 2: Maak `.gitignore`**

```gitignore
node_modules/
data/
out/
.env
```

- [ ] **Step 3: Maak `.env.example`**

```bash
# CoC API key van https://developer.clashofclans.com/ (IP-locked op de cron-host)
COC_API_KEY=
# Discord webhook-URL van het doelkanaal
DISCORD_WEBHOOK_URL=
```

- [ ] **Step 4: Verplaats de assets**

```bash
mkdir -p assets
git mv Promoted.png assets/Promoted.png
git mv Demoted.png assets/Demoted.png
```

- [ ] **Step 5: Installeer dependencies**

Run: `npm install`
Expected: `node_modules/` aangemaakt, `@napi-rs/canvas` geïnstalleerd, geen errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example assets/
git commit -m "chore: scaffold tw-bot project and move assets"
```

---

## Task 2: config.json + config.js

**Files:**
- Create: `config.json`
- Create: `src/config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Maak `config.json`**

> Coördinaten zijn in de 5504×3072-ruimte en zijn beginschattingen; ze worden in Task 11 met een dry-run fijngetuned. Beide graphics hebben dezelfde layout (zelfde balkpositie), alleen de tekstkleur verschilt.

```json
{
  "clanTags": ["#REPLACE_WITH_TW_CLAN_TAG_1", "#REPLACE_WITH_TW_CLAN_TAG_2"],
  "snapshotPath": "data/last-snapshot.json",
  "outDir": "out",
  "messages": {
    "promoted": "🎉 Gefeliciteerd met je promotie naar Legend 1!",
    "demoted": ""
  },
  "render": {
    "promoted": {
      "assetPath": "assets/Promoted.png",
      "x": 4150, "y": 2180, "maxWidth": 2200,
      "color": "#2a1a0a", "fontFamily": "sans-serif",
      "fontWeight": "bold", "baseFontSize": 220,
      "fontPath": "assets/fonts/Anton-Regular.ttf"
    },
    "demoted": {
      "assetPath": "assets/Demoted.png",
      "x": 4150, "y": 2180, "maxWidth": 2200,
      "color": "#f5e9d0", "fontFamily": "sans-serif",
      "fontWeight": "bold", "baseFontSize": 220,
      "fontPath": "assets/fonts/Anton-Regular.ttf"
    }
  }
}
```

- [ ] **Step 2: Schrijf de falende test**

```javascript
// test/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

const TMP = 'test/tmp-config.json';
function withTmpConfig(obj, fn) {
  writeFileSync(TMP, JSON.stringify(obj));
  try { return fn(); } finally { rmSync(TMP, { force: true }); }
}

test('loadConfig merges file + env secrets', () => {
  process.env.COC_API_KEY = 'key123';
  process.env.DISCORD_WEBHOOK_URL = 'https://hook';
  withTmpConfig({ clanTags: ['#ABC'], render: { promoted: {} } }, () => {
    const cfg = loadConfig(TMP);
    assert.equal(cfg.cocApiKey, 'key123');
    assert.equal(cfg.webhookUrl, 'https://hook');
    assert.deepEqual(cfg.clanTags, ['#ABC']);
    assert.equal(cfg.snapshotPath, 'data/last-snapshot.json');
    assert.equal(cfg.outDir, 'out');
  });
});

test('loadConfig throws when COC_API_KEY missing', () => {
  delete process.env.COC_API_KEY;
  process.env.DISCORD_WEBHOOK_URL = 'https://hook';
  withTmpConfig({ clanTags: [] }, () => {
    assert.throws(() => loadConfig(TMP), /COC_API_KEY/);
  });
});
```

- [ ] **Step 3: Run test om te verifiëren dat hij faalt**

Run: `node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 4: Schrijf de minimale implementatie**

```javascript
// src/config.js
import { readFileSync } from 'node:fs';

export function loadConfig(path = 'config.json') {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const cocApiKey = process.env.COC_API_KEY;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!cocApiKey) throw new Error('COC_API_KEY env var is required');
  if (!webhookUrl) throw new Error('DISCORD_WEBHOOK_URL env var is required');
  return {
    cocApiKey,
    webhookUrl,
    clanTags: file.clanTags ?? [],
    render: file.render ?? {},
    messages: file.messages ?? {},
    snapshotPath: file.snapshotPath ?? 'data/last-snapshot.json',
    outDir: file.outDir ?? 'out',
  };
}
```

- [ ] **Step 5: Run test om te verifiëren dat hij slaagt**

Run: `node --test test/config.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add config.json src/config.js test/config.test.js
git commit -m "feat: add config loader merging config.json and env secrets"
```

---

## Task 3: util.js — withRetry

**Files:**
- Create: `src/util.js`
- Test: `test/util.test.js`

- [ ] **Step 1: Schrijf de falende test**

```javascript
// test/util.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../src/util.js';

const noSleep = () => Promise.resolve();

test('withRetry returns on first success', async () => {
  let calls = 0;
  const r = await withRetry(async () => { calls++; return 'ok'; }, { sleep: noSleep });
  assert.equal(r, 'ok');
  assert.equal(calls, 1);
});

test('withRetry retries then succeeds', async () => {
  let calls = 0;
  const r = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('boom');
    return 'ok';
  }, { sleep: noSleep });
  assert.equal(r, 'ok');
  assert.equal(calls, 3);
});

test('withRetry throws after exhausting retries', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new Error('boom'); }, { retries: 2, sleep: noSleep }),
    /boom/
  );
  assert.equal(calls, 3); // initial + 2 retries
});
```

- [ ] **Step 2: Run test om te verifiëren dat hij faalt**

Run: `node --test test/util.test.js`
Expected: FAIL — `Cannot find module '../src/util.js'`.

- [ ] **Step 3: Schrijf de minimale implementatie**

```javascript
// src/util.js
export async function withRetry(fn, { retries = 3, baseDelayMs = 500, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await wait(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}
```

- [ ] **Step 4: Run test om te verifiëren dat hij slaagt**

Run: `node --test test/util.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/util.js test/util.test.js
git commit -m "feat: add withRetry helper with exponential backoff"
```

---

## Task 4: coc.js — getTier

> **Belangrijk:** `getTier` is de enige plek die het Legend-tier-veld uit de API interpreteert. De fixtures hieronder gaan uit van de meest waarschijnlijke vorm na de Ranked-update: `member.league.name` bevat een Romeins cijfer of getal ("Legend League I", "Legend League II", "Legend League III"). **Task 5 (probe) bevestigt dit tegen de live API**; wijkt de echte vorm af, dan pas je alléén de regex/lookup in deze functie aan plus de fixtures.

**Files:**
- Create: `src/coc.js`
- Test: `test/coc.test.js`

- [ ] **Step 1: Schrijf de falende test**

```javascript
// test/coc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTier } from '../src/coc.js';

test('getTier reads Legend tiers from league name', () => {
  assert.equal(getTier({ league: { name: 'Legend League I' } }), 'I');
  assert.equal(getTier({ league: { name: 'Legend League II' } }), 'II');
  assert.equal(getTier({ league: { name: 'Legend League III' } }), 'III');
});

test('getTier handles digit form', () => {
  assert.equal(getTier({ league: { name: 'Legend League 1' } }), 'I');
  assert.equal(getTier({ league: { name: 'Legend League 2' } }), 'II');
});

test('getTier returns null for non-legend or missing league', () => {
  assert.equal(getTier({ league: { name: 'Titan League I' } }), null);
  assert.equal(getTier({}), null);
  assert.equal(getTier({ league: null }), null);
});
```

- [ ] **Step 2: Run test om te verifiëren dat hij faalt**

Run: `node --test test/coc.test.js`
Expected: FAIL — `Cannot find module '../src/coc.js'`.

- [ ] **Step 3: Schrijf de minimale implementatie**

```javascript
// src/coc.js
import { withRetry } from './util.js';

const API_BASE = 'https://api.clashofclans.com/v1';
const TIER_BY_TOKEN = { I: 'I', '1': 'I', II: 'II', '2': 'II', III: 'III', '3': 'III' };

export function getTier(member) {
  const name = member?.league?.name;
  if (!name) return null;
  const m = name.match(/legend\s*league\s*(III|II|I|[123])/i);
  if (!m) return null;
  return TIER_BY_TOKEN[m[1].toUpperCase()] ?? null;
}
```

- [ ] **Step 4: Run test om te verifiëren dat hij slaagt**

Run: `node --test test/coc.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/coc.js test/coc.test.js
git commit -m "feat: add getTier to interpret Legend League tier from API"
```

---

## Task 5: probe-tier.js + live verificatie-checkpoint

> Dit is de verificatie-eerste stap uit de spec. Bevestigt dat `getTier` matcht met de echte API vóór er verder gebouwd wordt.

**Files:**
- Create: `scripts/probe-tier.js`

- [ ] **Step 1: Schrijf het probe-script**

```javascript
// scripts/probe-tier.js
import { loadConfig } from '../src/config.js';
import { fetchClanMembers, getTier } from '../src/coc.js';

const config = loadConfig();
const clanTag = process.argv[2] || config.clanTags[0];
if (!clanTag || clanTag.includes('REPLACE')) {
  console.error('Geef een echte clan tag mee: npm run probe -- "#TAG"');
  process.exit(1);
}

const members = await fetchClanMembers(clanTag, config.cocApiKey);
console.log(`Clan ${clanTag}: ${members.length} leden\n`);
for (const m of members) {
  console.log(`${m.name.padEnd(20)} league=${JSON.stringify(m.league)}  -> getTier=${getTier(m)}`);
}
```

> Let op: dit script gebruikt `fetchClanMembers`, dat in Task 6 wordt toegevoegd. Voer dit checkpoint dus uit ná Task 6, of voeg `fetchClanMembers` eerst toe. (De plan-volgorde plaatst de check bewust hier zodat de bouwer weet dat verificatie vóór snapshot/diff komt.)

- [ ] **Step 2: Commit het script**

```bash
git add scripts/probe-tier.js
git commit -m "feat: add probe script to verify Legend tier API field"
```

- [ ] **Step 3: LIVE CHECKPOINT (handmatig, na Task 6)**

Vul een echte clan tag + `COC_API_KEY` + `DISCORD_WEBHOOK_URL` in `.env` en `config.json` in.
Run: `npm run probe -- "#JOUWCLANTAG"`
Verwacht: per Legend-lid een regel met het ruwe `league`-object en een correcte `getTier`-waarde (`I`/`II`/`III`).

**Als `getTier` `null` of fout teruggeeft voor Legend-spelers:** bekijk het ruwe `league`-object, pas de regex/`TIER_BY_TOKEN` in `src/coc.js` aan, werk de fixtures in `test/coc.test.js` bij, en herhaal tot het klopt. Commit de aanpassing.

---

## Task 6: coc.js — fetchClanMembers + buildCurrentSnapshot

**Files:**
- Modify: `src/coc.js`
- Test: `test/coc.test.js`

- [ ] **Step 1: Schrijf de falende tests (toevoegen aan bestaand bestand)**

```javascript
// test/coc.test.js — toevoegen onderaan
import { fetchClanMembers, buildCurrentSnapshot } from '../src/coc.js';

function fakeFetch(map) {
  return async (url) => {
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => map[key] };
  };
}

test('fetchClanMembers URL-encodes the tag and returns items', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => ({ items: [{ name: 'A' }] }) }; };
  const items = await fetchClanMembers('#ABC', 'key', { fetchImpl });
  assert.match(seenUrl, /%23ABC\/members$/);
  assert.deepEqual(items, [{ name: 'A' }]);
});

test('fetchClanMembers throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(() => fetchClanMembers('#ABC', 'key', { fetchImpl }), /403/);
});

test('buildCurrentSnapshot keeps only legend members keyed by tag', async () => {
  const fetchImpl = fakeFetch({
    '%23C1/members': { items: [
      { tag: '#P1', name: 'Alice', league: { name: 'Legend League I' } },
      { tag: '#P2', name: 'Bob', league: { name: 'Titan League I' } },
    ] },
    '%23C2/members': { items: [
      { tag: '#P3', name: 'Carol', league: { name: 'Legend League II' } },
    ] },
  });
  const snap = await buildCurrentSnapshot(['#C1', '#C2'], 'key', {
    fetchImpl, now: () => new Date('2026-06-01T07:00:00Z'),
  });
  assert.equal(snap.takenAt, '2026-06-01T07:00:00.000Z');
  assert.deepEqual(snap.players, {
    '#P1': { name: 'Alice', tier: 'I' },
    '#P3': { name: 'Carol', tier: 'II' },
  });
});
```

- [ ] **Step 2: Run tests om te verifiëren dat ze falen**

Run: `node --test test/coc.test.js`
Expected: FAIL — `fetchClanMembers`/`buildCurrentSnapshot` is not exported.

- [ ] **Step 3: Breid de implementatie uit**

```javascript
// src/coc.js — toevoegen onder getTier
export async function fetchClanMembers(clanTag, apiKey, { fetchImpl = fetch } = {}) {
  const encoded = encodeURIComponent(clanTag); // '#ABC' -> '%23ABC'
  const res = await fetchImpl(`${API_BASE}/clans/${encoded}/members`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CoC API ${res.status} for clan ${clanTag}`);
  const data = await res.json();
  return data.items ?? [];
}

export async function buildCurrentSnapshot(clanTags, apiKey, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const players = {};
  for (const tag of clanTags) {
    const members = await withRetry(() => fetchClanMembers(tag, apiKey, { fetchImpl }));
    for (const m of members) {
      const tier = getTier(m);
      if (tier) players[m.tag] = { name: m.name, tier };
    }
  }
  return { takenAt: now().toISOString(), players };
}
```

- [ ] **Step 4: Run tests om te verifiëren dat ze slagen**

Run: `node --test test/coc.test.js`
Expected: PASS (alle coc-tests).

- [ ] **Step 5: Commit**

```bash
git add src/coc.js test/coc.test.js
git commit -m "feat: add fetchClanMembers and buildCurrentSnapshot"
```

> **Voer nu Task 5 Step 3 (LIVE CHECKPOINT) uit** voordat je verder gaat.

---

## Task 7: snapshot.js

**Files:**
- Create: `src/snapshot.js`
- Test: `test/snapshot.test.js`

- [ ] **Step 1: Schrijf de falende test**

```javascript
// test/snapshot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { readSnapshot, writeSnapshot } from '../src/snapshot.js';

const PATH = 'test/tmp-data/snap.json';

test('readSnapshot returns null when file is missing', async () => {
  rmSync('test/tmp-data', { recursive: true, force: true });
  assert.equal(await readSnapshot(PATH), null);
});

test('writeSnapshot then readSnapshot roundtrips', async () => {
  const snap = { takenAt: '2026-06-01T07:00:00.000Z', players: { '#P1': { name: 'Alice', tier: 'I' } } };
  await writeSnapshot(PATH, snap);
  assert.deepEqual(await readSnapshot(PATH), snap);
  rmSync('test/tmp-data', { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test om te verifiëren dat hij faalt**

Run: `node --test test/snapshot.test.js`
Expected: FAIL — `Cannot find module '../src/snapshot.js'`.

- [ ] **Step 3: Schrijf de minimale implementatie**

```javascript
// src/snapshot.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readSnapshot(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeSnapshot(path, snapshot) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot, null, 2));
}
```

- [ ] **Step 4: Run test om te verifiëren dat hij slaagt**

Run: `node --test test/snapshot.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/snapshot.js test/snapshot.test.js
git commit -m "feat: add snapshot read/write store"
```

---

## Task 8: diff.js

**Files:**
- Create: `src/diff.js`
- Test: `test/diff.test.js`

- [ ] **Step 1: Schrijf de falende test**

```javascript
// test/diff.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots } from '../src/diff.js';

const prev = { players: {
  '#A': { name: 'Alice', tier: 'II' },  // -> promotes to I
  '#B': { name: 'Bob', tier: 'I' },     // -> demotes to II
  '#C': { name: 'Carol', tier: 'I' },   // -> stays I
  '#D': { name: 'Dave', tier: 'II' },   // -> drops to III (ignored)
  '#E': { name: 'Eve', tier: 'I' },     // -> leaves (ignored)
} };
const curr = { players: {
  '#A': { name: 'Alice', tier: 'I' },
  '#B': { name: 'Bob', tier: 'II' },
  '#C': { name: 'Carol', tier: 'I' },
  '#D': { name: 'Dave', tier: 'III' },
  '#F': { name: 'Frank', tier: 'I' },   // -> new player (ignored)
} };

test('diffSnapshots detects only I<->II transitions', () => {
  const { promotions, demotions } = diffSnapshots(prev, curr);
  assert.deepEqual(promotions, [{ tag: '#A', name: 'Alice' }]);
  assert.deepEqual(demotions, [{ tag: '#B', name: 'Bob' }]);
});

test('diffSnapshots returns empty when previous is null', () => {
  assert.deepEqual(diffSnapshots(null, curr), { promotions: [], demotions: [] });
});
```

- [ ] **Step 2: Run test om te verifiëren dat hij faalt**

Run: `node --test test/diff.test.js`
Expected: FAIL — `Cannot find module '../src/diff.js'`.

- [ ] **Step 3: Schrijf de minimale implementatie**

```javascript
// src/diff.js
export function diffSnapshots(previous, current) {
  const promotions = [];
  const demotions = [];
  if (!previous || !previous.players) return { promotions, demotions };
  const prev = previous.players;
  const curr = current.players;
  for (const tag of Object.keys(curr)) {
    const before = prev[tag];
    const after = curr[tag];
    if (!before) continue;
    if (before.tier === 'II' && after.tier === 'I') promotions.push({ tag, name: after.name });
    else if (before.tier === 'I' && after.tier === 'II') demotions.push({ tag, name: after.name });
  }
  return { promotions, demotions };
}
```

- [ ] **Step 4: Run test om te verifiëren dat hij slaagt**

Run: `node --test test/diff.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/diff.js test/diff.test.js
git commit -m "feat: add diffSnapshots detecting I<->II transitions"
```

---

## Task 9: render.js

**Files:**
- Create: `src/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Schrijf de falende test**

> De test bouwt een kleine fixture-PNG (zodat hij niet afhangt van de 15MB-assets) en geeft een render-config die daarnaar wijst.

```javascript
// test/render.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { renderUsername } from '../src/render.js';

const DIR = 'test/tmp-render';
const ASSET = `${DIR}/fixture.png`;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function setup() {
  mkdirSync(DIR, { recursive: true });
  const c = createCanvas(400, 200);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 400, 200);
  writeFileSync(ASSET, c.toBuffer('image/png'));
}

const cfg = {
  promoted: { assetPath: ASSET, x: 200, y: 100, maxWidth: 380, color: '#000000', fontFamily: 'sans-serif', fontWeight: 'bold', baseFontSize: 40 },
};

test('renderUsername returns a PNG buffer', async () => {
  setup();
  const buf = await renderUsername('promoted', 'Sebastiaan', cfg);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.subarray(0, 4).equals(PNG_SIG));
  rmSync(DIR, { recursive: true, force: true });
});

test('renderUsername fits very long names without throwing', async () => {
  setup();
  const buf = await renderUsername('promoted', 'EenHeelErgLangeGebruikersnaamXYZ', cfg);
  assert.ok(buf.subarray(0, 4).equals(PNG_SIG));
  rmSync(DIR, { recursive: true, force: true });
});

test('renderUsername throws on unknown type', async () => {
  setup();
  await assert.rejects(() => renderUsername('bogus', 'X', cfg), /Unknown render type/);
  rmSync(DIR, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test om te verifiëren dat hij faalt**

Run: `node --test test/render.test.js`
Expected: FAIL — `Cannot find module '../src/render.js'`.

- [ ] **Step 3: Schrijf de minimale implementatie**

```javascript
// src/render.js
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';

export async function renderUsername(type, username, renderConfig) {
  const cfg = renderConfig[type];
  if (!cfg) throw new Error(`Unknown render type: ${type}`);

  if (cfg.fontPath && existsSync(cfg.fontPath)) {
    GlobalFonts.registerFromPath(cfg.fontPath, cfg.fontFamily);
  }

  const img = await loadImage(cfg.assetPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  ctx.fillStyle = cfg.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let fontSize = cfg.baseFontSize;
  const setFont = (s) => { ctx.font = `${cfg.fontWeight ?? 'bold'} ${s}px ${cfg.fontFamily}`; };
  setFont(fontSize);
  while (ctx.measureText(username).width > cfg.maxWidth && fontSize > 10) {
    fontSize -= 2;
    setFont(fontSize);
  }

  ctx.fillText(username, cfg.x, cfg.y);
  return canvas.toBuffer('image/png');
}
```

- [ ] **Step 4: Run test om te verifiëren dat hij slaagt**

Run: `node --test test/render.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: add renderUsername with auto-fit text overlay"
```

---

## Task 10: discord.js

**Files:**
- Create: `src/discord.js`
- Test: `test/discord.test.js`

- [ ] **Step 1: Schrijf de falende test**

```javascript
// test/discord.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postGraphic } from '../src/discord.js';

test('postGraphic posts multipart form to the webhook', async () => {
  let seen = {};
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, text: async () => '' };
  };
  await postGraphic('https://hook', {
    filename: 'promoted-P1.png',
    imageBuffer: Buffer.from([1, 2, 3]),
    content: 'gefeliciteerd',
  }, { fetchImpl });

  assert.equal(seen.url, 'https://hook');
  assert.equal(seen.opts.method, 'POST');
  assert.ok(seen.opts.body instanceof FormData);
  assert.equal(seen.opts.body.get('content'), 'gefeliciteerd');
  assert.ok(seen.opts.body.get('files[0]'));
});

test('postGraphic throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => 'bad' });
  await assert.rejects(
    () => postGraphic('https://hook', { filename: 'x.png', imageBuffer: Buffer.from([1]) }, { fetchImpl }),
    /400/
  );
});
```

- [ ] **Step 2: Run test om te verifiëren dat hij faalt**

Run: `node --test test/discord.test.js`
Expected: FAIL — `Cannot find module '../src/discord.js'`.

- [ ] **Step 3: Schrijf de minimale implementatie**

```javascript
// src/discord.js
export async function postGraphic(webhookUrl, { filename, imageBuffer, content }, { fetchImpl = fetch } = {}) {
  const form = new FormData();
  if (content) form.append('content', content);
  form.append('files[0]', new Blob([imageBuffer], { type: 'image/png' }), filename);

  const res = await fetchImpl(webhookUrl, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${res.status} ${body}`);
  }
  return res;
}
```

- [ ] **Step 4: Run test om te verifiëren dat hij slaagt**

Run: `node --test test/discord.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/discord.js test/discord.test.js
git commit -m "feat: add Discord webhook poster"
```

---

## Task 11: index.js — orkestratie + CLI + dry-run

**Files:**
- Create: `src/index.js`
- Test: `test/index.test.js`

- [ ] **Step 1: Schrijf de falende test**

> `run(options, deps)` accepteert een `deps`-object zodat alle collaborators mockbaar zijn. De tests dekken de spec-foutafhandeling: snapshot wordt NIET geschreven bij fout, en eerste run post niets.

```javascript
// test/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';

function makeDeps(overrides = {}) {
  const calls = { writes: 0, posts: [], renders: [] };
  const deps = {
    loadConfig: () => ({
      cocApiKey: 'k', webhookUrl: 'https://hook', clanTags: ['#C'],
      render: {}, messages: { promoted: 'gz', demoted: '' },
      snapshotPath: 'data/s.json', outDir: 'out',
    }),
    buildCurrentSnapshot: async () => ({ takenAt: 't', players: {
      '#A': { name: 'Alice', tier: 'I' }, '#B': { name: 'Bob', tier: 'II' },
    } }),
    readSnapshot: async () => ({ players: {
      '#A': { name: 'Alice', tier: 'II' }, '#B': { name: 'Bob', tier: 'I' },
    } }),
    writeSnapshot: async () => { calls.writes++; },
    renderUsername: async (type, name) => { calls.renders.push([type, name]); return Buffer.from([1]); },
    postGraphic: async (_url, { filename }) => { calls.posts.push(filename); },
    saveLocal: async () => {},
    ...overrides,
  };
  return { deps, calls };
}

test('run posts one graphic per transition and writes snapshot', async () => {
  const { deps, calls } = makeDeps();
  const result = await run({}, deps);
  assert.equal(result.firstRun, false);
  assert.deepEqual(calls.renders, [['promoted', 'Alice'], ['demoted', 'Bob']]);
  assert.equal(calls.posts.length, 2);
  assert.equal(calls.writes, 1);
});

test('first run writes snapshot and posts nothing', async () => {
  const { deps, calls } = makeDeps({ readSnapshot: async () => null });
  const result = await run({}, deps);
  assert.equal(result.firstRun, true);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes, 1);
});

test('snapshot is NOT written when a post fails', async () => {
  const { deps, calls } = makeDeps({ postGraphic: async () => { throw new Error('discord down'); } });
  await assert.rejects(() => run({}, deps), /discord down/);
  assert.equal(calls.writes, 0);
});

test('snapshot is NOT written when fetching fails', async () => {
  const { deps, calls } = makeDeps({ buildCurrentSnapshot: async () => { throw new Error('api down'); } });
  await assert.rejects(() => run({}, deps), /api down/);
  assert.equal(calls.writes, 0);
});

test('dry-run saves locally and does not post or write snapshot', async () => {
  let saved = 0;
  const { deps, calls } = makeDeps({ saveLocal: async () => { saved++; } });
  await run({ dryRun: true }, deps);
  assert.equal(saved, 2);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes, 0);
});
```

- [ ] **Step 2: Run test om te verifiëren dat hij faalt**

Run: `node --test test/index.test.js`
Expected: FAIL — `Cannot find module '../src/index.js'`.

- [ ] **Step 3: Schrijf de minimale implementatie**

```javascript
// src/index.js
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { buildCurrentSnapshot } from './coc.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import { diffSnapshots } from './diff.js';
import { renderUsername } from './render.js';
import { postGraphic } from './discord.js';

async function saveLocal(dir, filename, buffer) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buffer);
}

const defaultDeps = {
  loadConfig, buildCurrentSnapshot, readSnapshot, writeSnapshot,
  diffSnapshots, renderUsername, postGraphic, saveLocal,
};

export async function run(options = {}, deps = defaultDeps) {
  const { dryRun = false } = options;
  const config = deps.loadConfig();

  const current = await deps.buildCurrentSnapshot(config.clanTags, config.cocApiKey);
  const previous = await deps.readSnapshot(config.snapshotPath);

  if (!previous) {
    if (!dryRun) await deps.writeSnapshot(config.snapshotPath, current);
    return { firstRun: true, posted: [] };
  }

  const { promotions, demotions } = deps.diffSnapshots(previous, current);
  const jobs = [
    ...promotions.map((p) => ({ type: 'promoted', ...p })),
    ...demotions.map((p) => ({ type: 'demoted', ...p })),
  ];

  const posted = [];
  for (const job of jobs) {
    const buffer = await deps.renderUsername(job.type, job.name, config.render);
    const filename = `${job.type}-${job.tag.replace('#', '')}.png`;
    if (dryRun) {
      await deps.saveLocal(config.outDir, filename, buffer);
    } else {
      const content = config.messages?.[job.type] ?? '';
      await deps.postGraphic(config.webhookUrl, { filename, imageBuffer: buffer, content });
    }
    posted.push(job);
  }

  if (!dryRun) await deps.writeSnapshot(config.snapshotPath, current);
  return { firstRun: false, posted };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry-run');
  run({ dryRun })
    .then((r) => { console.log('Done:', JSON.stringify(r)); })
    .catch((e) => { console.error('Run failed:', e.message); process.exit(1); });
}
```

- [ ] **Step 4: Run test om te verifiëren dat hij slaagt**

Run: `node --test test/index.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run de volledige suite**

Run: `node --test`
Expected: alle tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.js test/index.test.js
git commit -m "feat: add run orchestration with dry-run and fail-safe snapshot"
```

---

## Task 12: Dry-run visuele tuning van tekstcoördinaten

> Geen automatische test — handmatige visuele controle om de balk-coördinaten in `config.json` te fijntunen tegen de echte 5504×3072-assets.

**Files:**
- Modify: `config.json` (alleen de `render`-coördinaten)

- [ ] **Step 1: Forceer een testbare diff**

Maak een tijdelijke `data/last-snapshot.json` met twee bekende spelers in tegenovergestelde tiers, zodat de dry-run één promotie en één degradatie rendert:

```json
{
  "takenAt": "2026-01-01T00:00:00.000Z",
  "players": {
    "#TESTPROMO": { "name": "PromoTest", "tier": "II" },
    "#TESTDEMO": { "name": "DemoTest", "tier": "I" }
  }
}
```

Zorg dat `config.json` óók twee echte clan tags bevat met leden die nu in Legend I en II zitten (of pas de testnamen aan zodat ze matchen met echte spelers in je snapshot). Voor pure layout-controle kun je ook tijdelijk vaste namen renderen via een korte node-snippet:

```bash
node --env-file=.env -e "import('./src/render.js').then(async ({renderUsername})=>{const {loadConfig}=await import('./src/config.js');const c=loadConfig();const {writeFileSync,mkdirSync}=await import('node:fs');mkdirSync('out',{recursive:true});writeFileSync('out/promoted.png', await renderUsername('promoted','VoorbeeldNaam',c.render));writeFileSync('out/demoted.png', await renderUsername('demoted','VoorbeeldNaam',c.render));console.log('out/ geschreven');})"
```

- [ ] **Step 2: Bekijk `out/promoted.png` en `out/demoted.png`**

Controleer: staat de username gecentreerd op de balk (afgeronde balk bij promoted, houten plank bij demoted)? Goede grootte? Leesbare kleur (donker op licht / licht op hout)?

- [ ] **Step 3: Pas `config.json` aan**

Stel `x`, `y`, `maxWidth`, `baseFontSize` en `color` per type bij tot het klopt. Herhaal Step 1–3 tot de tekst goed zit. (Optioneel: leg een bold TTF in `assets/fonts/Anton-Regular.ttf` en houd `fontPath` ingesteld voor een consistente, vette letter die bij de graphics past.)

- [ ] **Step 4: Ruim de tijdelijke snapshot op**

```bash
rm -f data/last-snapshot.json
```

- [ ] **Step 5: Commit**

```bash
git add config.json assets/fonts
git commit -m "chore: tune username overlay coordinates against real assets"
```

---

## Task 13: README + cron-instructies

**Files:**
- Create: `README.md`

- [ ] **Step 1: Schrijf `README.md`**

````markdown
# TW Legend League Promotie/Degradatie-bot

Post elke maandagochtend in Discord wie er tussen Legend League I en II is
gepromoveerd (felicitatie-graphic) of gedegradeerd (poep/clown-graphic).

## Setup

1. `npm install`
2. Maak `.env` op basis van `.env.example`:
   - `COC_API_KEY` — van https://developer.clashofclans.com/ (IP-locked op de
     cron-host; gebruik het publieke IP van die machine bij het aanmaken).
   - `DISCORD_WEBHOOK_URL` — webhook van het doelkanaal.
3. Vul in `config.json` de echte `clanTags` in (de TW-clans).
4. Verifieer het tier-veld tegen de live API:
   `npm run probe -- "#JOUWCLANTAG"`
5. Tune de tekstpositie: `npm run dry-run` en bekijk `out/`.

## Draaien

- Eenmalig: `npm start`
- Dry-run (rendert naar `out/`, post niet): `npm run dry-run`

De eerste echte run legt alleen de baseline-snapshot vast en post niets.

## Cron (elke maandagochtend, Europe/Amsterdam)

Open `crontab -e` op de host en voeg toe (voorbeeld 09:00):

```cron
CRON_TZ=Europe/Amsterdam
0 9 * * 1 cd /pad/naar/TW-BOT && /usr/bin/node --env-file=.env src/index.js >> data/run.log 2>&1
```

- `* * 1` = elke maandag. Pas `0 9` aan voor een ander tijdstip.
- Gebruik het absolute pad naar `node` (`which node`).
- De host moet het IP hebben waarop de CoC API-key gewhitelist is.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and cron instructions"
```

---

## Self-Review (uitgevoerd)

**Spec-dekking:**
- Doel (II→I promoted, I→II demoted, 1 post p.p.) → Tasks 8, 9, 11. ✓
- Detectie via CoC API + tier per speler → Tasks 4, 6. ✓
- Wekelijkse snapshot + diff → Tasks 6, 7, 8. ✓
- Foutafhandeling (geen snapshot-write bij fout, eerste run baseline, vertrokken/nieuwe speler genegeerd) → Tasks 8 (diff), 11 (orkestratie, getest). ✓
- Verificatie-eerste-stap (tier-veld) → Task 5. ✓
- Username auto-fit op balk → Task 9. ✓
- Testen (diff, render, index met mocks, dry-run) → Tasks 8, 9, 11. ✓
- Cron + webhook run-model → Tasks 1 (scripts), 13 (cron). ✓
- Setup-waarden (API-key, clan tags, webhook, tijd) → Tasks 2, 13. ✓

**Placeholder-scan:** `REPLACE_WITH_TW_CLAN_TAG` in `config.json` is een bewuste, door de gebruiker in te vullen waarde (gedocumenteerd in Task 5 en 13), geen plan-placeholder. Geen TODO's/TBD's in code-stappen.

**Type-consistentie:** `getTier`→`'I'|'II'|'III'|null`, snapshot `players[tag]={name,tier}`, diff geeft `{tag,name}`, `renderUsername(type,username,renderConfig)`, `postGraphic(url,{filename,imageBuffer,content})`, `run(options,deps)` — consistent over Tasks 4–11.

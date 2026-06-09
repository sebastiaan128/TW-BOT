# Legend 1 — 1-ster "shame" feature — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een aparte Node-cron (elke 15 min) die per Legend-1 TW-speler de battlelog ophaalt, nieuwe 1-ster ranked aanvallen detecteert, en voor elk een shame-graphic (username + % verwoesting) in het ducks-kanaal post met een `:LaugingPepe:` reactie.

**Architecture:** Apart entrypoint `src/onestar.js` met eigen state-bestand en CLI, los van de wekelijkse promotie-bot. Hergebruikt bestaande bouwstenen (`fetchClanMembers`, `getTier`, Discord-post/reactie) en breidt `coc.js`, `render.js`, `discord.js`, `config.js` uit. Dedup gebeurt per speler op een signatuur (`tegenstander|%`) omdat de battlelog geen tijdstempel heeft.

**Tech Stack:** Node ≥20.6 (ESM, `node --test`), `@napi-rs/canvas`, native fetch/FormData. CoC API `players/{tag}/battlelog`; Discord bot-API voor post + custom-emoji reactie.

---

## Bestandsstructuur

```
src/
  coc.js        (uitbreiden)  + fetchBattleLog, oneStarAttacks, legendOnePlayers
  discord.js    (uitbreiden)  + fetchEmojiId
  render.js     (refactor)    extract registerFonts/finishCanvas helpers; + renderFields
  config.js     (uitbreiden)  oneStar passthrough
  onestar.js    (nieuw)       run() orkestratie + CLI (--dry-run, --mark-seen)
config.json     (uitbreiden)  oneStar sectie + render.onestar
package.json    (uitbreiden)  onestar + onestar:mark-seen scripts
README.md       (uitbreiden)  1-ster sectie + cron
test/
  coc.test.js          (uitbreiden)  battlelog/oneStarAttacks/legendOnePlayers
  discord.test.js      (uitbreiden)  fetchEmojiId
  render.test.js       (uitbreiden)  renderFields (+ renderUsername blijft groen)
  config.test.js       (uitbreiden)  oneStar passthrough
  onestar.test.js      (nieuw)       run() orkestratie
data/onestar-seen.json (runtime, gitignored)
```

**Interfaces (consistent over alle taken):**
- `fetchBattleLog(playerTag, apiKey, { fetchImpl })` → `Array<battle>`
- `oneStarAttacks(items)` → `Array<{ opponentPlayerTag, destructionPercentage }>`
- `legendOnePlayers(clanTags, apiKey, { fetchImpl })` → `Array<{ tag, name }>`
- `fetchEmojiId(guildId, name, botToken, { fetchImpl })` → `string | null`
- `renderFields(type, values, renderConfig)` → `Buffer` (PNG)
- `run(options, deps)` → `{ posted }` of `{ marked: true, posted: [] }`

---

## Task 1: coc.js — battlelog, 1-ster filter, Legend-1 spelers

**Files:**
- Modify: `src/coc.js`
- Test: `test/coc.test.js`

- [ ] **Step 1: Schrijf de falende tests (toevoegen onderaan `test/coc.test.js`)**

```javascript
// test/coc.test.js — toevoegen onderaan
import { fetchBattleLog, oneStarAttacks, legendOnePlayers } from '../src/coc.js';

test('oneStarAttacks keeps only ranked attacks with exactly 1 star', () => {
  const items = [
    { battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O1', destructionPercentage: 79 },
    { battleType: 'ranked', attack: true, stars: 2, opponentPlayerTag: '#O2', destructionPercentage: 91 },
    { battleType: 'ranked', attack: false, stars: 1, opponentPlayerTag: '#O3', destructionPercentage: 100 }, // defense
    { battleType: 'homeVillage', attack: true, stars: 1, opponentPlayerTag: '#O4', destructionPercentage: 50 }, // farm
  ];
  assert.deepEqual(oneStarAttacks(items), [
    { opponentPlayerTag: '#O1', destructionPercentage: 79 },
  ]);
  assert.deepEqual(oneStarAttacks(null), []);
});

test('fetchBattleLog hits the battlelog endpoint and returns items', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return { ok: true, status: 200, json: async () => ({ items: [{ stars: 1 }] }) }; };
  const items = await fetchBattleLog('#P1', 'key', { fetchImpl });
  assert.match(seenUrl, /\/players\/%23P1\/battlelog$/);
  assert.deepEqual(items, [{ stars: 1 }]);
});

test('fetchBattleLog throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(() => fetchBattleLog('#P1', 'key', { fetchImpl }), /404/);
});

test('legendOnePlayers returns only tier-I members across clans', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('%23C1/members')) return { ok: true, status: 200, json: async () => ({ items: [
      { tag: '#A', name: 'Alice', leagueTier: { id: 105000036 } }, // L1
      { tag: '#B', name: 'Bob', leagueTier: { id: 105000035 } },   // L2 -> excluded
    ] }) };
    if (url.includes('%23C2/members')) return { ok: true, status: 200, json: async () => ({ items: [
      { tag: '#C', name: 'Carol', leagueTier: { id: 105000036 } }, // L1
      { tag: '#D', name: 'Dave', league: { id: 29000000 } },       // unranked -> excluded
    ] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const players = await legendOnePlayers(['#C1', '#C2'], 'key', { fetchImpl });
  assert.deepEqual(players, [{ tag: '#A', name: 'Alice' }, { tag: '#C', name: 'Carol' }]);
});
```

- [ ] **Step 2: Run de tests om te verifiëren dat ze falen**

Run: `node --test test/coc.test.js`
Expected: FAIL — `fetchBattleLog`/`oneStarAttacks`/`legendOnePlayers` is not exported.

- [ ] **Step 3: Voeg de implementatie toe aan `src/coc.js` (onderaan, onder de bestaande exports)**

```javascript
// Per-player battle log (recent ~50 battles). No timestamp/id per battle.
export async function fetchBattleLog(playerTag, apiKey, { fetchImpl = fetch } = {}) {
  const encoded = encodeURIComponent(playerTag);
  const res = await fetchImpl(`${API_BASE}/players/${encoded}/battlelog`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CoC API ${res.status} for battlelog ${playerTag}`);
  const data = await res.json();
  return data.items ?? [];
}

// 1-star Legend attacks = ranked battle, this player attacking, exactly 1 star.
export function oneStarAttacks(items) {
  return (items ?? [])
    .filter((b) => b.battleType === 'ranked' && b.attack === true && b.stars === 1)
    .map((b) => ({ opponentPlayerTag: b.opponentPlayerTag, destructionPercentage: b.destructionPercentage }));
}

// Members currently in Legend 1 (tier I) across the given clans.
export async function legendOnePlayers(clanTags, apiKey, { fetchImpl = fetch } = {}) {
  const players = [];
  for (const tag of clanTags) {
    const members = await withRetry(() => fetchClanMembers(tag, apiKey, { fetchImpl }));
    for (const m of members) {
      if (getTier(m) === 'I') players.push({ tag: m.tag, name: m.name });
    }
  }
  return players;
}
```

- [ ] **Step 4: Run de tests om te verifiëren dat ze slagen**

Run: `node --test test/coc.test.js`
Expected: PASS (alle coc-tests).

- [ ] **Step 5: Commit**

```bash
git add src/coc.js test/coc.test.js
git commit -m "feat: add battlelog fetch, 1-star filter, and Legend-1 player list"
```

---

## Task 2: discord.js — fetchEmojiId

**Files:**
- Modify: `src/discord.js`
- Test: `test/discord.test.js`

- [ ] **Step 1: Schrijf de falende test (toevoegen onderaan `test/discord.test.js`)**

```javascript
// test/discord.test.js — toevoegen onderaan
import { fetchEmojiId } from '../src/discord.js';

test('fetchEmojiId returns the id of a custom emoji matched by name (case-insensitive)', async () => {
  let seen = {};
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ([
      { name: 'wave', id: '111' },
      { name: 'LaugingPepe', id: '222' },
    ]) };
  };
  const id = await fetchEmojiId('GUILD', 'laugingpepe', 'tok', { fetchImpl });
  assert.equal(seen.url, 'https://discord.com/api/v10/guilds/GUILD/emojis');
  assert.equal(seen.opts.headers.Authorization, 'Bot tok');
  assert.equal(id, '222');
});

test('fetchEmojiId returns null when no emoji matches', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ([{ name: 'wave', id: '111' }]) });
  assert.equal(await fetchEmojiId('GUILD', 'LaugingPepe', 'tok', { fetchImpl }), null);
});

test('fetchEmojiId throws on non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(() => fetchEmojiId('GUILD', 'x', 'tok', { fetchImpl }), /403/);
});
```

- [ ] **Step 2: Run de test om te verifiëren dat hij faalt**

Run: `node --test test/discord.test.js`
Expected: FAIL — `fetchEmojiId` is not exported.

- [ ] **Step 3: Voeg de implementatie toe aan `src/discord.js` (onderaan)**

```javascript
// Resolves a guild custom-emoji id by name (case-insensitive). Returns null if
// not found. Used to react with a custom emoji, which the API expects as
// "name:id". Survives re-uploads of the emoji (id looked up fresh each run).
export async function fetchEmojiId(guildId, name, botToken, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${DISCORD_API}/guilds/${guildId}/emojis`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord emojis fetch failed: ${res.status} ${body}`);
  }
  const emojis = await res.json();
  const hit = emojis.find((e) => e.name?.toLowerCase() === name.toLowerCase());
  return hit?.id ?? null;
}
```

- [ ] **Step 4: Run de test om te verifiëren dat hij slaagt**

Run: `node --test test/discord.test.js`
Expected: PASS (alle discord-tests).

- [ ] **Step 5: Commit**

```bash
git add src/discord.js test/discord.test.js
git commit -m "feat: add fetchEmojiId to resolve a custom emoji by name"
```

---

## Task 3: render.js — extract helpers + renderFields

> Refactor: trek font-registratie en downscale uit `renderUsername` in gedeelde helpers, en voeg `renderFields` toe voor meerdere tekstvelden. `renderUsername` houdt exact hetzelfde gedrag (bestaande render-tests moeten groen blijven).

**Files:**
- Modify: `src/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Schrijf de falende test (toevoegen onderaan `test/render.test.js`)**

```javascript
// test/render.test.js — toevoegen onderaan
import { renderFields } from '../src/render.js';

const fieldsCfg = {
  onestar: {
    assetPath: ASSET, // hergebruikt de fixture-PNG uit setup()
    fields: [
      { key: 'name', x: 200, y: 80, maxWidth: 380, color: '#ffffff', baseFontSize: 40 },
      { key: 'destruction', x: 200, y: 140, maxWidth: 380, color: '#ffd700', baseFontSize: 30 },
    ],
    fontFamily: 'sans-serif', fontWeight: 'bold',
  },
};

test('renderFields draws multiple fields and returns a PNG buffer', async () => {
  setup();
  const buf = await renderFields('onestar', { name: 'TW Mootje', destruction: '79%' }, fieldsCfg);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.subarray(0, 4).equals(PNG_SIG));
  rmSync(DIR, { recursive: true, force: true });
});

test('renderFields auto-fits a long value without throwing', async () => {
  setup();
  const buf = await renderFields('onestar', { name: 'EenHeelErgLangeGebruikersnaamXYZ', destruction: '100%' }, fieldsCfg);
  assert.ok(buf.subarray(0, 4).equals(PNG_SIG));
  rmSync(DIR, { recursive: true, force: true });
});

test('renderFields throws on unknown type', async () => {
  setup();
  await assert.rejects(() => renderFields('bogus', {}, fieldsCfg), /Unknown render type/);
  rmSync(DIR, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run de test om te verifiëren dat hij faalt**

Run: `node --test test/render.test.js`
Expected: FAIL — `renderFields` is not exported.

- [ ] **Step 3: Herschrijf `src/render.js` (helpers extraheren, `renderUsername` ongewijzigd gedrag, `renderFields` toevoegen)**

```javascript
// src/render.js
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';

// Register one or more fonts so Skia can fall back per-glyph. Supports a
// `fonts` list of { path, family } or a single { fontPath, fontFamily }.
function registerFonts(cfg) {
  if (Array.isArray(cfg.fonts)) {
    for (const f of cfg.fonts) {
      if (f.path && existsSync(f.path)) GlobalFonts.registerFromPath(f.path, f.family);
    }
  } else if (cfg.fontPath && existsSync(cfg.fontPath)) {
    GlobalFonts.registerFromPath(cfg.fontPath, cfg.fontFamily);
  }
}

// Draw `text` centered at (x,y), shrinking the font until it fits maxWidth.
function drawAutoFit(ctx, text, { x, y, maxWidth, color, baseFontSize }, fontFamily, fontWeight) {
  ctx.fillStyle = color;
  let size = baseFontSize;
  const setFont = (s) => { ctx.font = `${fontWeight ?? 'bold'} ${s}px ${fontFamily}`; };
  setFont(size);
  while (ctx.measureText(text).width > maxWidth && size > 10) { size -= 2; setFont(size); }
  ctx.fillText(text, x, y);
}

// Full-res assets (~5504px) exceed the Discord upload limit. Render at full res
// for crisp text, then scale the composed image down to outputWidth (def 1600).
function finishCanvas(canvas, img, cfg) {
  const outputWidth = cfg.outputWidth ?? 1600;
  if (img.width > outputWidth) {
    const scale = outputWidth / img.width;
    const out = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    return out.toBuffer('image/png');
  }
  return canvas.toBuffer('image/png');
}

export async function renderUsername(type, username, renderConfig) {
  const cfg = renderConfig[type];
  if (!cfg) throw new Error(`Unknown render type: ${type}`);
  registerFonts(cfg);

  const img = await loadImage(cfg.assetPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  drawAutoFit(ctx, username, {
    x: cfg.x, y: cfg.y, maxWidth: cfg.maxWidth, color: cfg.color, baseFontSize: cfg.baseFontSize,
  }, cfg.fontFamily, cfg.fontWeight);

  return finishCanvas(canvas, img, cfg);
}

// Draws multiple labelled fields onto an asset. `values` maps field.key ->
// string; `cfg.fields` is a list of { key, x, y, maxWidth, color, baseFontSize }.
export async function renderFields(type, values, renderConfig) {
  const cfg = renderConfig[type];
  if (!cfg) throw new Error(`Unknown render type: ${type}`);
  registerFonts(cfg);

  const img = await loadImage(cfg.assetPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const field of cfg.fields ?? []) {
    const text = String(values[field.key] ?? '');
    drawAutoFit(ctx, text, field, cfg.fontFamily, cfg.fontWeight);
  }

  return finishCanvas(canvas, img, cfg);
}
```

- [ ] **Step 4: Run de volledige render-suite (renderUsername mag NIET regresseren)**

Run: `node --test test/render.test.js`
Expected: PASS — alle bestaande renderUsername-tests én de nieuwe renderFields-tests.

- [ ] **Step 5: Commit**

```bash
git add src/render.js test/render.test.js
git commit -m "refactor: extract render helpers; add renderFields for multi-field graphics"
```

---

## Task 4: config — oneStar passthrough + config.json

**Files:**
- Modify: `src/config.js`
- Modify: `config.json`
- Test: `test/config.test.js`

- [ ] **Step 1: Schrijf de falende test (toevoegen onderaan `test/config.test.js`)**

```javascript
// test/config.test.js — toevoegen onderaan
test('loadConfig passes through the oneStar section (default {})', () => {
  process.env.COC_API_KEY = 'key123';
  process.env.DISCORD_BOT_TOKEN = 'bot123';
  withTmpConfig({ clanTags: [], channelId: '42', oneStar: { channelId: '99', guildId: 'g', emojiName: 'LaugingPepe' } }, () => {
    assert.deepEqual(loadConfig(TMP).oneStar, { channelId: '99', guildId: 'g', emojiName: 'LaugingPepe' });
  });
  withTmpConfig({ clanTags: [], channelId: '42' }, () => {
    assert.deepEqual(loadConfig(TMP).oneStar, {});
  });
});
```

- [ ] **Step 2: Run de test om te verifiëren dat hij faalt**

Run: `node --test test/config.test.js`
Expected: FAIL — `oneStar` is undefined (niet `{}`).

- [ ] **Step 3: Voeg `oneStar` toe aan de return van `loadConfig` in `src/config.js`**

Wijzig het return-object zodat het deze regel bevat (vlak na `reactions`):

```javascript
    reactions: file.reactions ?? {},
    oneStar: file.oneStar ?? {},
```

- [ ] **Step 4: Voeg de `oneStar`-sectie en `render.onestar` toe aan `config.json`**

Voeg `oneStar` toe op top-niveau (naast `channelId`):

```json
  "oneStar": {
    "channelId": "1487801970474487962",
    "guildId": "1487801969371250798",
    "emojiName": "LaugingPepe",
    "statePath": "data/onestar-seen.json"
  },
```

En voeg binnen `"render"` een `"onestar"`-blok toe (coördinaten zijn beginschattingen, getuned wanneer de asset er is):

```json
    "onestar": {
      "assetPath": "assets/OneStar.png",
      "outputWidth": 1600,
      "fontWeight": "bold",
      "fontFamily": "Noto Sans, Noto Sans Symbols 2, sans-serif",
      "fonts": [
        { "path": "assets/fonts/NotoSans-Bold.ttf", "family": "Noto Sans" },
        { "path": "assets/fonts/NotoSansSymbols2-Regular.ttf", "family": "Noto Sans Symbols 2" }
      ],
      "fields": [
        { "key": "name", "x": 2750, "y": 2000, "maxWidth": 2400, "color": "#ffffff", "baseFontSize": 240 },
        { "key": "destruction", "x": 2750, "y": 2420, "maxWidth": 2400, "color": "#ffd700", "baseFontSize": 200 }
      ]
    }
```

- [ ] **Step 5: Run de test om te verifiëren dat hij slaagt**

Run: `node --test test/config.test.js`
Expected: PASS (alle config-tests).

- [ ] **Step 6: Commit**

```bash
git add src/config.js config.json test/config.test.js
git commit -m "feat: add oneStar config section and render.onestar"
```

---

## Task 5: onestar.js — orkestratie + CLI

**Files:**
- Create: `src/onestar.js`
- Test: `test/onestar.test.js`

- [ ] **Step 1: Schrijf de falende test**

```javascript
// test/onestar.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/onestar.js';

function makeDeps(overrides = {}) {
  const calls = { posts: [], reactions: [], writes: [], renders: [], saved: 0 };
  const battlelogs = {
    '#A': [
      { battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O1', destructionPercentage: 79 },
      { battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O2', destructionPercentage: 88 },
      { battleType: 'ranked', attack: true, stars: 3, opponentPlayerTag: '#O3', destructionPercentage: 100 },
    ],
    '#B': [
      { battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O9', destructionPercentage: 50 },
    ],
  };
  const deps = {
    loadConfig: () => ({
      cocApiKey: 'k', botToken: 'tok', clanTags: ['#C'],
      render: { onestar: {} }, outDir: 'out',
      oneStar: { channelId: '99', guildId: 'g', emojiName: 'LaugingPepe', statePath: 'data/os.json' },
    }),
    legendOnePlayers: async () => ([{ tag: '#A', name: 'Alice' }, { tag: '#B', name: 'Bob' }]),
    fetchBattleLog: async (tag) => battlelogs[tag] ?? [],
    readSnapshot: async () => ({ '#A': ['#O1|79'] }), // #A's #O1|79 already seen
    writeSnapshot: async (_p, s) => { calls.writes.push(s); },
    fetchEmojiId: async () => '222',
    renderFields: async (_type, values) => { calls.renders.push(values); return Buffer.from([1]); },
    postGraphic: async (_chan, { filename }) => { calls.posts.push(filename); return { id: 'm', channel_id: 'c' }; },
    addReaction: async (_chan, _msg, emoji) => { calls.reactions.push(emoji); },
    saveLocal: async () => { calls.saved++; },
    ...overrides,
  };
  return { deps, calls };
}

test('posts only new 1-star attacks, reacts with custom emoji, updates state', async () => {
  const { deps, calls } = makeDeps();
  const r = await run({}, deps);
  // #A: #O1|79 already seen -> only #O2|88 posted. #B: #O9|50 new -> posted.
  assert.deepEqual(calls.renders, [
    { name: 'Alice', destruction: '88%' },
    { name: 'Bob', destruction: '50%' },
  ]);
  assert.equal(calls.posts.length, 2);
  assert.deepEqual(calls.reactions, ['LaugingPepe:222', 'LaugingPepe:222']);
  // state now holds each player's current 1-star signatures
  const saved = calls.writes.at(-1);
  assert.deepEqual(saved['#A'].sort(), ['#O1|79', '#O2|88']);
  assert.deepEqual(saved['#B'], ['#O9|50']);
  assert.equal(r.posted.length, 2);
});

test('mark-seen records signatures without posting', async () => {
  const { deps, calls } = makeDeps();
  const r = await run({ markSeen: true }, deps);
  assert.equal(r.marked, true);
  assert.equal(calls.posts.length, 0);
  const saved = calls.writes.at(-1);
  assert.deepEqual(saved['#A'].sort(), ['#O1|79', '#O2|88']);
  assert.deepEqual(saved['#B'], ['#O9|50']);
});

test('a player whose battlelog fetch fails is skipped without touching their state', async () => {
  const { deps, calls } = makeDeps({
    fetchBattleLog: async (tag) => { if (tag === '#A') throw new Error('boom'); return [{ battleType: 'ranked', attack: true, stars: 1, opponentPlayerTag: '#O9', destructionPercentage: 50 }]; },
    readSnapshot: async () => ({ '#A': ['#O1|79'] }),
  });
  const r = await run({}, deps);
  assert.equal(calls.posts.length, 1); // only #B
  const saved = calls.writes.at(-1);
  assert.deepEqual(saved['#A'], ['#O1|79']); // #A's old state preserved untouched
  assert.deepEqual(saved['#B'], ['#O9|50']);
  assert.equal(r.posted.length, 1);
});

test('a player keeps only successfully-posted sigs when a post fails (no double-post next run)', async () => {
  let n = 0;
  const { deps, calls } = makeDeps({
    legendOnePlayers: async () => ([{ tag: '#A', name: 'Alice' }]),
    readSnapshot: async () => ({}),
    postGraphic: async (_chan, { filename }) => { n++; if (n === 2) throw new Error('discord down'); calls.posts.push(filename); return { id: 'm', channel_id: 'c' }; },
  });
  const r = await run({}, deps);
  // #A has two new attacks (#O1|79, #O2|88); first posts, second fails.
  assert.equal(calls.posts.length, 1);
  const saved = calls.writes.at(-1);
  assert.deepEqual(saved['#A'], ['#O1|79']); // only the posted one is remembered
});

test('reaction is skipped when the emoji is not found', async () => {
  const { deps, calls } = makeDeps({ fetchEmojiId: async () => null });
  await run({}, deps);
  assert.equal(calls.posts.length, 2);
  assert.equal(calls.reactions.length, 0);
});

test('dry-run renders locally and does not post or write state', async () => {
  const { deps, calls } = makeDeps();
  await run({ dryRun: true }, deps);
  assert.equal(calls.saved, 2);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.writes.length, 0);
});
```

- [ ] **Step 2: Run de test om te verifiëren dat hij faalt**

Run: `node --test test/onestar.test.js`
Expected: FAIL — `Cannot find module '../src/onestar.js'`.

- [ ] **Step 3: Schrijf `src/onestar.js`**

```javascript
// src/onestar.js
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { legendOnePlayers, fetchBattleLog, oneStarAttacks } from './coc.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import { renderFields } from './render.js';
import { postGraphic, addReaction, fetchEmojiId } from './discord.js';

async function saveLocal(dir, filename, buffer) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buffer);
}

const sig = (a) => `${a.opponentPlayerTag}|${a.destructionPercentage}`;

const defaultDeps = {
  loadConfig, legendOnePlayers, fetchBattleLog, readSnapshot, writeSnapshot,
  renderFields, postGraphic, addReaction, fetchEmojiId, saveLocal,
};

export async function run(options = {}, deps = defaultDeps) {
  const { dryRun = false, markSeen = false } = options;
  const d = { ...defaultDeps, ...deps };

  const config = d.loadConfig();
  const os = config.oneStar;
  const players = await d.legendOnePlayers(config.clanTags, config.cocApiKey);
  const state = (await d.readSnapshot(os.statePath)) ?? {};
  const newState = { ...state };

  // Resolve the custom emoji once per run (best-effort).
  let emojiTag = null;
  if (!dryRun && !markSeen) {
    try {
      const id = await d.fetchEmojiId(os.guildId, os.emojiName, config.botToken);
      if (id) emojiTag = `${os.emojiName}:${id}`;
    } catch (e) {
      console.warn(`Emoji lookup failed: ${e.message}`);
    }
  }

  const posted = [];
  for (const p of players) {
    let items;
    try {
      items = await d.fetchBattleLog(p.tag, config.cocApiKey);
    } catch (e) {
      console.warn(`Battlelog failed for ${p.tag}: ${e.message}`); // leave state untouched
      continue;
    }
    const attacks = oneStarAttacks(items);
    const currentSigs = attacks.map(sig);

    if (markSeen) { newState[p.tag] = currentSigs; continue; }

    const seen = new Set(state[p.tag] ?? []);
    // Keep already-seen sigs that are still in the log; add newly-posted ones.
    const remembered = new Set(currentSigs.filter((s) => seen.has(s)));
    for (const a of attacks) {
      if (seen.has(sig(a))) continue; // already posted
      const buffer = await d.renderFields('onestar', { name: p.name, destruction: `${a.destructionPercentage}%` }, config.render);
      const filename = `onestar-${p.tag.replace('#', '')}-${a.opponentPlayerTag.replace('#', '')}.png`;
      try {
        if (dryRun) {
          await d.saveLocal(config.outDir, filename, buffer);
        } else {
          const msg = await d.postGraphic(os.channelId, { filename, imageBuffer: buffer, content: '' }, config.botToken);
          if (emojiTag && msg?.id && msg?.channel_id) {
            try { await d.addReaction(msg.channel_id, msg.id, emojiTag, config.botToken); }
            catch (e) { console.warn(`Reaction failed for ${p.tag}: ${e.message}`); }
          }
        }
        remembered.add(sig(a));
        posted.push({ tag: p.tag, name: p.name, opponent: a.opponentPlayerTag, destruction: a.destructionPercentage });
      } catch (e) {
        console.warn(`Post failed for ${p.tag} vs ${a.opponentPlayerTag}: ${e.message}`);
        break; // stop this player; keep only what was posted so far
      }
    }
    if (!dryRun) newState[p.tag] = [...remembered];
  }

  if (markSeen) {
    await d.writeSnapshot(os.statePath, newState);
    return { marked: true, posted: [] };
  }
  if (!dryRun) await d.writeSnapshot(os.statePath, newState);
  return { posted };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = {
    dryRun: process.argv.includes('--dry-run'),
    markSeen: process.argv.includes('--mark-seen'),
  };
  run(options)
    .then((r) => { console.log('Done:', JSON.stringify(r)); })
    .catch((e) => { console.error('Run failed:', e.message); process.exit(1); });
}
```

- [ ] **Step 4: Run de test om te verifiëren dat hij slaagt**

Run: `node --test test/onestar.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run de volledige suite**

Run: `node --test`
Expected: alle tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/onestar.js test/onestar.test.js
git commit -m "feat: add one-star shame orchestration with per-player dedup state"
```

---

## Task 6: package.json scripts + README + cron

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Voeg scripts toe aan `package.json` (in `"scripts"`, na `"mark-seen"`)**

```json
    "onestar": "node --env-file=.env src/onestar.js",
    "onestar:dry-run": "node --env-file=.env src/onestar.js --dry-run",
    "onestar:mark-seen": "node --env-file=.env src/onestar.js --mark-seen",
```

- [ ] **Step 2: Voeg een sectie toe aan `README.md` (onder de bestaande inhoud)**

````markdown
## Feature 2: Legend 1 — 1-ster "shame"

Post elke ~15 minuten in het ducks-kanaal een graphic voor elke *nieuwe* 1-ster
ranked aanval van een Legend-1 speler, met een `:LaugingPepe:` reactie eronder.

- Databron: CoC `players/{tag}/battlelog` (per-aanval sterren; geen tijdstempel).
- Detectie: ranked attack met `stars === 1` van spelers in Legend 1 (tier I).
- Dedup: per speler een set signaturen (`tegenstander|%`) in
  `data/onestar-seen.json`; elke aanval wordt één keer gepost.
- Vereist in `config.json` de `oneStar`-sectie (channelId, guildId, emojiName)
  en `render.onestar` (asset + tekstvelden). De `:LaugingPepe:` emoji moet in de
  server (guild) staan zodat de bot ermee kan reageren.

Commando's:

- `npm run onestar` — detecteert en post nieuwe 1-ster aanvallen.
- `npm run onestar:dry-run` — rendert naar `out/`, post niet, raakt state niet aan.
- `npm run onestar:mark-seen` — markeert de huidige battlelog als gezien zonder te
  posten (eenmalig bij deploy, voorkomt een flood van bestaande aanvallen).

Cron (elke 15 minuten):

```cron
*/15 * * * * cd /pad/naar/TW-BOT && mkdir -p data && /usr/bin/node --env-file=.env src/onestar.js >> data/onestar.log 2>&1
```
````

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "docs: add one-star scripts, README section, and 15-min cron"
```

---

## Task 7: Asset + visuele tuning (uitgesteld tot de graphic er is)

> Geen automatische test — handmatige stap, uit te voeren zodra de gebruiker de
> 1-ster graphic en de `:LaugingPepe:` emoji aanlevert.

**Files:**
- Add: `assets/OneStar.png` (door gebruiker aangeleverd)
- Modify: `config.json` (alleen `render.onestar`-coördinaten)

- [ ] **Step 1: Leg de aangeleverde asset neer als `assets/OneStar.png`.**

- [ ] **Step 2: Render een voorbeeld en bekijk het**

```bash
node --env-file=.env -e "import('./src/render.js').then(async ({renderFields})=>{const {loadConfig}=await import('./src/config.js');const c=loadConfig();const {writeFileSync,mkdirSync}=await import('node:fs');mkdirSync('out',{recursive:true});writeFileSync('out/onestar.png', await renderFields('onestar',{name:'TW Mootje',destruction:'79%'},c.render));console.log('out/onestar.png geschreven');})"
```

- [ ] **Step 3: Bekijk `out/onestar.png` en stel de `fields`-coördinaten (`x`, `y`, `maxWidth`, `color`, `baseFontSize`) in `config.json` bij tot naam en % goed op de graphic staan. Herhaal Step 2–3 tot het klopt.**

- [ ] **Step 4: Bevestig dat de `:LaugingPepe:` emoji in de guild staat**

```bash
node --env-file=.env -e "import('./src/discord.js').then(async ({fetchEmojiId})=>{console.log('emoji id:', await fetchEmojiId('1487801969371250798','LaugingPepe',process.env.DISCORD_BOT_TOKEN))})"
```
Verwacht: een numerieke id (niet `null`). Is het `null`, dan moet de emoji nog in de server geüpload worden.

- [ ] **Step 5: Live dry-run en daarna mark-seen op de deploy-host**

```bash
npm run onestar:dry-run    # controleer out/ visueel
npm run onestar:mark-seen  # sla huidige battlelog over (geen flood)
```

- [ ] **Step 6: Commit**

```bash
git add assets/OneStar.png config.json
git commit -m "chore: add one-star asset and tune field coordinates"
```

---

## Self-Review (uitgevoerd)

**Spec-dekking:**
- Bron `battlelog`, ranked+attack+stars===1 → Task 1 (`oneStarAttacks`, `fetchBattleLog`). ✓
- Alleen Legend 1 (tier I) → Task 1 (`legendOnePlayers`). ✓
- 1 post per 1-ster aanval, username + % → Task 5 (loop per attack), Task 3/4 (`renderFields` + `render.onestar` velden name/destruction). ✓
- Custom emoji `:LaugingPepe:` reactie, id op naam → Task 2 (`fetchEmojiId`), Task 5 (`addReaction` met `name:id`). ✓
- Post naar ducks-kanaal `1487801970474487962` → Task 4 (`oneStar.channelId`), Task 5. ✓
- Dedup-signatuur `tegenstander|%`, pruning, `--mark-seen` → Task 5 (`sig`, `remembered`, markSeen). ✓
- Per-speler geïsoleerde foutafhandeling; partial-post veiligheid → Task 5 (try/continue/break + remembered). ✓
- 15-min cron → Task 6. ✓
- Tests (filter, dedup, render multi-veld, run-orkestratie, emoji) → Tasks 1,2,3,5. ✓

**Placeholder-scan:** `assets/OneStar.png` en de `render.onestar`-coördinaten zijn bewust uitgestelde, door de gebruiker aan te leveren artefacten (Task 7), geen plan-placeholders. Geen TODO/TBD in code-stappen.

**Type-consistentie:** `oneStarAttacks`→`[{opponentPlayerTag,destructionPercentage}]`; `sig(a)`=`opponentPlayerTag|destructionPercentage`; `legendOnePlayers`→`[{tag,name}]`; `renderFields(type, values, renderConfig)` met `values.name`/`values.destruction` matchend op `render.onestar.fields[].key`; `fetchEmojiId(...)→id|null` en `addReaction(...,`${emojiName}:${id}`)`; `run(options, deps)` met `defaultDeps` keys gelijk aan de gemockte deps in de test. Consistent.

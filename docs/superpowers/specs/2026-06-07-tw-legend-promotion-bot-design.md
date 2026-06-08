# TW Legend League Promotie/Degradatie-bot — Design

**Datum:** 2026-06-07
**Status:** Goedgekeurd, klaar voor implementatieplan

## Doel

Elke maandagochtend automatisch in Discord een graphic posten wanneer een Team
Winter-lid in-game promoveert of degradeert tussen Legend League-tiers, zodat de
community kan feliciteren (promotie) of plagen (degradatie).

- **Legend II → Legend I** → `Promoted.png` met de username erop (felicitatie).
- **Legend I → Legend II** → `Demoted.png` met de username erop (poep/clown-emoji's
  staan al op de graphic).
- Eén post per persoon.

Andere tier-overgangen (III↔II) worden **niet** gepost — alleen de I↔II-grens,
zoals de tekst op de bestaande graphics ("LEGEND 2 → LEGEND 1") aangeeft.

## Context

- Sinds de Ranked-update (april 2026) bestaat Legend League uit drie tiers:
  Legend I, II en III, met wekelijkse promotie/degradatie. Dit geeft de
  maandag-cadans.
- L1/L2 zijn **in-game globale tiers**, geen aparte clans. De bot bepaalt per
  TW-lid de huidige tier en vergelijkt week-over-week.
- De graphics zijn al af (5504×3072, identieke layout). Alleen de username wordt
  per keer op de balk overlay'd:
  - Promoted: lichte, afgeronde balk onderaan → donkere tekst.
  - Demoted: houten plank → lichte/contrasterende tekst.
- teamwinter.xyz toont de clans client-side (JavaScript); de clan tags worden
  daarom handmatig geconfigureerd, niet gescrapet.

## Stack & run-model

- **Node.js.**
- **Cron + Discord webhook.** Geen 24/7 proces. Een systeem-cron op de host roept
  `node index.js` elke maandagochtend aan; posten gebeurt via een webhook-URL.
- Detectie via de **officiële Clash of Clans API** (api.clashofclans.com).

## Architectuur

Kleine, losse modules met één duidelijke verantwoordelijkheid:

| Module | Verantwoordelijkheid |
|---|---|
| `config` (`.env` + `config.json`) | CoC API-key, lijst clan tags, webhook-URL, tekststijl/coördinaten |
| `coc.js` | CoC API: clanleden ophalen per clan tag; tier per speler bepalen. Eén functie `getTier(member)` is de enige plek die het tier-veld interpreteert |
| `snapshot.js` | Vorige week lezen/opslaan (`data/last-snapshot.json`) |
| `diff.js` | Pure functie: oude vs nieuwe snapshot → `{ promotions: [...], demotions: [...] }` |
| `render.js` | Username op de juiste balk tekenen (`@napi-rs/canvas`), auto-fit lettergrootte, PNG-buffer terug |
| `discord.js` | Multipart POST naar de webhook met image-attachment (+ optioneel bericht) |
| `index.js` | Orkestreert de hele flow; ondersteunt `--dry-run` |

### Snapshot-formaat (`data/last-snapshot.json`)

```json
{
  "takenAt": "2026-06-01T07:00:00Z",
  "players": {
    "#PLAYERTAG": { "name": "SpelerNaam", "tier": "I" }
  }
}
```

Alleen spelers die op het moment van de snapshot lid zijn van een TW-clan **en**
in Legend League zitten, worden opgenomen. Tier is `"I" | "II" | "III"`.

## Datastroom

```
cron (ma ochtend)
  → index.js
    → coc.js          alle leden van alle TW-clans + tier per speler
    → diff.js         vergelijk met data/last-snapshot.json
       promotions = II→I,  demotions = I→II
    → render.js       per persoon: username op Promoted/Demoted
    → discord.js      post elke graphic via webhook
    → snapshot.js     schrijf nieuwe snapshot
```

## Detectielogica

1. Voor elke geconfigureerde clan tag: haal de ledenlijst op via de CoC API.
   Clan tags worden URL-encoded (`#` → `%23`).
2. Bepaal per lid de Legend-tier via `getTier(member)`. Leden niet in Legend
   League krijgen geen tier en doen niet mee.
3. Bouw de huidige snapshot `{ playerTag: { name, tier } }`.
4. `diff.js` vergelijkt met de vorige snapshot:
   - Speler met vorige tier `II` en huidige tier `I` → **promotie**.
   - Speler met vorige tier `I` en huidige tier `II` → **degradatie**.
   - Alle andere overgangen → genegeerd.
5. Voor elke promotie/degradatie: render + post (eén per persoon).
6. Schrijf de nieuwe snapshot.

## Foutafhandeling

- **Eerste run** (geen vorige snapshot): niets posten, alleen baseline opslaan.
- **API-fout / rate limit:** retry met exponentiële backoff. Als het ophalen van
  één of meer clans uiteindelijk mislukt → **run afbreken zonder de snapshot te
  overschrijven**, zodat de baseline voor volgende week intact blijft en er geen
  overgangen gemist worden.
- **Snapshot wordt pas weggeschreven** nadat het ophalen volledig geslaagd is én
  alle posts succesvol verstuurd zijn. Bij een post-fout: run afbreken zonder
  snapshot-update (volgende run detecteert dezelfde overgang opnieuw).
- **Speler vertrokken** uit alle TW-clans → genegeerd (geen degradatie).
- **Nieuwe speler** zonder vorige tier → genegeerd (geen promotie).
- **Lange/emoji-usernames:** lettergrootte krimpt automatisch tot de naam binnen
  de balkbreedte past.

## Verificatie-eerste-stap (kritisch)

Vóór de rest gebouwd wordt: een klein probe-script dat de ruwe CoC API-respons
van één bekende Legend-speler (en/of een clan-ledenlijst) dumpt, zodat het
**exacte tier-veld** (Legend I/II/III) post-update bevestigd is. `getTier()`
wordt op die bevinding afgestemd. De rest van de code hangt alleen via `getTier()`
af van dit detail, zodat een afwijkend API-formaat lokaal blijft.

## Testen

- **`diff.js`** (unit, pure functie): promotie II→I, degradatie I→II, geen
  wijziging, III↔II genegeerd, nieuwe speler, vertrokken speler, lege vorige
  snapshot.
- **`render.js`**: produceert een geldige PNG; tekst past binnen de balk
  (auto-fit); korte én lange namen.
- **`index.js`**: integratie met gemockte `coc.js` en `discord.js`; verifieert
  dat snapshot niet wordt overschreven bij fouten.
- **`--dry-run`**: rendert de graphics lokaal naar bestand i.p.v. te posten, voor
  handmatige visuele controle en het fijn-tunen van de tekstcoördinaten.

## Configuratiewaarden (door gebruiker te leveren bij implementatie)

1. **CoC API-key** van developer.clashofclans.com (IP-locked op de cron-host).
2. **TW clan tags** (de 8+ clans).
3. **Discord webhook-URL** van het doelkanaal.
4. **Tijd + tijdzone** voor de maandag-cron (bv. ma 09:00 Europe/Amsterdam).

## Out of scope (YAGNI)

- Live Discord-bot met slash-commands of event-listeners.
- Andere tier-overgangen dan I↔II.
- Eén gecombineerde graphic met meerdere namen.
- Scrapen van teamwinter.xyz.
- Dynamische tekst op de balk anders dan de username.

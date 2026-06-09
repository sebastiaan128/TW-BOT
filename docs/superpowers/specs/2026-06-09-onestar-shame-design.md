# Legend 1 — 1-ster "shame" feature — Design

**Datum:** 2026-06-09
**Status:** Ter review

## Doel

Elke ~15 minuten in het **ducks-kanaal** (`1487801970474487962`) een shame-graphic
posten voor elke *nieuwe* 1-ster ranked aanval van een **Legend 1**-speler binnen
Team Winter, met de custom emoji `:LaugingPepe:` als reactie eronder.

- Eén post per 1-ster aanval (meerdere blunders op een dag = meerdere posts).
- Graphic toont **username + % verwoesting** (geen tegenstander-naam).
- Bijna real-time: cron elke 15 min.

## Context / databron

- Per-aanval ster-data komt uit de CoC API `players/{tag}/battlelog` (live
  geverifieerd 2026-06-09). Velden per battle: `battleType`, `attack`,
  `opponentPlayerTag`, `stars`, `destructionPercentage`. Een 1-ster Legend-aanval
  = `battleType === "ranked"` && `attack === true` && `stars === 1`.
- De battlelog is een rollend venster van ~50 battles (≈ de laatste dag ranked
  attacks; Legend = 8 aanvallen/dag). **Geen tijdstempel of id per battle.**
- "Legend 1" = spelers met `leagueTier.id === 105000036` (uit de clan-ledenlijst,
  via de bestaande `getTier`). Zie [[gettier-needs-live-verification]].

## Aanpak: aparte module

Aparte feature naast de promotie/degradatie-bot: ander kanaal, andere cadans (15
min), eigen state. Daarom een **apart entrypoint** (`npm run onestar`) met eigen
cron. Bestaande bouwstenen worden hergebruikt: `fetchClanMembers`, `getTier`,
`renderUsername`-laag, `postGraphic`, `addReaction`.

## Architectuur

| Module | Verantwoordelijkheid |
|---|---|
| `coc.js` (uitbreiden) | `fetchBattleLog(playerTag, apiKey)`; `oneStarAttacks(battlelog)` → ranked attacks met `stars===1` |
| `coc.js` (bestaand) | `fetchClanMembers`, `getTier` (filter op tier `'I'`) |
| `onestar.js` (nieuw) | orkestratie: L1-spelers → battlelog → 1-ster attacks → dedup → render+post+react → state opslaan. CLI met `--dry-run`, `--mark-seen` |
| `render.js` (uitbreiden) | meerdere tekstvelden per graphic (naam + detail) i.p.v. één gecentreerde string |
| `discord.js` (bestaand + klein) | `postGraphic`, `addReaction` (werkt al voor custom emoji via `name:id`); nieuw: `fetchEmojiId(guildId, name, botToken)` om de custom emoji-ID op naam te vinden |
| `config.js` (uitbreiden) | `oneStar`-sectie: `channelId`, `guildId`, `emojiName`, `statePath`; plus `render.onestar` |
| `snapshot.js` (bestaand) | generieke JSON read/write voor de state |

## Datastroom

```
cron (elke 15 min)
  → onestar.js
    → fetchClanMembers per clan, filter getTier==='I'   (Legend 1 spelers)
    → per speler: fetchBattleLog → oneStarAttacks()
    → dedup tegen data/onestar-seen.json (per speler)
    → voor elke NIEUWE 1-ster aanval:
        renderUsername('onestar', {name, destruction}) → postGraphic(ducks) → addReaction(:LaugingPepe:)
    → state per speler opslaan
```

## Dedup-state (`data/onestar-seen.json`)

```json
{ "#PLAYERTAG": ["#OPPONENTTAG|79", "#OPP2|89"] }
```

- Signatuur per aanval = `opponentPlayerTag + "|" + destructionPercentage`
  (geen id/tijdstempel beschikbaar; `stars` is altijd 1 binnen deze set).
- Per run, per speler:
  - `huidige` = signaturen van alle 1-ster ranked attacks nu in de battlelog.
  - `posten` = `huidige` minus de opgeslagen set.
  - na succesvol posten: opgeslagen set := `huidige` (rolt mee — aanvallen die uit
    de log verdwijnen worden vergeten en kunnen niet terugkomen).
- `--mark-seen`: zet de set := `huidige` voor iedereen **zonder** te posten (voor
  deploy / huidige log overslaan, geen flood).
- **Bekend risico:** doet een speler twee verschillende aanvallen met exact
  dezelfde tegenstander én hetzelfde %, dan ziet de bot de tweede als duplicaat.
  Zeldzaam; geaccepteerd.

## Output / graphic

- `render.onestar`: nieuwe asset (door gebruiker aangeleverd) met twee
  tekstvelden — `name` (username) en `destruction` (bijv. "79%"). Render
  ondersteunt een `fields`-lijst met per veld eigen x/y/maxWidth/kleur/grootte.
- Post naar `oneStar.channelId` = `1487801970474487962`.
- Reactie: custom emoji. `addReaction` krijgt `"<name>:<id>"`. De ID wordt bij
  runtime opgehaald via `fetchEmojiId(guildId, emojiName)` (matcht op naam,
  case-insensitive; overleeft her-upload van de emoji). `emojiName` =
  `"LaugingPepe"` (spelling zoals geüpload).

## Foutafhandeling

- Anders dan de wekelijkse bot draait dit elke 15 min, dus **per speler
  geïsoleerd**: mislukt het ophalen van één battlelog (na retry/backoff), dan
  wordt die speler overgeslagen en blijft zijn state ongemoeid; de volgende run
  herstelt vanzelf. Eén kapotte speler blokkeert de rest niet.
- De state van een speler wordt pas bijgewerkt nadat zijn nieuwe posts geslaagd
  zijn (anders volgende run opnieuw proberen).
- Mislukt de reactie (emoji ontbreekt / recht mist), dan logt de bot een warning
  maar de post blijft staan en de state wordt gewoon bijgewerkt.
- Custom emoji niet gevonden in de guild → reacties worden overgeslagen met een
  warning; posten gaat door.

## Testen

- `oneStarAttacks(battlelog)`: filtert ranked + attack + stars===1; negeert
  homeVillage/defense/2-3 ster.
- Dedup-logica: nieuw vs al gezien; pruning van uit-de-log-gerolde signaturen;
  `--mark-seen` post niets en zet de set.
- `render.onestar`: meerdere velden, auto-fit per veld, geldige PNG.
- `onestar.js` run met gemockte coc/discord: post alleen nieuwe attacks, per
  speler geïsoleerde foutafhandeling, dry-run rendert lokaal zonder posten.
- `fetchEmojiId`: vindt id op naam; geeft null bij geen match.

## Out of scope (YAGNI)

- Tegenstander-naam op de graphic (alleen %).
- Aggregatie per speler/dag (we posten per aanval).
- Andere tiers dan Legend 1.
- Historische backfill van 1-ster aanvallen buiten het battlelog-venster.
- Exacte tijd per aanval (niet in de API).

## Open punten (door gebruiker aan te leveren)

1. De **graphic** (asset) voor de 1-ster post → bepaalt tekstcoördinaten.
2. De **custom emoji** `:LaugingPepe:` uploaden naar de server (guild
   `1487801969371250798`) zodat de ID opgehaald kan worden.

# TW Legend League Promotie/Degradatie-bot

Post in Discord wie er tussen Legend League I en II is gepromoveerd
(felicitatie-graphic + 🔥) of gedegradeerd (poep/clown-graphic + 🤡).

## Hoe de detectie werkt

De bot leest per Legend-speler de **`leaguehistory`** van de Clash of Clans API.
De tier (Legend 1/2) zit op `leagueTier.id`: `105000036` = Legend 1, `105000035`
= Legend 2. Per reset vergelijkt de bot de tier van de **laatst afgesloten
season** (laatste history-entry) met de **huidige** tier:

- Legend 2 → Legend 1 = **promotie**
- Legend 1 → Legend 2 = **degradatie**

Alleen spelers die de laatste season ook echt gespeeld hebben tellen mee (oude,
inactieve historie wordt genegeerd). Er is geen snapshot-baseline nodig — de API
onthoudt de vorige tiers zelf.

Een klein state-bestand (`data/last-snapshot.json`, alleen `lastAnnouncedSeason`)
zorgt dat elke reset **één keer** wordt aangekondigd, ook als de bot vaker draait.

## Setup

1. `npm install`
2. Maak `.env` op basis van `.env.example`:
   - `COC_API_KEY` — van https://developer.clashofclans.com/ (IP-locked op de
     cron-host; gebruik het publieke IP van die machine bij het aanmaken).
   - `DISCORD_BOT_TOKEN` — bot-token. De bot post de banner én zet de reactie.
     De bot moet in de server zitten met **View Channel + Send Messages +
     Attach Files + Add Reactions** in het doelkanaal.
3. Vul in `config.json` de echte `clanTags` in (de TW-clans) en de `channelId`
   van het doelkanaal.
4. Controleer de live detectie: `npm run dry-run` (rendert naar `out/`, post niet).

## Draaien

- Normaal: `npm start` — post de bewegingen van de laatste reset (één keer per
  reset; daarna doet een herhaalde run niets tot de volgende reset).
- `npm run dry-run` — detecteert en rendert naar `out/`, post niet, raakt de
  state niet aan.
- `npm run mark-seen` — markeert de huidige reset als "al aangekondigd" zonder te
  posten. Draai dit eenmalig bij een nieuwe deploy zodat de bot de huidige reset
  overslaat en pas vanaf de volgende reset post.
- `node --env-file=.env src/index.js --force` — post de huidige reset opnieuw,
  ook al is die al aangekondigd.

## Cron (elke maandagochtend, Europe/Amsterdam)

Open `crontab -e` op de host en voeg toe (voorbeeld 09:00):

```cron
CRON_TZ=Europe/Amsterdam
0 9 * * 1 cd /pad/naar/TW-BOT && mkdir -p data && /usr/bin/node --env-file=.env src/index.js >> data/run.log 2>&1
```

- `* * 1` = elke maandag. Pas `0 9` aan voor een ander tijdstip.
- Gebruik het absolute pad naar `node` (`which node`).
- De host moet het IP hebben waarop de CoC API-key gewhitelist is.

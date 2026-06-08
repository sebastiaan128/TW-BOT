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
0 9 * * 1 cd /pad/naar/TW-BOT && mkdir -p data && /usr/bin/node --env-file=.env src/index.js >> data/run.log 2>&1
```

- `* * 1` = elke maandag. Pas `0 9` aan voor een ander tijdstip.
- Gebruik het absolute pad naar `node` (`which node`).
- De host moet het IP hebben waarop de CoC API-key gewhitelist is.

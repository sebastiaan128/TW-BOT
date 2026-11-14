# TW-Bot 2

Discord-bot voor TW: bevestigde promoties/degradaties, ranked-aanvalmeldingen,
1-ster-ranking per echt CoC-seizoen en historische spelerstatistieken.

## Starten

Node **22.13 of nieuwer** is nodig voor de ingebouwde SQLite-driver. Node 24 LTS
is de aanbevolen hostingversie. Er is geen aparte databaseserver nodig.

```sh
npm ci
cp .env.example .env
# Vul COC_API_KEY en DISCORD_BOT_TOKEN in .env of in de hostingomgeving in.
npm run validate
npm run preview:assets
npm run serve
```

`npm run serve` is de always-on bot. `npm start` voert alleen een
promotie/degradatiecontrole uit. Bestandslocaties worden ten opzichte van het
configuratiebestand opgelost, zodat starten vanuit een andere werkmap werkt.
`TW_CONFIG` kan naar een ander configuratiebestand verwijzen.

De CoC-sleutel moet het publieke IP van de host toestaan. De Discord-bot heeft
View Channel, Send Messages, Attach Files, Read Message History en Add Reactions
nodig. Voor aangepaste emoji's ook toegang tot de ingestelde server/emoji.

## Eerste installatie en migratie

De eerste controle legt per nieuwe speler een beginstand vast en verstuurt geen
oude aanvalmeldingen. Aanvallen met een echt tijdstip uit de eerste battlelog
worden wel in statistieken opgenomen. Dat is alleen de beschikbare recente
historie, geen reconstructie van een compleet seizoen.

Bij een upgrade worden `data/last-snapshot.json` en `data/onestar-seen.json`
eenmalig gelezen. De oude bestanden blijven intact. Tier-geheugen verhuist naar
SQLite; onbetrouwbare oude aanvalsignaturen worden vervangen door een nieuwe
beginstand. Ongeldige JSON stopt de migratie met een fout, in plaats van stil
opnieuw te beginnen. Maak vooraf een back-up van `data/`.

Na herstart hervat de bot bestaande aanvalvensters. Hij markeert niet opnieuw
alle aanvallen als gezien. Bewaar **de hele data-map persistent** op je host.

## Betrouwbaarheid

- Waarnemingen, statistieken en wachtrij worden atomair opgeslagen in SQLite.
- Elke gebeurtenis heeft een vaste identiteit. Handmatige correcties gebruiken
  dezelfde identiteit als automatische meldingen.
- Per melding worden status, pogingen, kanaal en Discord-bericht-ID bewaard.
- Een gedeeltelijk mislukte batch herhaalt eerder geslaagde berichten niet.
- Een onzekere verzending, bijvoorbeeld een verbroken verbinding na acceptatie,
  krijgt status `uncertain`. De bot stuurt die niet automatisch opnieuw.
- Discord nonces geven extra bescherming tijdens korte retries. Discord bewaart
  deze deduplicatie slechts enkele minuten: absolute exactly-once-verzending
  over een externe API kan niet worden gegarandeerd.
- SQLite-leases met heartbeat voorkomen gelijktijdige scanners/verzenders,
  ook tussen processen die hetzelfde lokale databasebestand delen.
- Requests hebben time-outs voor zowel headers als responsebody. Tijdelijke
  leesfouten worden herprobeerd; 401/403-fouten niet. Expliciete 429s respecteren
  Retry-After. Onzekere message-POSTs worden nooit blind herhaald.

Gebruik één lokale persistente schijf voor SQLite, geen netwerkbestandssysteem.
Bij een normale stop wacht de daemon op actieve taken. Na 30 seconden beëindigt
hij de shutdown geforceerd; onafgeronde verzendingen blijven controleerbaar.
Fatale programmeerfouten stoppen het proces met foutstatus zodat de hosting kan
herstarten.

## Promoties en degradaties

De actuele tier wordt met opgeslagen tiers vergeleken. Alleen Legend II → I en
I → II leveren een melding op. Twee waarnemingen met minstens vijf minuten
ertussen moeten dezelfde wijziging zien. De beginstand en de melding worden
vervolgens in één transactie vastgelegd.

Automatische controles draaien standaard iedere 30 minuten, vanaf maandag
10:00 Europe/Amsterdam tot woensdag 00:00. Daardoor kunnen dinsdag nog
bevestigingen na downtime binnenkomen. Openstaande bevestigingen horen bij één
reset en kunnen niet een week later alsnog bevestigd worden.

Een mislukte clan-aanvraag telt niet als vertrek. Een bewezen vertrek, verlopen
geheugen of onbekende tier voorkomt dat een terugkeer onterecht als degradatie
wordt aangekondigd. Nooit eerder waargenomen spelers krijgen een stille
beginstand. Bewegingen die volledig tijdens downtime plaatsvonden zijn niet
altijd achteraf te reconstrueren.

## Aanvallen en seizoensranking

De live API bevat `battleTimestamp` als UTC-tijdstip; `battleTime` is de
**aanvalsduur**, geen tijdstempel. De bot sorteert timestamped logs zelf, zodat
zowel oudste-eerst als nieuwste-eerst werkt. Aanvallen met dezelfde tegenstander
én hetzelfde percentage blijven verschillend wanneer hun tijdstippen verschillen.

Voor oudere logvormen zonder tijdstip wordt overlap tussen volledige vensters
gebruikt. Zonder overlap wordt een dekkingsgat gemeld; ononderscheidbare identieke
vermeldingen kunnen zonder API-identiteit niet met zekerheid worden gescheiden.
Bij timestamped logs kan de bot de zichtbare nieuwe aanvallen na een gat alsnog
inhalen. Aanvallen die al uit de API-log verdwenen zijn blijven ontbrekend.

Het actuele seizoen komt bij voorkeur uit de CoC API: actieve metadata uit de
seizoenslijst of het actuele spelersprofiel (`currentLeagueSeasonId`). Alleen
voltooide seizoenen in de lijst worden niet als het huidige seizoen behandeld.
De vierwekelijkse grenzen gebruiken de ClashPerk-conventie als terugval; bron en
foutmelding blijven zichtbaar. Zet `seasons.fallback` op `none` om zonder actuele
API-informatie te stoppen. Er wordt nooit stil een kalendermaand gebruikt.

De ranking telt **alle waargenomen ranked-aanvallen van de geselecteerde tiers**,
onafhankelijk van het al dan niet versturen van een melding. Hij toont:

- aantal 1-ster-aanvallen, aflopend gerangschikt;
- totaal geregistreerde aanvallen en 1-ster-percentage;
- filtering op clan, seizoen en speler;
- gemiddelde sterren en vernietiging bij spelerstatistieken;
- zichtbare bron, trackingstart en dekkingsgaten.

Een aanval met bekend tijdstip wordt aan het bijbehorende seizoen gekoppeld.
Aanvallen zonder tijdstip tellen op waarneming, behalve rond een bekende
seizoenswissel: die blijven `unassigned` in plaats van in het verkeerde seizoen
te belanden. Eerdere seizoenen blijven bewaard. Bij een waargenomen
seizoenswissel komt eenmaal een eindranking in de wachtrij.

## Berichten, regels en limieten

Standaard maximaal 10 berichten per batch, 6 per kanaal en 2 per speler in 15
minuten. Limieten gebruiken opgeslagen succesvolle verzendingen en blijven dus
ook na een herstart gelden. Overige meldingen wachten; ze worden niet weggegooid.
Bij uitgeschakelde functies blijft hun wachtrij behouden.

`config.json` bevat alle defaults:

- `movements`: interval, beginuur, herstelvenster, bevestigingstijd en geheugen;
- `oneStar`: interval, tiers I/II, sterren, vernietigingsbereik en genegeerde tags;
- `delivery`: batch-, kanaal- en spelerlimieten en venster;
- `ranking`: kanaal en maximaal aantal spelers;
- `summary`: weekoverzicht per clan na het herstelvenster, standaard woensdagavond;
- `render`: templates, fonts, vaste labels en dynamische tekstvelden;
- `commands` en `health`: optionele HTTP-servers, standaard uitgeschakeld.

Fonts en achtergronden worden gecachet. Er wordt direct op het uitvoerformaat
getekend. Ontbrekende fonts/assets en ongeldige instellingen falen bij opstarten.
Nieuwe templates staan in `assets/v2/`; oorspronkelijke afbeeldingen zijn bewaard.

## Beheer via de terminal

```sh
npm run manage -- help
npm run manage -- status
npm run manage -- queue --status uncertain
npm run manage -- ranking
npm run manage -- ranking --season 1793595600 --clan '#2JPVV99RP'
npm run manage -- player '#SPELERTAG'
npm run manage -- seasons
npm run manage -- preview movements
npm run manage -- check attacks
npm run manage -- deliver
npm run manage -- settings --feature oneStar --enabled false
npm run manage -- rules --key oneStar.stars --value '[0,1]'
```

`check` zet meldingen klaar; `deliver` verstuurt binnen de limieten. `preview`
werkt met een tijdelijke database in geheugen en verandert geen opgeslagen
voortgang. De aparte `npm run dry-run` / `onestar:dry-run` renderen hun gevonden
meldingen ook naar `out/`. `preview:assets` rendert altijd drie voorbeeldkaarten
zonder API of secrets. `seed`/`mark-seen` zet alleen een beginstand en verstuurt niet.

Een onzekere verzending afhandelen:

```sh
# Controleer eerst het bericht in Discord.
npm run manage -- resolve EVENT_ID --message-id BERICHT_ID --channel-id KANAAL_ID
# Of, alleen wanneer het niet is verstuurd:
npm run manage -- retry EVENT_ID --confirm
npm run manage -- deliver
# Een foutieve melding niet meer versturen:
npm run manage -- cancel EVENT_ID
```

Handmatige correctie:

```sh
npm run manage -- correct --tag '#SPELERTAG' --name 'Spelersnaam' --type demoted --reset 2026-11-09
npm run manage -- deliver
```

De oude hardcoded post-scripts zijn uitgezet. `--force` is verwijderd: herstel
gebruikt voortaan een gecontroleerde gebeurtenis in dezelfde wachtrij.

## Discord slash commands

Zet `commands.enabled` op `true`, vul guild/host/port in en zet
`DISCORD_APPLICATION_ID` en `DISCORD_PUBLIC_KEY` in de omgeving. Publiceer de
lokale HTTP-server achter een HTTPS reverse proxy. Stel in het Discord Developer
Portal de Interactions Endpoint URL in op `https://jouw-host/interactions`.
De bot moet met scope `bot` en `applications.commands` zijn toegevoegd.

```sh
npm run manage -- register-commands
npm run serve
```

Beschikbaar: `/tw ranking`, `/tw player`, `/tw seasons`, `/tw summary`, `/tw status`,
`/tw queue`, `/tw check`, `/tw settings`, `/tw rules`, `/tw retry`, `/tw cancel`.
Alleen leden met Administrator of Manage Server mogen beheeracties doen.
Elke opdracht wordt op server en applicatie gecontroleerd. Verzoeken vereisen een
geldige Ed25519-handtekening op de ongewijzigde body. Verouderde verzoeken worden
geweigerd; herhaalde interaction-ID's krijgen hetzelfde resultaat. Er is een
opgeslagen limiet van 20 opdrachten per gebruiker per minuut. Antwoorden zijn
privé en kunnen geen mentions activeren.

## Monitoring en hosting

Logs zijn JSON met taak, duur en resultaat/fout. `manage status` toont laatste
succes, gedeeltelijk mislukte scans, gaten en openstaande bevestigingen.
Met `health.enabled: true` komt `/healthz` op de ingestelde host/poort beschikbaar:
200 bij gezond, 503 bij achterstallige of gefaalde actieve taken of foutieve/
onzekere verzendingen. De publieke response bevat geen spelergegevens of secrets.

Een container kan met de meegeleverde Dockerfile worden gebouwd. Mount `data/`
persistent en lever secrets via omgevingsvariabelen aan. De container draait als
onbevoorrechte gebruiker. De gebruiker moet schrijfrechten op de gemounte
`data/` en eventuele outputmap hebben.

## Verificatie en verdere ideeën

```sh
npm test
npm run validate
npm run preview:assets
```

CI controleert Node 22 en 24. Tests gebruiken fakes en tijdelijke databases;
ze posten niets naar Discord. Zie [docs/REWORK.md](docs/REWORK.md) voor de
ontwerpkeuzes, beperkingen en verdere feature-ideeën. Afbeeldingsprompts staan in
[docs/ASSETS.md](docs/ASSETS.md).

## Railway Hobby en lokaal testen via de CoC-proxy

Zet op Railway en desgewenst lokaal in `.env`:

```text
COC_API_BASE_URL=https://cocproxy.royaleapi.dev/v1
```

Maak een CoC-sleutel met toegestaan IP `45.79.218.79` en zet die als
`COC_API_KEY`. Aanvragen en de CoC-sleutel gaan dan via de derde partij RoyaleAPI:
https://docs.royaleapi.com/proxy. Je thuis-IP of een veranderend Railway-IP hoeft
voor deze route niet op de sleutel te staan. Zonder deze instelling blijft de
bot rechtstreeks de officiële API gebruiken; daarvoor moet het uitgaande IP
van die host op de sleutel staan. Alleen de officiële API en deze expliciete
proxy mogen als endpoint worden ingesteld; redirects worden geweigerd.

Gebruik voor een lokale controle `npm run manage -- preview attacks` of
`npm run onestar:dry-run`. Die versturen geen Discord-berichten en veranderen
geen opgeslagen voortgang. Laat niet tegelijkertijd twee productie-instanties
met dezelfde taak en dezelfde Discord-bestemming draaien.

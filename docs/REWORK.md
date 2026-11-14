# TW-Bot 2 — rework en vervolg

## Gerealiseerd

De oorspronkelijke twee taken gebruiken nu gedeelde services, SQLite-opslag en
een persistente outbox. Niet alle code is opnieuw geschreven: bestaande pure
tierlogica, timezonehelpers en renderingtests blijven bruikbaar.

| Onderdeel | Wijziging |
| --- | --- |
| Verzending | Status per gebeurtenis, ontvangstbewijs, nonce, expliciete onzekerheid |
| Opslag | SQLite-transacties, WAL, volledige synchronisatie en procesleases |
| Herstart | Opgeslagen vensters hervatten; alleen nieuwe spelers stil initialiseren |
| Aanvalidentiteit | Echte battleTimestamp gebruiken; battleTime is duur |
| API-volgorde | Timestamped logs sorteren; volgorde van API niet vertrouwen |
| Promoties | Twee gespreide waarnemingen binnen dezelfde reset |
| Herstel | Maandag en dinsdag controleren, openstaande meldingen blijven in wachtrij |
| Spelers | Clan, naam, laatste waarneming, vertrek en onbekende tier bewaren |
| Berichten | Persistente limieten per run/kanaal/speler |
| Seizoenen | CoC-metadata/profiel met zichtbare ClashPerk-terugval |
| Ranking | 1-sterren, totaal, percentage, clanfilter, historische seizoenen |
| Statistieken | Alle gevolgde ranked-aanvallen; niet afhankelijk van berichten |
| Overzichten | Weekoverzicht per clan en eindranking bij seizoenswissel |
| Beheer | Terminal en optionele Discord slash commands |
| Monitoring | Gestructureerde logs, dekkingsgaten, status en health endpoint |
| Graphics | Drie nieuwe templates, scherpe runtime-tekst en percentage |
| Hosting | Node 22.13+, Dockerfile, CI voor Node 22/24, dependency updates |

## Live API-controle op 14 november 2026

Een volledige scan en herhaalde scan met twee spelers zijn alleen-lezen
gecontroleerd: 32 aanvallen in de database in geheugen, nul klaargezette
berichten en nul nieuwe gebeurtenissen bij de herhaling. Met de bestaande CoC-sleutel; niets naar Discord
verstuurd. De seizoenslijst gaf historische v2-ID's terug. Een actueel Legend-I
profiel bevatte `currentLeagueSeasonId` en `previousLeagueSeasonId`, zonder het
oude `legendStatistics.currentSeason`-veld. Battlelogs bevatten `battleTimestamp`
(zoals `20261112T055012.000Z`) en `battleTime` als duur in seconden. De volgorde
was oudste-eerst. Voor deze werkelijke veldvormen zijn regressietests toegevoegd.

De huidige seizoens-ID komt uit het profiel; de eindgrens van een profielseizoen
zonder eindtijd gebruikt de vierwekelijkse ClashPerk-conventie. De bron is daarom
expliciet vastgelegd als API-profiel plus grensconventie. API-payloads kunnen
veranderen; valideer de seizoensbron bij een toekomstige game-update.

## Grenzen van de telling

De ranking is een telling van beschikbare en waargenomen aanvallen. Bij de eerste
start kan beschikbare timestamped historie worden meegenomen zonder oude posts.
De bot kan niet een seizoen reconstrueren uit aanvallen die al uit de API zijn
verdwenen. Een clanfilter verwijst naar de clan waarin de speler tijdens de
waarneming zat; oude clanlidmaatschappen staan niet in de battlelog.

Als twee aanvallen geen unieke ID of tijdstip hebben en verder identiek zijn,
kan de API onvoldoende informatie leveren om ze zeker uit elkaar te houden.
Daarom blijft de compatibiliteitsroute conservatief en toont hij gaten.

Een database en een externe bericht-API kunnen niet samen één transactie
uitvoeren. Een onzekere verzending wordt daarom vastgehouden voor controle,
geen onbeperkte automatische retry. Dit voorkomt dat betrouwbaarheid gelijk
wordt gesteld aan een garantie die Discord niet geeft.

## Aanvullende feature-ideeën

Deze ideeën zijn een vervolgbacklog, niet standaard ingeschakelde meldingen:

1. **Een vaste rankingkaart bijwerken** in plaats van steeds nieuwe berichten.
   Met pagina's per clan en aparte sortering op aantal of percentage.
2. **Seizoensawards**: meeste 1-sterren, beste verbetering en beste gemiddelde.
   Percentage-awards pas vanaf een instelbaar minimumaantal geregistreerde aanvallen.
3. **Persoonlijke statistiekkaarten** met een grafiek van sterren en vernietiging
   door het seizoen, plus vergelijking met het vorige waargenomen seizoen.
4. **Streaks**: hoeveel geregistreerde aanvallen sinds de laatste 1-ster. Een gat
   in de tracking moet de streak ongeldig maken in plaats van hem te verlengen.
5. **Kanaal per clan**, met één centrale TW-ranking en optionele clanmeldingen.
6. **Speler opt-out** voor publieke grapmeldingen terwijl clanstatistieken volgens
   de gekozen serverinstellingen blijven werken.
7. **Een klein beheerdashboard** voor previews, wachtrij en live status. Dit vraagt
   een eigen inlog-/rechtenmodel; de bestaande health endpoint is daarvoor geen UI.
8. **Gecontroleerde externe historie-import**, als ClashPerk of een andere bron
   een toegestane export/API met betrouwbare aanval-ID's en timestamps levert.

Een volgende verbetering moet dezelfde uitgangspunten behouden: echte
seizoensgrenzen, zichtbare datadekking, herstartbare verwerking en limieten die
niet verdwijnen bij een herstart.

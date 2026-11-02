# NFLBite-Modul fuer Luna

Entwicklungsstand: 0.1.0. Ein eigenstaendiges Service-Modul fuer die
JavaScriptCore-Schnittstellen der vorhandenen Luna-App. Keine Aenderungen an der
App und keine Installation auf dem Apple TV wurden vorgenommen.

## Modul-Konventionen

Referenz: [CPRmichel/sora-movie2k-module](https://github.com/CPRmichel/sora-movie2k-module),
einschliesslich Movie2k, Kinoger und Moflix. Verglichener Stand:
`4d9b1514d9dfdb75c2bd5688a2b12801f7ae63ef`.

Wie deine bestehenden Module besteht die auslieferbare Version aus einer
JSON-Metadatendatei und einem eigenstaendigen JavaScript-Skript mit den vier
asynchronen Einstiegspunkten `searchResults`, `extractDetails`, `extractEpisodes`
und `extractStreamUrl`. Suchtreffer verwenden `title`, `image`, `href`;
Detailangaben `description`, `aliases`, `airdate`. Antworten werden als
JSON-Strings zurueckgegeben.

Stream-Objekte enthalten wie bei Kinoger/Moflix beide gleichwertigen Felder
`url` und `streamUrl`, dazu `title` und erforderliche HTTP-Headers. Die Metadaten
verwenden `asyncJS: true` und `downloadSupport: false`. `type: live` bleibt
absichtlich erhalten, weil NFL-Spiele keine Filme oder Serien sind. Die
Kompatibilitaetsangabe bleibt auf Luna begrenzt; andere Apps wurden nicht getestet.

Der HTML-Parser ist im fertigen Skript enthalten. Luna braucht deshalb weder
Node.js noch einen Paketmanager. Fehler bleiben diagnostizierbar; es gibt keinen
Fallback, der unaufgeloeste HTML-Player als abspielbare Streams ausgibt.

## Dateien

- `nflbite.json`: importierbare Service-Metadaten mit GitHub-Raw-Skriptadresse.
- `nflbite.js`: fertig gebuendeltes Skript, ohne npm-Abhaengigkeiten in Luna.
- `src/`: lesbarer Quellcode. `nflbite.js` nicht von Hand bearbeiten.
- `test-results/live.json`: letzter lokaler Live-Test, nicht versioniert.
- `test-results/playback.jpg`: dekodiertes Testbild, nicht versioniert.

## Lokal testen

Voraussetzungen: Node.js 20+, npm, fuer den nativen Test Xcode/Swift auf macOS;
fuer den Videotest ausserdem FFmpeg im PATH.

```sh
cd nflbite
npm ci
npm test
npm run test:jsc
npm run test:server
npm run test:live -- --resolve
npm run test:live -- --playback
npm run test:live -- "NFL Red Zone" --playback
npm run test:live -- Jets --resolve
```

`npm test` prueft offline mit synthetischen Testdaten. `test:jsc` fuehrt die
vier Luna-Einstiegspunkte in Apples echtem JavaScriptCore aus, ebenfalls mit
Testdaten und Lunas UTF-8-atob-Verhalten. Der Bundle-interne Base64-Decoder ist
notwendig, weil die Entity-Tabelle des HTML-Parsers Binaerdaten enthaelt.

`test:live` fragt den aktuellen Spielplan und die Anbieter des ersten passenden
Eintrags ab. `--resolve` prueft zusaetzlich erreichbare HLS/DASH-Manifeste.
`--playback` dekodiert ein Videobild mit FFmpeg. Das ist kein UI-Test der Luna-App
und kein Nachweis fuer alle Spiele, Anbieter, Audio oder langfristig stabile
Wiedergabe. Die Tests speichern keine dauerhaften Stream-Tokens im Modul.

## Modul importieren

Unter Settings > Services die folgende Metadaten-URL hinzufuegen und das Modul
anschliessend aktivieren:

```text
https://raw.githubusercontent.com/CPRmichel/sora-movie2k-module/main/nflbite/nflbite.json
```

Das Skript wird direkt von GitHub geladen; auf dem Mac muss kein Server laufen.
Die unten beschriebene Luna-Einschraenkung beim Einstieg in Live-Sport bleibt
bestehen. Der Import selbst wurde noch nicht in Luna getestet.

## Lokale Entwicklung im Simulator

```sh
npm run build
npm run serve
```

Im tvOS-Simulator kann unter Settings > Services diese Entwicklungs-URL
eingetragen werden:

```text
http://127.0.0.1:8787/nflbite.json
```

Der Server liefert ausschliesslich die beiden Moduldateien und lauscht nur auf
dem Mac. In der lokal ausgelieferten JSON-Antwort setzt er `scriptUrl` auf die
lokale Skriptadresse; die JSON-Datei auf der Festplatte bleibt unveraendert.
Er muss fuer den Download laufen; Luna speichert das Skript anschliessend lokal.
Mit Ctrl+C beenden.
Falls die App lokale HTTP-Downloads blockiert, ist ein HTTPS-Host erforderlich.

Diese lokale Adresse ist keine veroeffentlichte Modul-URL. Fuer den physischen
Apple TV die GitHub-Raw-Adresse aus dem Abschnitt "Modul importieren" verwenden.
`127.0.0.1` auf dem Apple TV bezeichnet nicht diesen Mac.

## Wichtige Luna-Einschraenkung

Die bestehende Hauptsuche in `Luna/Views/SearchView.swift` durchsucht TMDB, nicht
die installierten Services. Ein importiertes NFL-Modul fuegt deshalb noch keinen
benutzbaren Sport-Spielplan zur Oberflaeche hinzu. Dazu braucht Luna einen
Service-/Live-Sport-Einstieg, der `searchResults("NFL")` oder eine Teamsuche
aufruft und die Treffer als `MediaDetailView(moduleItem:service:)` oeffnet.
Diese Ansicht existiert bereits, hat aktuell aber keinen solchen Einstieg.
Die Anbieter-Suche zu einem TMDB-Film ersetzt das nicht.

## Unterstuetzter Ablauf

- `searchResults(query)` liest die aktuelle Woche; `NFL`, `Live`, `Football`,
  `all`, `nflbite` und eine leere Suche zeigen alle Eintraege.
- Andere Suchbegriffe filtern Teamnamen, ohne Beachtung der Grossschreibung.
- NFL RedZone steht vor Einzelspielen. `RedZone`, `Red Zone`, `NFL RedZone`
  und `NFL Red Zone` finden denselben Kanal, sofern er aktuell gelistet ist.
  Ohne RedZone-Eintrag gibt es keinen erfundenen Treffer und keinen Ersatz
  durch ein beliebiges Einzelspiel.
- `extractDetails(url)` liefert Beschreibung, Teams und Startzeit in UTC.
- `extractEpisodes(url)` liefert genau einen Live-Eintrag, keine erfundene Serie.
- `extractStreamUrl(url)` untersucht begrenzt Anbieter und verschachtelte
  iframes. Es versteht HTML-video/source und literale Player-Konfigurationen,
  auch einfache Variablenverweise. Es liefert Luna JSON-Streams mit HTTP-Headers.
- HLS/DASH-Kandidaten werden auf HTTP 200 und Manifest-Inhalt geprueft.
  Direkte MP4-Links werden ohne vollstaendigen Download weitergereicht.

Bewusst begrenzt auf die ersten sechs Anbieter, hoechstens 18 Playerseiten,
sechs Ebenen und vier Kandidaten. Nach 15 Sekunden werden keine neuen Seiten
mehr begonnen; laufende Requests haengen vom Timeout des Hosts ab. Ergebnisse
werden im Modulkontext fuer 30 Sekunden wiederverwendet. Nicht jeder Anbieter
wird ausprobiert. Ohne kompatible Quelle meldet das Modul einen Fehler, statt
eine HTML-Seite als Stream zu tarnen.

Keine Ausfuehrung fremder Skripte, kein DRM-, Login-, Paywall- oder
Browser-Challenge-Bypass. Eigene Transportprotokolle wie `vttp://`, dynamische
Player-APIs und verschleierte Konfigurationen sind nicht allgemein unterstuetzt.
Nur Inhalte verwenden, fuer die entsprechende Nutzungsrechte vorliegen.

## Verifiziert am 1. November 2026

18 Offline-Tests und der native JavaScriptCore-Test erfolgreich. Die allgemeine
NFL-Suche fand 15 Eintraege. Der anschliessende gezielte Test mit `NFL Red Zone`
lieferte genau einen RedZone-Eintrag und 55 Anbieter. Eine direkt erreichbare
HLS-Quelle blieb nach Filterung uebrig; FFmpeg dekodierte ein echtes NFL-Bild.
Das ist eine Momentaufnahme, keine Zusage fuer die spaetere Verfuegbarkeit.

Parser und Build-Abhaengigkeiten sind in `package-lock.json` fixiert.
Lizenzhinweise der Abhaengigkeiten stehen in `THIRD_PARTY_NOTICES.txt`.

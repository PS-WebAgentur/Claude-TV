# Claude TV

Ein kleines Desktop-Programm, das zeigt, wie viel du gerade in Claude Code
verbrauchst. Mit Clawd, einem Pixelmaskottchen, das mitspielt: es schläft, wenn
du Pause machst, setzt die Brille auf und tippt, wenn es läuft, schwitzt beim
Sprint und liegt platt am Anschlag. Daneben steht ein kleiner Rechner, dessen
Bildschirm den Zustand mitzeichnet.

Gestaltung als Mischung mit klarer Aufgabenteilung: Pixel für Maskottchen und
Grafiken, Serif für die großen Zahlen, Sans für die Texte.

Läuft rein lokal. Kein Server, kein Konto, kein offener Port, keine Anfrage ins
Netz. Das Programm liest ausschließlich Dateien, die auf deiner Platte sowieso
schon liegen.

## Was es zeigt

**Übersicht**

* das laufende 5-Stunden-Fenster in Prozent, mit Countdown bis zum Reset
* eine **Marke „Uhr"** über dem Balken: der Balken zeigt den Verbrauch, die
  Marke zeigt, wie viel Zeit des Fensters schon vorbei ist. Balken links von der
  Marke heißt Luft, rechts davon heißt zu schnell.
* daraus eine Klartextzeile: `56 % Reserve gegenüber der Uhr`, `Genau im Takt
  der Uhr` oder `In diesem Tempo bei 100 % in 19 Min.`
* die letzten 7 Tage, Tokens pro Minute, Verbrauch heute, Sitzungen heute und
  das zuletzt genutzte Modell
* deinen Tarif, gelesen aus der Claude-Code-Konfiguration

**Details**

* **Woraus der Verbrauch besteht**: ein gestapelter Balken mit Legende, also
  Eingabe, Antwort, Denken und neu angelegter Cache, jede Zeile mit einer
  kurzen Erklärung. Wiederverwendeter Cache steht getrennt darunter.
* Verbrauch pro Modell und pro Projekt
* Verlauf im laufenden Fenster und über den Tag

**Taste `H`** erklärt jede Zahl in einem Satz. Wenn irgendwo unklar ist, was
etwas bedeutet, steht die Antwort dort.

## Was es nicht kann

Drei Dinge vorweg, damit die Anzeige nicht mehr verspricht, als sie hält:

**Deine Chats auf claude.ai sind unsichtbar.** In den Logs steht nur Claude
Code. Alles, was du im Browser oder in der Desktop-App mit Claude machst, fehlt.

**Echte Limit-Prozente gibt es lokal nicht.** Claude Code kennt sie, holt sie
aber live von der API und schreibt sie nirgends auf die Platte. Nachgesehen
wurde in `~/.claude/`, in `~/.claude.json` samt Sicherungen und in den
Session-Logs: dort stehen Tarif und Tokenzahlen, aber keine Auslastung und keine
Resetzeiten. Deshalb ist die Skala selbstkalibrierend: 100 % ist dein eigenes
p90-Fenster, also der Wert, den 9 von 10 deiner abgeschlossenen Fenster nicht
überschreiten. Die Fußzeile schreibt immer hin, was gerade als 100 % gilt.
Solange weniger als drei Fenster gemessen sind, gibt es gar keine Prozente,
sondern nur absolute Zahlen.

**Die Anzeige springt pro Nachricht, nicht pro Token.** Claude Code schreibt
seine Logs, wenn eine Nachricht fertig ist. Genau dieser Moment löst auch den
Partikelstoß zur Figur aus.

## Loslegen

Gebraucht wird Node 18 oder neuer. Einmalig:

```bash
npm install
```

Zum Ausprobieren:

```bash
npm start
```

Fertige Programme bauen:

```bash
npm run dist
```

Danach liegen zwei Dateien in `dist/`:

| Datei | wofür |
| --- | --- |
| `Claude TV arm64.zip` | für ARM64-Windows, läuft dort native. Auspacken, `Claude TV.exe` starten, bei Bedarf an die Taskleiste anheften. |
| `Claude TV x64.exe` | portable Einzeldatei, läuft auf jedem Windows. Auf ARM64 über Emulation, also etwas langsamer. |

### Warum kein Installer

Es gab einen, und er war kaputt. Der NSIS-Installer für arm64 hat alle
Datendateien und `resources/app.asar` korrekt abgelegt, aber genau die
arm64-Binärdateien nicht, also `Claude TV.exe` und die DLLs. Die Verknüpfung
zeigte deshalb ins Leere, und Windows bot an, sie auf eine zufällige Kopie im
Temp-Verzeichnis umzubiegen.

Nachgeprüft: das Installer-Paket **enthält** die Dateien, mit 7-Zip lassen sie
sich einzeln herausholen. Es scheitert also am Schreiben während der
Installation, nicht am Bauen. Beim Build tauchte passend dazu die Meldung
`output file is locked for writing (maybe by virus scanner)` auf. Der portable
Zielmodus ist auf arm64 ebenfalls defekt: die Datei entsteht, beendet sich beim
Start aber sofort und ohne Fehlermeldung.

Übrig bleiben die zwei Wege oben, und die sind beide geprüft.

**Wer noch eine Installation aus der Installer-Zeit unter
`%LOCALAPPDATA%\Programs\Claude TV` hat**, kann sie weiter benutzen. Am
Programmcode ändert sich bei einer neuen Version nur `resources/app.asar`, alles
andere ist Electron und bleibt gleich:

```bash
cp "dist/win-arm64-unpacked/resources/app.asar" "$LOCALAPPDATA/Programs/Claude TV/resources/app.asar"
```

Sauberer ist, den Ordner zu löschen, `Uninstall Claude TV.exe` vorher laufen zu
lassen und stattdessen das Zip auszupacken.

## Bedienung

| Taste | Wirkung |
| --- | --- |
| `D` | zwischen Übersicht und Details wechseln |
| `T` | Farbschema: nach System, hell, dunkel |
| `P` | immer im Vordergrund, praktisch für den Zweitmonitor |
| `H` | erklärt, was die Zahlen bedeuten |

Dieselben Sachen gibt es auch als Knöpfe in der Titelzeile. Größe, Position,
Ansicht und Farbschema werden gemerkt.

## Die Kennzahl

Als **Verbrauch** zählt `Eingabe + Antwort + neu angelegter Cache`.
Wiederverwendeter Cache läuft getrennt und leiser mit.

Der Grund steht in den Daten: von rund 1.214 Millionen Tokens in einer
typischen Historie sind über 1.153 Millionen reine Cache-Lesevorgänge. Als
Lastanzeige wäre die Gesamtsumme also fast nur Cache und würde jede Bewegung
verschlucken. Der Verbrauch liegt im gleichen Zeitraum bei rund 60 Millionen und
bewegt sich sichtbar mit dem, was du tatsächlich tust.

## Clawd

Ein Sprite von 28 mal 22 Pixeln, im Quelltext als Zeichenkarte gezeichnet und
als SVG mit einem Rechteck pro Pixelreihe gerendert.

**Kein schwarzer Umriss.** Die Räumlichkeit kommt aus drei Tönen: heller Rand
oben links, Körperton in der Mitte, dunkler Rand unten rechts. Genau so macht es
das Original. Eine frühere Fassung hatte einen schwarzen Umriss, und die zeigte
aus der Ferne nur noch schwarze Querbänder statt einer Figur.

**Echte Frame-Animation.** Ein Bild besteht aus Körper plus Überlagerungen für
Gesicht, Arme und Beine, dazu ein Versatz in ganzen Pixeln. Daraus ergeben sich
viele Bewegungen aus wenig Daten: Atmen, Wippen, Schritte, Wackeln, Hüpfen,
Blinken, Umschauen, Winken. Keine CSS-Kurven, keine Skalierung.

**Die Größe hat einen Grund.** Bei 20 Pixeln Breite passt eine Brille nicht
neben das Auge, Fassung und Pupille landen auf demselben Pixel und das Gesicht
wird ein schwarzer Klotz. Bei 28 Pixeln bleibt Luft.

| Zustand | Clawd | Rechner |
| --- | --- | --- |
| schläft | eingerollt, Augen zu, Brille ab, Zzz steigt auf | aus |
| wartet | blinkt, schaut sich um, winkt gelegentlich | Standby, ein Punkt |
| arbeitet | Brille auf, wippt, macht Schritte | Codezeilen laufen durch |
| sprintet | große Augen, rennt, Schweißtropfen, Tempolinien | Bildschirm voll |
| angestrengt | Brauen runter, wackelt, Farbe kippt gelb | Warnung gelb, blinkt |
| am Anschlag | flach mit gespreizten Beinen, Brille abgenommen, rot | Alarm rot |
| frisches Fenster | hüpft und jubelt, Konfetti | grüner Haken |

Die Farbe der Figur folgt der Warnstufe, nicht dem Modell. Ein grüner Claude,
nur weil zuletzt Haiku lief, wäre schlicht falsch.

**Fliegende Pixel.** Jede neu erkannte Nachricht löst einen Stoß aus, in vier
Sorten: Würfel, Codestreifen, rotierende Funken und ein Plus aus zwei Balken in
Türkis. Sie starten außerhalb und fliegen zu Clawd, gefärbt nach dem Modell, das
gearbeitet hat. Beim Fensterwechsel gibt es Konfetti.

Wer `prefers-reduced-motion` gesetzt hat, bekommt ein einzelnes Bild und keine
Partikel.

## Aussehen

Drei Schriften mit klaren Aufgaben:

* **Fraunces** für die großen Zahlen. Dieselbe Serif-Stimme, die Anthropic neben
  das Pixelmaskottchen setzt.
* **Instrument Sans** für Beschriftungen und Texte, durchgehend Satzschreibung.
  Das steht so auch in Claudes eigenen Textrichtlinien: nie Title Case, nie
  Versalien.
* die **System-Monospace** für Messwerte, Timer und Tokenzahlen, damit Ziffern
  beim Mitzählen nicht zappeln.

Beide Webfonts liegen in `vendor/` und werden mitgeliefert, es geht keine
Anfrage ins Netz.

Pixel bleibt, wo er etwas kann: Maskottchen, Rechner, Blockbalken,
Verlaufssäulen. Blöcke zählt das Auge schneller als es einen glatten Balken
schätzt.

Farbschema hell auf warmem Papier, dunkel auf fast schwarz. Beim Start nach
Windows-Einstellung, mit `T` umschaltbar und gemerkt.

## Konfiguration

Die Datei `claude-tv.config.json` liegt unter Windows in `%APPDATA%\claude-tv\`.
Sie enthält nur Vorlieben und die gemerkte Kalibrierung, keine Geheimnisse.
`theme` kennt drei Werte: `system`, `light` und `dark`.

Wer die Skala selbst festlegen will, trägt ein eigenes Budget ein:

```json
{
  "budgets": {
    "windowEffort": 15000000,
    "weekEffort": 90000000
  }
}
```

Ist `windowEffort` gesetzt, schlägt es die Selbstkalibrierung, und die Fußzeile
sagt es. `null` heißt: selbst kalibrieren.

Die berechnete Kalibrierung wird festgehalten und nur einmal am Tag erneuert.
Sonst wandert die Skala unter den Füßen, weil jedes neu abgeschlossene Fenster
das p90 verschiebt und dieselbe Nutzung morgens einen anderen Prozentwert
ergäbe als abends.

## Aufbau

```
main.mjs              Fenster, IPC, Lebenszyklus
preload.cjs           die Brücke, gibt genau fünf Funktionen frei
lib/scan.mjs          liest die Logs, inkrementell, mit Watcher und Poll
lib/aggregate.mjs     Verbrauch, Fenster, Tempo, Kalibrierung, Aufschlüsselung,
                      Figurenzustand
lib/plan.mjs          liest den Tarif, genau ein Feld
lib/config.mjs        claude-tv.config.json
lib/demo.mjs          erfundene Daten für jeden Figurenzustand
renderer/             Oberfläche: index.html, app.css, app.js, character.js
dev/serve.mjs         Oberfläche über HTTP, für die Entwicklung
tools/selftest.mjs    Prüfungen
tools/make-icon.mjs   erzeugt build/icon.png, Pixelfigur direkt ins PNG
tools/vendor-fonts.mjs kopiert die Schriften nach vendor/
```

Der Hauptprozess liest und rechnet, der Renderer zeichnet, dazwischen liegt
IPC. Der Renderer sieht kein `fs`, kein `require`, keine Pfade:
`contextIsolation` an, `nodeIntegration` aus, `sandbox` an.

Gelesen wird inkrementell: pro Datei ist gemerkt, bis zu welchem Byte
ausgewertet wurde, beim nächsten Durchgang kommt nur der Zuwachs dran. Eine
angeschnittene letzte Zeile wird gepuffert. Wird eine Datei kleiner, wird sie
komplett neu gelesen. Ein vollständiger Erstdurchlauf über 87 Dateien und 46 MB
dauert rund 200 ms.

`fs.watch` läuft mit, ist aber nur Beschleunigung. Ob ein rekursiver Watcher auf
der jeweiligen Plattform Ereignisse liefert, ist nicht garantiert, deshalb
prüft zusätzlich alle zwei Sekunden ein `stat` über alle Dateien nach.

## Entwickeln

Oberfläche im Browser, mit erfundenen Daten und ohne Electron:

```bash
npm run serve
```

Dann `http://127.0.0.1:8790/` öffnen. Szenarien und Schalter:

* `?demo=working` und ebenso `idle`, `sleeping`, `sprinting`, `strained`,
  `spent`, `fresh`, `uncalibrated`, `empty`
* `&theme=dark`, `&view=detail`
* `&state=spent` erzwingt einen Figurenzustand unabhängig von den Daten
* ohne `?demo=` kommen die echten Daten

Node hält importierte Module im Cache. Nach Änderungen an `lib/` muss der
Dev-Server also neu starten, sonst zeigt er weiter die alten Werte.

Prüfungen:

```bash
npm run selftest
```

Deckt Verbrauchsrechnung, Fenstererkennung, Kalibrierung, Konfiguration und
inkrementelles Lesen ab, samt der Randfälle: kaputte JSON-Zeile, angeschnittene
letzte Zeile, Datei wird kleiner, leeres Verzeichnis, zu wenige Fenster, Text
statt Tokenzahl. Am Ende läuft ein Durchgang über die echten Logs, nur lesend.

## Was gelesen wird und was nicht

Gelesen wird:

* `~/.claude/projects/**/*.jsonl`, die Session-Logs. Nur lesend.
* `~/.claude.json`, daraus **genau ein Feld**:
  `oauthAccount.userRateLimitTier`, für die Tarifanzeige. In derselben Datei
  stehen Adresse, Name und Organisation, die werden nicht angefasst.

Nicht gelesen wird `~/.claude/.credentials.json`, auch nicht teilweise. Dort
liegt der OAuth-Token von Claude Code, mit dem sich theoretisch die echten
Limits abfragen ließen. Er läuft aber ab und wird von Claude Code selbst
erneuert. Ein fremdes Programm müsste diesen Refresh übernehmen und die Datei
zurückschreiben, und ein Fehler dabei zerstört die Anmeldung. Für eine Anzeige
ist das kein vertretbares Risiko.

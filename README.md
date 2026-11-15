# SpeakUp

**Englisch lernen mit Sprache & Stift** – eine kindgerechte, installierbare Web-App für Vokabeln der Klassen 5–6.

Sprechen, hören, mit dem Stift schreiben oder tippen: SpeakUp kombiniert vier Lernmodi mit einem Leitner-Wiederholungssystem, Punkten, Levels, Abzeichen und fünf freischaltbaren Themenwelten. Alles läuft ohne Konto, ohne Werbung und ohne Tracker. Die Lernstände bleiben auf dem Gerät.

> **Motto:** Speak up!

---

## Inhalt

1. [Funktionen](#funktionen)
2. [Schnellstart](#schnellstart)
3. [Projektstruktur](#projektstruktur)
4. [Vokabeln bearbeiten](#vokabeln-bearbeiten)
5. [Neue Themen hinzufügen](#neue-themen-hinzufügen)
6. [Excel & Google Sheets](#excel--google-sheets)
7. [Elternbereich](#elternbereich)
8. [Fortschritt, IDs und Backups](#fortschritt-ids-und-backups)
9. [Installation als App](#installation-als-app)
10. [Hosting](#hosting)
11. [Datenschutz](#datenschutz)
12. [Grenzen und bekannte Einschränkungen](#grenzen-und-bekannte-einschränkungen)
13. [Nächste Schritte](#nächste-schritte)

---

## Funktionen

### Lernen

- **Vier Modi**
  - **Sprechen** – deutsche Vorgabe, englische Antwort ins Mikrofon (Web Speech API, `en-US`).
  - **Hören & Schreiben** – englisches Wort wird vorgelesen, Antwort mit Stift oder Tastatur.
  - **Schreiben** – deutsche Vorgabe, englische Antwort handschriftlich oder getippt.
  - **Mix** – die Modi wechseln innerhalb einer Runde.
- **Zehn Wörter pro Runde.** Falsche Wörter kommen ans Ende der Runde und werden ein zweites Mal geübt.
- **Tolerante Antwortprüfung:** Groß-/Kleinschreibung, Leerzeichen, Satzzeichen, Umlaute und alternative Lösungen werden berücksichtigt. Kleine Tippfehler werden über eine Ähnlichkeitsprüfung erkannt.
- **Leitner-System mit fünf Boxen.** Richtig beantwortete Wörter wandern eine Box weiter, Fehler führen zurück in Box 1. Die Intervalle sind 1, 2, 4, 7 und 14 Tage. Nur der erste Versuch einer Runde verändert die Box.
- **Sprachausgabe** über `SpeechSynthesis` mit englischer Stimme (`en-GB`/`en-US`), wahlweise langsamer.
- **Handschrift** über Pointer Events – Stift, Finger und Maus. Palm Rejection, Undo und Löschen sind eingebaut.
- **Immer ein Fallback:** Ohne Mikrofon, ohne Online-Erlaubnis oder ohne Handschrifterkennung kann jedes Wort getippt werden.

### Motivation

- Maskottchen **Pip** mit wechselnden Sprüchen und Stimmungen.
- Punkte, Levels und Leveltitel, Tagesziel, Tages-Serie und Abzeichen.
- 1–3 Sterne pro Runde, Konfetti und dezente WebAudio-Toneffekte (abschaltbar).
- Themenwelten werden ab bestimmten Punktzahlen freigeschaltet.

### Für Eltern und Lehrkräfte

- **Elternbereich** hinter einer Rechenaufgabe (Hürde für Kinder, keine Sicherheitsmaßnahme).
- Wörter und Themen anlegen, bearbeiten, sortieren und löschen.
- CSV-Import aus Datei, Zwischenablage oder URL – mit Vorschau, Validierung und den Modi **Hinzufügen**, **Zusammenführen** und **Ersetzen**.
- CSV-Export pro Thema, JSON-Backup und Wiederherstellung.
- Statistik pro Wort, Leitner-Boxen, Rundenverlauf, Fortschritt zurücksetzen.
- Standardlisten wiederherstellen, ohne eigene Wörter oder Fortschritte zu verlieren, solange die Wort-IDs gleich bleiben.

### Technik

- Reines **Vanilla JavaScript** mit ES Modules, HTML und CSS. **Kein Build-Schritt, keine Frameworks.**
- **PWA:** Manifest, Service Worker, Offline-Start, installierbar auf Android, iOS und Desktop.
- **Lokale Speicherung** über IndexedDB mit automatischem localStorage-Fallback.
- Mobile-first, Touch- und Stift-freundlich, Tastaturbedienung, ARIA-Auszeichnung, `prefers-reduced-motion`.
- Selbst gehostete Schrift (Nunito), keine externen CDNs.

---

## Schnellstart

Voraussetzungen: ein aktueller Browser (Chrome, Edge oder Safari) und Python 3 **oder** Node.js.

```bash
# im Projektordner
python -m http.server 8000
```

Danach <http://localhost:8000> öffnen.

Alternativ mit Node.js:

```bash
npx serve .
# oder
npx http-server -p 8000
```

> **Wichtig:** Die App darf nicht per Doppelklick über `file://` geöffnet werden. Dann können weder die CSV-Dateien geladen noch der Service Worker registriert werden. Mikrofon und Spracherkennung benötigen außerdem **HTTPS** oder **localhost**.

Beim ersten Start erscheint der Datenschutz-Hinweis. Dort wird erklärt, wann Sprachaufnahmen und Schreibstriche an Online-Dienste gehen. „Nur mit Tippen lernen“ ist eine vollwertige Option.

### Kurzer Testparcours

1. Startseite: Modus **Mix** wählen, Thema **Tiere** öffnen.
2. Eine Runde mit Tippen abschließen (Mikrofon ggf. verweigern).
3. Unter **Fortschritt** Punkte, Boxen und Abzeichen prüfen.
4. **Eltern** öffnen, Rechenaufgabe lösen, ein Wort hinzufügen.
5. Unter **Sichern** ein Backup herunterladen und wieder einlesen.
6. Seite neu laden und prüfen, ob der Fortschritt erhalten bleibt.
7. In den DevTools unter **Application → Service Workers** prüfen, ob der Worker aktiv ist. Danach „Offline“ simulieren und die App neu laden.

---

## Projektstruktur

```text
SpeakUp/
├─ index.html              App-Hülle, SVG-Sprite, Header, Tabbar, Splash
├─ manifest.json           PWA-Manifest (Icons, Shortcuts, Theme)
├─ sw.js                   Service Worker (App-Shell, Daten, Updates)
├─ css/
│  └─ app.css              Designsystem und alle Ansichten
├─ js/
│  ├─ app.js               Startablauf, Router, Kopfzeile, Updates
│  ├─ core/
│  │  ├─ answer.js         Antwortnormalisierung und -prüfung
│  │  ├─ bus.js            kleines Event-Bus-Modul
│  │  ├─ config.js         App-Name, Version, Dateinamen
│  │  ├─ csv.js            CSV-Parser und -Serializer
│  │  ├─ db.js             IndexedDB + localStorage-Fallback
│  │  ├─ handwriting.js    austauschbarer Handschrift-Provider
│  │  ├─ hash.js           stabile Wort-IDs (cyrb53)
│  │  ├─ install.js        PWA-Installationslogik
│  │  ├─ learner.js        Leitner, Punkte, Level, Abzeichen, Profil
│  │  ├─ library.js        Themen/Wörter, Import, Merge, Tombstones
│  │  ├─ speech.js         Web-Speech-Erkennung
│  │  ├─ transfer.js       Import, Export, Backup, Restore
│  │  └─ tts.js            Sprachausgabe
│  ├─ ui/
│  │  ├─ canvas.js         Zeichenfläche (Pointer Events)
│  │  ├─ confetti.js       Konfetti mit Reduced-Motion-Schutz
│  │  ├─ dom.js            DOM-Helfer, Toasts, Modale
│  │  ├─ mascot.js         Maskottchen „Pip“
│  │  └─ sfx.js            WebAudio-Toneffekte
│  └─ views/
│     ├─ about.js          „Über SpeakUp“
│     ├─ home.js           Startseite
│     ├─ onboarding.js     Datenschutz-Hinweis
│     ├─ parent.js         Elternbereich
│     ├─ progress.js       Fortschrittsseite
│     └─ session.js        Lernrunde
├─ data/
│  ├─ index.json           Themenliste und Datenversion
│  ├─ tiere.csv            20 Wörter
│  ├─ schule.csv           20 Wörter
│  ├─ essen.csv            20 Wörter
│  ├─ hobbys.csv           20 Wörter
│  └─ reisen.csv           20 Wörter
├─ assets/
│  ├─ logo.svg
│  ├─ logo-maskable.svg
│  └─ fonts/               selbst gehostete Nunito-Dateien
└─ icons/                  PWA-, Maskable- und Apple-Icons
```

### Architektur in Kürze

- **`js/app.js`** ist der einzige Einstiegspunkt. Es initialisiert Datenbank, Profil und Bibliothek und rendert danach die Route.
- Der **Hash-Router** kennt `#/home`, `#/lernen`, `#/fortschritt`, `#/eltern` und `#/ueber`. Jede Ansicht gibt optional eine Aufräumfunktion zurück; der Router ruft sie vor dem Wechsel auf (wichtig für Mikrofon, Zeichenfläche und Timer).
- **`library.js`** hält Themen und Wörter, mischt Standardlisten ein und schützt eigene Änderungen. Gelöschte Standardwörter und -themen werden als Tombstones gespeichert, damit sie bei einem Update nicht zurückkehren.
- **`learner.js`** hält Profil, Einstellungen, Einwilligung, Fortschritt und Sitzungsverlauf. Der Fortschritt hängt ausschließlich an der stabilen Wort-ID.
- **`transfer.js`** bündelt Import, Export und Backup; die Ansichten enthalten keine Dateiformat-Logik.
- Die Handschrifterkennung ist über `setHandwritingProvider()` austauschbar. Standard ist Google Input Tools.

---

## Vokabeln bearbeiten

Jedes Thema liegt in einer eigenen CSV-Datei unter `data/`. Die Kopfzeile lautet:

```csv
deutsch;englisch;alternativen;beispielsatz;emoji
Hund;dog;;The dog is big.;🐶
Katze;cat;kitty;My cat is black.;🐱
```

| Spalte | Pflicht | Bedeutung |
|---|---|---|
| `deutsch` | ja | Deutsche Vorgabe, die dem Kind angezeigt wird. |
| `englisch` | ja | Erwartete englische Lösung. |
| `alternativen` | nein | Weitere akzeptierte Lösungen, getrennt durch `|`, `,` oder `;` – z. B. `bike | bicycle`. |
| `beispielsatz` | nein | Wird im Feedback angezeigt. Englisch ist empfehlenswert. |
| `emoji` | nein | Kleines Bildzeichen für die Fragekarte. |

**Formatregeln**

- Trennzeichen: Semikolon, Komma oder Tabulator. Semikolon ist die Empfehlung, weil Kommas in Sätzen vorkommen.
- Zeichenkodierung: **UTF-8**.
- Felder mit Semikolon, Komma oder Zeilenumbruch müssen in Anführungszeichen stehen: `"Hallo, Welt"`.
- Eine Kopfzeile ist empfohlen. Fehlt sie, wird die feste Spaltenreihenfolge angenommen und eine Warnung angezeigt.
- Deutsche und englische Kopfzeilennamen werden erkannt (z. B. `deutsch`/`german`/`de`).
- Leere Zeilen werden übersprungen; fehlende Pflichtfelder werden in der Vorschau markiert.

Die mitgelieferten Dateien enthalten jeweils **20 Wörter** zu den Themen:

1. **Tiere** (`tiere`) – frei ab 0 Punkten
2. **Schule** (`schule`) – frei ab 0 Punkten
3. **Essen & Trinken** (`essen`) – ab 60 Punkten
4. **Hobbys & Freizeit** (`hobbys`) – ab 120 Punkten
5. **Reisen** (`reisen`) – ab 200 Punkten

---

## Neue Themen hinzufügen

1. Neue CSV-Datei in `data/` anlegen, z. B. `data/weltraum.csv`.
2. In `data/index.json` einen Eintrag ergänzen:

```json
{
  "id": "weltraum",
  "name": "Weltraum",
  "emoji": "🚀",
  "order": 6,
  "unlockPoints": 280,
  "file": "weltraum.csv"
}
```

3. Die **Datenversion** in `data/index.json` erhöhen, z. B. von `2026.11.1` auf `2026.11.2`. Dadurch erkennen installierte Apps, dass neue Wörter bereitstehen, und zeigen den Update-Hinweis.
4. In `sw.js` die neue CSV in `PRECACHE` aufnehmen und `APP_VERSION` erhöhen, damit der Service Worker die neue Datei vorlädt.
5. Optional in `js/core/config.js` die `DATA_VERSION_FALLBACK` anpassen.

Alternativ lassen sich neue Themen bequem im **Elternbereich → Import** mit „+ Neues Thema anlegen“ erzeugen. Diese Themen liegen nur auf dem Gerät und werden nicht in `data/` gespeichert.

**Hinweis:** `unlockPoints: 0` bedeutet sofort frei. Eigene Themen aus dem Elternbereich sind ebenfalls sofort frei, wenn sie mit 0 Punkten angelegt werden.

---

## Excel & Google Sheets

### Excel

1. Neue Arbeitsmappe mit fünf Spalten anlegen: `deutsch`, `englisch`, `alternativen`, `beispielsatz`, `emoji`.
2. Erste Zeile als Kopfzeile stehen lassen.
3. **Datei → Speichern unter → CSV UTF-8 (durch Trennzeichen getrennt) (\*.csv)** wählen.
4. Excel verwendet je nach Ländereinstellung ein Semikolon oder ein Komma. Beides wird erkannt.
5. Die Datei im Elternbereich unter **Import → Datei** auswählen. Die Vorschau zeigt Zeilen, Fehler und Duplikate, bevor etwas übernommen wird.
6. Alternativ die Datei nach `data/` kopieren und in `data/index.json` eintragen (siehe oben).

> **Tipp:** In Excel die Spalte `englisch` als Text formatieren, damit führende Nullen oder Formeln nicht verändert werden. Emojis funktionieren in aktuellen Excel-Versionen; wenn sie verloren gehen, können sie später im Elternbereich ergänzt werden.

### Google Sheets

1. Tabelle mit denselben fünf Spalten anlegen.
2. **Datei → Herunterladen → Kommagetrennte Werte (.csv)** oder **Semikolongetrennte Werte (.csv)** wählen.
3. Datei herunterladen und im Elternbereich importieren.

Alternativ direkt per URL importieren:

1. In Google Sheets **Datei → Freigeben → Im Web veröffentlichen**.
2. Das gewünschte Blatt als **CSV** veröffentlichen und den Link kopieren.
3. Im Elternbereich unter **Import → URL** einfügen.

Der Server muss den Zugriff per CORS erlauben. Öffentliche Google-Sheets-Exportlinks tun das in der Regel; ein Link auf die normale Bearbeitungsansicht funktioniert nicht. Wenn der Import scheitert, die Datei herunterladen und über **Datei** importieren.

### Import-Modi

| Modus | Verhalten |
|---|---|
| **Hinzufügen** | Nur neue Wörter werden übernommen. Vorhandene deutsche Wörter bleiben unverändert. |
| **Zusammenführen** | Wörter mit gleichem deutschem Wort werden aktualisiert, neue ergänzt. Ändert sich die Wort-ID, wird der Fortschritt migriert. |
| **Ersetzen** | Das Thema wird vollständig durch die Datei ersetzt. Nicht mehr enthaltene Wörter werden gelöscht und ihr Fortschritt entfernt. |

Zeilen mit Fehlern werden übersprungen. Die Vorschau zeigt vor dem Import, wie viele Zeilen gültig, doppelt oder bereits vorhanden sind.

---

## Elternbereich

Der Elternbereich ist über eine zweistellige Multiplikationsaufgabe geschützt. Diese Hürde hält jüngere Kinder fern, ist aber **kein Sicherheitsmechanismus**. Wer die App bedienen kann, kann auch die Browserdaten einsehen.

| Tab | Aufgaben |
|---|---|
| **Wörter** | Thema wählen, suchen, Wörter anlegen/bearbeiten/löschen, nach oben/unten verschieben, A–Z oder Z–A sortieren. |
| **Themen** | Themen anlegen/bearbeiten/löschen, Reihenfolge ändern, Punkte-Sperre setzen, A–Z sortieren, CSV exportieren. |
| **Import** | CSV aus Datei, Einfügen oder URL; Vorschau; Zielthema oder neues Thema; Importmodus. |
| **Sichern** | JSON-Backup erstellen/wiederherstellen, CSV pro Thema exportieren, leere Vorlage laden, Standardlisten wiederherstellen, Fortschritt oder alle Daten löschen. |
| **Fortschritt** | Statistik pro Wort, Sortierung nach Fehlern/Box/Quote, Box-Verteilung, Rundenverlauf, Fortschritt einzelner Wörter löschen. |
| **Einstellungen** | Toneffekte, automatisches Vorlesen, Handschrifterkennung, Vorlese-Geschwindigkeit, Online-Einwilligung, Installation, Speicherbelegung. |

Die Entsperrung gilt für die aktuelle Browser-Sitzung (`sessionStorage`). Beim Schließen des Tabs wird sie zurückgesetzt.

---

## Fortschritt, IDs und Backups

### Stabile Wort-IDs

Jedes Wort erhält eine ID aus einem Hash über **Thema + Deutsch + Englisch**:

```js
makeWordId("tiere", "Hund", "dog");
```

Daraus folgen die Regeln:

- Wird ein Wort nur im Beispielsatz, den Alternativen oder im Emoji geändert, bleibt die ID und damit der Fortschritt erhalten.
- Ändern sich Deutsch, Englisch oder das Thema, entsteht eine neue ID. Beim Bearbeiten im Elternbereich kann der Fortschritt migriert werden (Standard: ja).
- Wird ein Wort gelöscht, verliert nur dieses Wort seinen Fortschritt. Andere Wörter bleiben unberührt.
- Standardlisten werden bei jedem Start mit der gespeicherten Bibliothek abgeglichen. Neue Standardwörter kommen hinzu, geänderte werden aktualisiert, eigene Wörter bleiben erhalten. Gelöschte Standardwörter bleiben über Tombstones gelöscht.
- Wurde ein Standardwort umbenannt, versucht die Bibliothek, es über das gleiche deutsche oder englische Wort wiederzuerkennen, und meldet eine Fortschritts-Migration.

### Backup

**Elternbereich → Sichern → Backup erstellen** lädt `speakup-backup.json` herunter. Die Datei enthält:

- Bibliothek (Themen, Wörter, Tombstones, Datenversion),
- Profil (Punkte, Level-Grundlage, Abzeichen, Serie),
- Einstellungen,
- Fortschritt pro Wort,
- Rundenverlauf.

**Nicht** enthalten ist die Einwilligung zu Mikrofon und Handschrift. Nach dem Wiederherstellen muss sie bewusst neu erteilt werden.

Die Wiederherstellung ersetzt die aktuellen Daten und lädt die App neu. Vorher wird die Anzahl der Themen, Wörter und Fortschrittseinträge angezeigt.

### Zurücksetzen

- **Standardlisten wiederherstellen:** Eigene Wörter/Themen werden verworfen; Fortschritt bleibt bei Wörtern mit gleicher ID.
- **Lernfortschritt zurücksetzen:** Punkte, Level, Abzeichen, Serie und Boxen werden gelöscht; Wörter bleiben.
- **Alle Daten löschen:** löscht Bibliothek, Fortschritt, Einstellungen und Einwilligung. Die App startet wie neu.

---

## Installation als App

Die App muss über **HTTPS** oder **localhost** laufen. Dann:

### Android / Chrome / Edge

- Beim Besuch erscheint ggf. ein Installationshinweis. Alternativ: Browsermenü → **App installieren** bzw. **Zum Startbildschirm hinzufügen**.
- Im Elternbereich unter **Einstellungen → App installieren** steht ebenfalls ein Button, sofern der Browser den Installations-Prompt anbietet.

### iPhone / iPad (Safari)

1. Seite in **Safari** öffnen (nicht in Chrome auf iOS).
2. **Teilen** antippen.
3. **Zum Home-Bildschirm** wählen.
4. **Hinzufügen** bestätigen.

### Desktop (Chrome/Edge)

- In der Adressleiste erscheint ein Installationssymbol, oder im Menü **Apps → Diese Seite als App installieren** wählen.

Nach der Installation startet SpeakUp im Standalone-Modus. Die App-Shell und die Vokabeldaten sind im Service-Worker-Cache. Neue Wörter werden beim nächsten Online-Start nachgeladen; ein Banner weist darauf hin.

### Updates

- Der Service Worker lädt im Hintergrund eine neue App-Version.
- Ist eine neue Fassung bereit, erscheint oben ein Hinweis mit **Neu laden**.
- Bei neuen Vokabeldaten zeigt die App **„Neue Wörter verfügbar“**. Ein Klick lädt die Daten frisch in den Cache und startet die App neu.
- Ein laufendes Update wird nie mitten in einer Lernrunde erzwungen.

---

## Hosting

Die App besteht nur aus statischen Dateien. Jeder Webserver mit HTTPS funktioniert.

### GitHub Pages

1. Repository auf GitHub anlegen und den Inhalt pushen.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Branch `main`, Ordner `/ (root)` wählen.
4. Nach kurzer Zeit ist die App unter `https://<user>.github.io/<repo>/` erreichbar.
5. Da alle Pfade relativ sind, funktioniert die App auch in einem Unterordner. Der Service-Worker-Scope ist automatisch korrekt.

### Netlify / Cloudflare Pages / Vercel

- Projektordner als statische Site veröffentlichen; kein Build-Kommando nötig.
- Publish-Verzeichnis: Projektwurzel (`.`) bzw. der Ordner mit `index.html`.

### Eigener Server

- Dateien in ein HTTPS-fähiges Webverzeichnis kopieren.
- MIME-Typen müssen korrekt sein: `.js` als `text/javascript`, `.json` als `application/json`, `.woff2` als `font/woff2`, `.svg` als `image/svg+xml`.
- `sw.js` sollte nicht lange gecacht werden (`Cache-Control: no-cache`), damit Updates ankommen. Die App-Dateien selbst werden vom Service Worker verwaltet.

### Lokal mit HTTPS testen

Mikrofon und Service Worker funktionieren auf `localhost` ohne Zertifikat. Für Tests auf einem echten Handy im WLAN braucht es HTTPS, z. B. mit `npx local-ssl-proxy` oder einem Tunnel wie Cloudflare Tunnel/ngrok.

---

## Datenschutz

- **Keine Konten, keine Werbung, keine Tracker, keine Analytics.**
- Lernstände, eigene Wörter und Einstellungen bleiben in IndexedDB auf dem Gerät (Fallback: localStorage).
- **Spracherkennung:** Die Web Speech API sendet die Aufnahme an den Erkennungsdienst des Browser-Herstellers (bei Chrome typischerweise Google). SpeakUp speichert keine Audiodaten.
- **Handschrift:** Die Striche werden als Punktdaten an Google Input Tools gesendet. SpeakUp speichert sie nicht.
- **Vorlesen:** `SpeechSynthesis` nutzt die Stimmen des Geräts. Wenn eine lokale englische Stimme vorhanden ist, werden keine Daten gesendet.
- **URL-Import:** Die eingegebene CSV-URL wird direkt vom Browser geladen. Dabei werden keine Daten an Dritte außer dem gewählten Server übertragen.
- Die Einwilligung ist freiwillig. Ohne sie lernt das Kind ausschließlich mit Tippen und Vorlesen.
- Die Einwilligung kann im Elternbereich jederzeit widerrufen werden. Sie ist **nicht** Teil des Backups und muss auf einem neuen Gerät neu erteilt werden.
- Der Elternbereich ist eine pädagogische Hürde, kein Schutz vor technisch versierten Kindern oder Erwachsenen.

---

## Grenzen und bekannte Einschränkungen

- **Web Speech API:** Nicht in jedem Browser verfügbar. Firefox unterstützt sie nicht; Safari/iOS nur eingeschränkt und teils mit Siri-/Diktat-Abhängigkeit. Die App fällt auf Tippen zurück.
- **Mikrofon:** Benötigt eine sichere Umgebung (HTTPS/localhost) und eine Berechtigung. Verweigerte Berechtigungen werden kindgerecht erklärt.
- **Handschrifterkennung:** Google Input Tools ist ein **nicht offiziell dokumentierter** Dienst. Er kann sich ändern, rate-limitieren oder ausfallen. Die Erkennungsqualität ist derzeit nicht zuverlässig – der öffentliche Endpunkt liefert für viele Eingaben keine brauchbaren Wörter. SpeakUp verwirft unbrauchbare Kandidaten, zeigt einen verständlichen Hinweis und bietet sofort das Tippen an. Der Provider ist über `setHandwritingProvider()` austauschbar; für den produktiven Einsatz empfiehlt sich ein eigener oder lokal laufender Erkennungsdienst.
- **Sprachausgabe:** Die Qualität hängt von den installierten Stimmen ab. Fehlt eine englische Stimme, klingt die Aussprache deutsch. Auf iOS muss die Ausgabe teilweise durch eine Nutzergeste freigeschaltet werden.
- **Offline:** Der erste Start muss online erfolgen, damit App-Shell und Vokabeln geladen werden können. Danach funktioniert die App offline. Spracherkennung und Handschrift benötigen weiterhin Internet.
- **Keine Synchronisierung:** Daten liegen nur auf einem Gerät/Browser. Umzug nur über Backup-Datei.
- **CSV:** Kein Import von Bildern oder Audio. Excel kann Emojis oder Sonderzeichen je nach Version verändern; UTF-8 wählen.
- **URL-Import:** Unterliegt CORS. Viele Cloud-Links funktionieren nicht direkt.
- **Elternbereich:** Rechenaufgabe ist kein Sicherheitsmerkmal.
- **Barrierefreiheit:** Viel Wert auf Tastatur, Fokusführung, ARIA und reduzierte Bewegung gelegt, aber nicht vollständig auditierte WCAG-Konformität. Rückmeldungen willkommen.
- **Browser-Speicher:** Im privaten Modus oder bei vollem Speicher kann IndexedDB ausfallen. Die App weicht auf localStorage aus; dieser ist kleiner und kann ebenfalls blockiert sein.
- **Kein automatisches Löschen:** Fortschritt und Verlauf bleiben, bis sie im Elternbereich zurückgesetzt werden.

---

## Nächste Schritte

Ideen für eine spätere Version:

- **Audio-Aufnahmen** eigener Wörter und Beispielsätze (mit Mikrofon aufgenommen).
- **Bildkarten** zusätzlich zu Emojis, inklusive Upload und lokaler Speicherung.
- **Lehrer-Modus** mit mehreren lokalen Profilen auf einem Gerät.
- **Export als Arbeitsblatt** (PDF) mit den Wörtern eines Themas.
- **Weitere Sprachen** als Lernziel (z. B. Französisch), mit austauschbarem Sprachpaket.
- **Subtile Lernstatistik** für Eltern: Zeit pro Tag, häufigste Fehlerarten, Fortschritt über Wochen.
- **Optionales Cloud-Backup** mit Ende-zu-Ende-Verschlüsselung und ausdrücklicher Einwilligung.
- **Automatisierte Tests** für Antwortprüfung, CSV-Parser, Import-Modi und Fortschrittsmigration.
- **Vollständiger Accessibility-Audit** mit Screenreader- und Kontrastprüfung.
- **Eigene Handschrift-Provider** (z. B. lokal mit TensorFlow.js), um die Abhängigkeit von Google zu reduzieren.

---

## Mitmachen

Verbesserungen an Vokabellisten, Fehlermeldungen und Barrierefreiheit sind willkommen. Bitte keine personenbezogenen Daten oder Audioaufnahmen von Kindern in Issues oder Pull Requests veröffentlichen.

**Speak up!**

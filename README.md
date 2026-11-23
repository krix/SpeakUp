# SpeakUp

**Englisch lernen mit Sprache & Stift** – eine kindgerechte, installierbare Web-App für Vokabeln der Klassen 5–6.

Sprechen, hören, mit dem Stift schreiben oder tippen: SpeakUp kombiniert vier Lernmodi mit einem Leitner-Wiederholungssystem, Punkten, Levels, Abzeichen und fünf freischaltbaren Themenwelten. Alles läuft ohne SpeakUp-Konto, ohne Werbung und ohne Tracker. Mehrere Personen können sich getrennte Profile anlegen; die Lernstände bleiben standardmäßig auf dem Gerät und können optional in den eigenen Google Drive gesichert werden.

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
8. [Profile und Google Drive](#profile-und-google-drive)
9. [Fortschritt, IDs und Backups](#fortschritt-ids-und-backups)
10. [Installation als App](#installation-als-app)
11. [Hosting](#hosting)
12. [Handschrifterkennung: Anbieter einrichten](#handschrifterkennung-anbieter-einrichten)
13. [Datenschutz](#datenschutz)
14. [Grenzen und bekannte Einschränkungen](#grenzen-und-bekannte-einschränkungen)
15. [Nächste Schritte](#nächste-schritte)

---

## Funktionen

### Lernen

- **Vier Modi**
  - **Sprechen** – deutsche Vorgabe, englische Antwort ins Mikrofon. Standard: Browser-Spracherkennung (Web Speech API, `en-US`). Optional als Alternative: **Google Gemini** (Audio wird lokal aufgenommen und nach dem Stoppen einmalig zur Erkennung gesendet, kein Live-Zwischenergebnis).
  - **Hören & Schreiben** – englisches Wort wird vorgelesen, Antwort mit Stift oder Tastatur.
  - **Schreiben** – deutsche Vorgabe, englische Antwort handschriftlich oder getippt.
  - **Mix** – die Modi wechseln innerhalb einer Runde.
- **Zehn Wörter pro Runde.** Falsche Wörter kommen ans Ende der Runde und werden ein zweites Mal geübt.
- **Tolerante Antwortprüfung:** Groß-/Kleinschreibung, Leerzeichen, Satzzeichen, Umlaute und alternative Lösungen werden berücksichtigt. Kleine Tippfehler werden über eine Ähnlichkeitsprüfung erkannt.
- **Erkennungsfehler korrigieren:** Wurde ein gesprochenes oder geschriebenes Wort nur teilweise richtig erkannt, bietet die Rückmeldung **„Dennoch als richtig werten“** an. Der falsche Versuch wird dabei vollständig zurückgenommen – Punkte, Serie und Leitner-Box werden so korrigiert, als wäre die Antwort von Anfang an richtig gewesen. Beim Tippen gibt es diese Option nicht.
- **Leitner-System mit fünf Boxen.** Richtig beantwortete Wörter wandern eine Box weiter, Fehler führen zurück in Box 1. Die Intervalle sind 1, 2, 4, 7 und 14 Tage. Nur der erste Versuch einer Runde verändert die Box.
- **Sprachausgabe** über `SpeechSynthesis` mit englischer Stimme (`en-GB`/`en-US`), wahlweise langsamer.
- **Handschrift** über Pointer Events – Stift, Finger und Maus. Palm Rejection, Undo und Löschen sind eingebaut. Die Erkennung ist austauschbar: Google Input Tools (Standard, ohne Einrichtung), Google Cloud Vision oder Gemini (eigener API-Schlüssel im Elternbereich).
- **Immer ein Fallback:** Ohne Mikrofon, ohne Online-Erlaubnis oder ohne Handschrifterkennung kann jedes Wort getippt werden.

### Motivation

- Maskottchen **Pip** mit wechselnden Sprüchen und Stimmungen.
- Punkte, Levels und Leveltitel, Tagesziel, Tages-Serie und Abzeichen.
- **Punkt-Meilensteine** bei 100, 250, 500, 1000 und 2000 Punkten mit einmaliger Feier (Konfetti, Spruch, Sound) und dauerhaftem Eintrag im Profil.
- **Tagesziel-Bonus:** Wer 50 Punkte an einem Tag schafft, bekommt eine eigene Feier und das Abzeichen „Tagesziel!“.
- **Themen-Medaillen:** 🥉 ab 50 %, 🥈 ab 75 %, 🏆 bei 100 % eines Themas – sichtbar auf Startseite und Fortschrittsseite.
- **Glücksrad nach der Runde:** Eine kleine Überraschung (Bonuspunkte oder ein Pip-Spruch), die schon beim Speichern der Runde berücksichtigt wird.
- 1–3 Sterne pro Runde, Konfetti und dezente WebAudio-Toneffekte (abschaltbar).
- Themenwelten werden ab bestimmten Punktzahlen freigeschaltet.

### Für Eltern und Lehrkräfte

- **Mehrere Profile:** Jede Person hat eine eigene Vokabelliste, eigene Punkte und einen eigenen Lernstand. Der Wechsel oben in der Kopfzeile sichert automatisch den aktuellen Stand.
- **Optionaler Google-Drive-Sync:** Alle Profile werden manuell als eine JSON-Datei im versteckten App-Ordner des eigenen Google-Kontos gesichert oder geladen. Dafür wird nur eine selbst erstellte OAuth-Client-ID im Elternbereich eingetragen.
- **Elternbereich** hinter einer Rechenaufgabe (Hürde für Kinder, keine Sicherheitsmaßnahme).
- Wörter und Themen anlegen, bearbeiten, sortieren und löschen.
- CSV-Import aus Datei, Zwischenablage oder URL – mit Vorschau, Validierung und den Modi **Hinzufügen**, **Zusammenführen** und **Ersetzen**.
- **Foto-Import:** Vokabelliste fotografieren, erkannte Paare prüfen, einzelne Zeilen abwählen und importieren.
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

1. Startseite: Modus **Mix** wählen, Thema **Schule** öffnen.
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
│  │  ├─ drive.js          optionale Google-Drive-Synchronisierung
│  │  ├─ handwriting.js    austauschbarer Handschrift-Provider
│  │  ├─ handwriting-cloud.js  Cloud-Anbieter (Vision, Gemini)
│  │  ├─ hash.js           stabile Wort-IDs (cyrb53)
│  │  ├─ install.js        PWA-Installationslogik
│  │  ├─ learner.js        Leitner, Punkte, Level, Abzeichen, Profil
│  │  ├─ library.js        Themen/Wörter, Import, Merge, Tombstones
│  │  ├─ photo-import.js   Foto → OCR → Vokabelvorschläge
│  │  ├─ profiles.js       mehrere Benutzerprofile mit eigenen Daten
│  │  ├─ secrets.js        lokale API-Schlüssel (nie im Backup)
│  │  ├─ speech.js         Web-Speech-Erkennung (Browser)
│  │  ├─ speech-cloud.js   Spracheingabe über Gemini (Audio → Transkript)
│  │  ├─ transfer.js       Import, Export, Backup, Restore
│  │  └─ tts.js            Sprachausgabe
│  ├─ ui/
│  │  ├─ canvas.js         Zeichenfläche (Pointer Events)
│  │  ├─ confetti.js       Konfetti mit Reduced-Motion-Schutz
│  │  ├─ dom.js            DOM-Helfer, Toasts, Modale
│  │  ├─ mascot.js         Maskottchen „Pip“
│  │  ├─ profile-switcher.js  Profil-Dialog und -Formulare
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
│  ├─ schule.csv           20 Wörter
│  ├─ zuhause.csv          20 Wörter
│  ├─ zahlen.csv           28 Wörter
│  └─ farben.csv           11 Wörter
├─ assets/
│  ├─ logo.png             Logo-Vorlage für alle App-Icons
│  └─ fonts/               selbst gehostete Nunito-Dateien
└─ icons/                  PWA-, Maskable-, Apple- und UI-Icons
```

### Architektur in Kürze

- **`js/app.js`** ist der einzige Einstiegspunkt. Es initialisiert Datenbank, Bibliothek und Profile und rendert danach die Route.
- Der **Hash-Router** kennt `#/home`, `#/lernen`, `#/fortschritt`, `#/eltern` und `#/ueber`. Jede Ansicht gibt optional eine Aufräumfunktion zurück; der Router ruft sie vor dem Wechsel auf (wichtig für Mikrofon, Zeichenfläche und Timer).
- **`library.js`** hält Themen und Wörter, mischt Standardlisten ein und schützt eigene Änderungen. Gelöschte Standardwörter und -themen werden als Tombstones gespeichert, damit sie bei einem Update nicht zurückkehren.
- **`learner.js`** hält Profil, Einstellungen, Einwilligung, Fortschritt und Sitzungsverlauf. Der Fortschritt hängt ausschließlich an der stabilen Wort-ID.
- **`profiles.js`** verwaltet mehrere Benutzerprofile. Die aktive Runde nutzt weiterhin die bekannten Speicher-Schlüssel; beim Wechseln wird ein vollständiger Schnappschuss gesichert und der des Zielprofils eingespielt.
- **`drive.js`** spricht die Google-Drive-API direkt aus dem Browser an. Die OAuth-Client-ID liegt lokal, der Access-Token nur im Arbeitsspeicher der Sitzung.
- **`transfer.js`** bündelt Import, Export und Backup; die Ansichten enthalten keine Dateiformat-Logik. Backups enthalten alle Profile, aber weiterhin keine Einwilligung und keine API-Schlüssel.
- Die Spracheingabe ist über die Einstellung `speechProvider` austauschbar: `browser` (Web Speech API, Standard) oder `gemini` (lokale Audio-Aufnahme mit `MediaRecorder`, Transkription über Gemini). Gemini benötigt Internet, Einwilligung und einen API-Schlüssel und liefert erst nach dem Stoppen ein Ergebnis (kein Live-Zwischenergebnis).
- Die Handschrifterkennung ist über `setHandwritingProvider()` austauschbar. Standard ist Google Input Tools; im Elternbereich lassen sich Google Cloud Vision und Gemini als genauere Cloud-Anbieter wählen. Derselbe Gemini-Schlüssel kann für Handschrift, Foto-Import und Spracheingabe verwendet werden (separates Sprach-Modell einstellbar).

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

1. **Schule** (`schule`) – frei ab 0 Punkten
2. **Zu Hause** (`zuhause`) – frei ab 0 Punkten
3. **Zahlen** (`zahlen`) – frei ab 0 Punkten
4. **Farben** (`farben`) – frei ab 0 Punkten

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

### Foto einer Vokabelliste importieren

1. Im Elternbereich **Import → Foto** wählen.
2. Die Vokabelliste gerade von oben fotografieren oder ein vorhandenes Foto auswählen.
3. SpeakUp verkleinert das Bild im Browser (lange Kante höchstens 1800 px) und liest es über den eingerichteten Dienst.
4. Die erkannten Paare erscheinen als Vorschläge in der Vorschau. Jede Zeile hat ein Häkchen; abwählen, was nicht stimmen soll, und die Richtung mit **Richtung tauschen** umdrehen, falls die Liste Englisch–Deutsch steht.
5. Zielthema und Importmodus wählen und **importieren**.

Der Foto-Import nutzt denselben Dienst wie die Handschrifterkennung: Google Cloud Vision (empfohlen, 1.000 Einheiten/Monat kostenlos) oder Gemini. Ist dort nichts eingerichtet, verweist der Bereich auf **Einstellungen**. Das Foto wird nicht dauerhaft gespeichert und nur einmal zum Lesen gesendet. Für beste Ergebnisse: gute Beleuchtung, keine schrägen Seiten, deutsch und englisch in derselben Zeile.

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
| **Import** | CSV aus Datei, Einfügen oder URL; **Foto-Import** mit Vorschlägen und Auswahl; Vorschau; Zielthema oder neues Thema; Importmodus. |
| **Sichern** | Lokales JSON-Backup aller Profile als Alternative zu Google Drive erstellen/wiederherstellen, CSV pro Thema exportieren, leere Vorlage laden, Standardlisten wiederherstellen, Fortschritt oder alle Daten löschen. |
| **Fortschritt** | Statistik pro Wort, Sortierung nach Fehlern/Box/Quote, Box-Verteilung, Rundenverlauf, Fortschritt einzelner Wörter löschen. |
| **Einstellungen** | Benutzerprofile anlegen/umbenennen/löschen, Google-Drive-Client-ID und manuelle Synchronisierung, Toneffekte, automatisches Vorlesen, Handschrift- und Spracheingabe-Anbieter inkl. Gemini-API-Schlüssel/Modelle, Vorlese-Geschwindigkeit, Online-Einwilligung, Installation, Speicherbelegung. |

Die Entsperrung gilt für die aktuelle Browser-Sitzung (`sessionStorage`). Beim Schließen des Tabs wird sie zurückgesetzt.

---

## Profile und Google Drive

### Mehrere Personen auf einem Gerät

Oben in der Kopfzeile zeigt ein Chip das aktive Profil (Emoji + Name). Ein Klick öffnet die Profilübersicht:

- **Neues Profil** anlegen – startet mit den Standardwörtern und einem eigenen Fortschritt.
- **Profil wechseln** – der aktuelle Stand wird vorher automatisch gesichert, danach lädt die App neu.
- **Umbenennen** und **Löschen** – im Dialog und im Elternbereich unter **Einstellungen → Benutzerprofile**. Das letzte Profil kann nicht gelöscht werden.

Zu jedem Profil gehören eine eigene Vokabelliste, Lernstand, Punkte, Sitzungsverlauf und Einstellungen. Die Einwilligung für Online-Funktionen wird ebenfalls pro Profil gespeichert und bleibt lokal. API-Schlüssel und die Google-Client-ID sind geräteweit und werden **nie** in ein Backup oder in die Cloud geschrieben.

### Google Drive einrichten (optional)

SpeakUp bringt keinen eigenen Account mit. Wer die Profile zwischen Geräten synchronisieren möchte, nutzt das eigene Google-Konto:

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen und die **Google Drive API** aktivieren.
2. Unter **API & Dienste → Anmeldedaten** eine **OAuth-Client-ID vom Typ „Webanwendung“** erstellen.
3. Bei **Autorisierte JavaScript-Ursprünge** genau die Adresse eintragen, unter der SpeakUp läuft – zum Beispiel `http://localhost:8000`. Protokoll, Hostname und Port müssen übereinstimmen; auch installierte PWAs laufen unter diesem Ursprung.
4. Die Client-ID im Elternbereich unter **Einstellungen → Google Drive** einfügen und speichern.
5. Auf **Verbinden** klicken. Google fragt einmalig nach Konto und Zustimmung für den Zugriff auf den versteckten App-Ordner (`drive.appdata`).

Danach stehen zwei explizite Buttons zur Verfügung:

- **Jetzt sichern** lädt alle Profile als `speakup-cloud.json` in den App-Ordner hoch.
- **Aus Cloud laden** zeigt zuerst Datum und Profilanzahl und fragt nach einer Bestätigung.

Es gibt **keine automatische Synchronisierung**. Der Access-Token lebt nur im Arbeitsspeicher der aktuellen Sitzung; nach einem Neuladen muss erneut verbunden werden. Der letzte Sicherungsstand wird lokal als Status angezeigt.

Beim Laden gilt: Profile mit gleicher ID oder gleichem Namen werden durch die Cloud-Version ersetzt, neue Profile werden ergänzt. Die vorhandene lokale Online-Einwilligung bleibt dabei erhalten. Die Cloud-Datei enthält weder Einwilligungen noch API-Schlüssel oder die Client-ID.

---

## Fortschritt, IDs und Backups

### Stabile Wort-IDs

Jedes Wort erhält eine ID aus einem Hash über **Thema + Deutsch + Englisch**:

```js
makeWordId("schule", "Buch", "book");
```

Daraus folgen die Regeln:

- Wird ein Wort nur im Beispielsatz, den Alternativen oder im Emoji geändert, bleibt die ID und damit der Fortschritt erhalten.
- Ändern sich Deutsch, Englisch oder das Thema, entsteht eine neue ID. Beim Bearbeiten im Elternbereich kann der Fortschritt migriert werden (Standard: ja).
- Wird ein Wort gelöscht, verliert nur dieses Wort seinen Fortschritt. Andere Wörter bleiben unberührt.
- Standardlisten werden bei jedem Start mit der gespeicherten Bibliothek abgeglichen. Neue Standardwörter kommen hinzu, geänderte werden aktualisiert, eigene Wörter bleiben erhalten. Gelöschte Standardwörter bleiben über Tombstones gelöscht.
- Wurde ein Standardwort umbenannt, versucht die Bibliothek, es über das gleiche deutsche oder englische Wort wiederzuerkennen, und meldet eine Fortschritts-Migration.

### Lokales Backup (Alternative zu Google Drive)

**Elternbereich → Sichern → Lokales Backup (ohne Google Drive) → Backup-Datei herunterladen** erzeugt `speakup-backup.json`. Die Datei ist die lokale Alternative zur Cloud-Sicherung: kein Konto, kein Internet, keine Google-API. Sie enthält:

- Bibliothek (alle Themen und Vokabellisten, eigene Wörter, Tombstones, Datenversion),
- Profil (Punkte, Level-Grundlage, Abzeichen, Serie),
- Einstellungen,
- Fortschritt pro Wort,
- Rundenverlauf,
- alle weiteren Profile in `data.profiles` (ohne Einwilligung).

**Nicht** enthalten sind die Einwilligung zu Mikrofon und Handschrift, die optionalen **API-Schlüssel** und die Google-Client-ID. Nach dem Wiederherstellen muss die Einwilligung bewusst neu erteilt und ein Schlüssel auf dem neuen Gerät neu gespeichert werden.

**Elternbereich → Sichern → Lokales Backup wiederherstellen** liest die Datei zurück. Die Wiederherstellung ersetzt die aktuellen Daten und lädt die App neu. Vorher wird die Anzahl der Themen, Wörter und Fortschrittseinträge angezeigt. Wer stattdessen Cloud-Sync nutzen möchte, findet ihn weiterhin unter **Einstellungen → Google Drive**.

### Zurücksetzen

- **Standardlisten wiederherstellen:** Eigene Wörter/Themen werden verworfen; Fortschritt bleibt bei Wörtern mit gleicher ID.
- **Lernfortschritt zurücksetzen:** Punkte, Level, Abzeichen, Serie und Boxen werden gelöscht; Wörter bleiben.
- **Alle Daten löschen:** löscht Bibliothek, Fortschritt, Einstellungen, Einwilligung und gespeicherte API-Schlüssel. Die App startet wie neu.

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

## Handschrifterkennung: Anbieter einrichten

Die Erkennung ist bewusst austauschbar. Im Elternbereich unter **Einstellungen → Handschrift-Erkennung** stehen vier Optionen zur Wahl:

| Anbieter | Einrichtung | Kosten (Stand 2026) | Qualität |
|---|---|---|---|
| **Google Input Tools** | keine | kostenlos, inoffiziell | unzuverlässig |
| **Google Cloud Vision** | Google-Cloud-Projekt + API-Schlüssel | 1.000 Einheiten/Monat gratis | sehr gut bei Handschrift |
| **Google Gemini (KI)** | API-Schlüssel aus AI Studio | Free Tier mit Tageslimits | gut, kann sich verlesen |
| **Aus** | keine | – | nur Tippen |

### Google Cloud Vision (Empfehlung)

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen (oder ein vorhandenes wählen).
2. Die [Cloud Vision API](https://console.cloud.google.com/apis/library/vision.googleapis.com) aktivieren.
3. Unter **APIs & Dienste → Anmeldedaten** einen **API-Schlüssel** erstellen.
4. Den Schlüssel einschränken:
   - **API-Einschränkung:** nur „Cloud Vision API“
   - **HTTP-Referrer:** die Adresse, unter der SpeakUp läuft (z. B. `https://deine-seite.example/*`), plus `http://localhost:8000/*` für Tests
5. Den Schlüssel im Elternbereich einfügen, **speichern** und **Verbindung testen** wählen.

**Kosten:** Die erste 1.000 Einheiten pro Monat ist kostenlos; jede weitere wird abgerechnet. Ohne hinterlegtes Abrechnungskonto schlägt die Anfrage nach Erreichen des Kontingents fehl – die App fällt dann auf Tippen zurück. Details: [Vision-Preise](https://cloud.google.com/vision/pricing), [Kontingente](https://cloud.google.com/vision/quotas).

**Was übertragen wird:** SpeakUp rendert die Striche als PNG (schwarze Schrift auf weißem Grund, zugeschnitten, mit Rand) und sendet nur dieses Bild mit `languageHints: ["en"]`. Keine Roh-Striche, keine Zeitstempel, keine Namen. Das Bild wird von SpeakUp nicht gespeichert.

### Google Gemini (KI, kostenloses Kontingent)

1. In [Google AI Studio](https://aistudio.google.com/app/apikey) einen API-Schlüssel erstellen.
2. Schlüssel im Elternbereich speichern. Das Modell ist standardmäßig `gemini-3.5-flash-lite` und kann dort geändert werden (es muss Bilder verstehen).
3. **Verbindung testen** prüft Schlüssel und Modellverfügbarkeit, ohne ein Bild zu senden.

**Wichtig:** Im kostenlosen Tarif darf Google die eingesendeten Inhalte zum Verbessern der Produkte verwenden. Hier sind das nur einzelne Vokabel-Bilder, aber es ist ein anderer Datenfluss als bei einem bezahlten Konto. Ein KI-Modell kann außerdem Wörter „erfinden“; SpeakUp prüft die Antwort deshalb weiterhin gegen die Vokabelliste und zeigt bei Nichtübereinstimmung einen Hinweis. Free-Tier-Limits: [Gemini-Rate-Limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Preise](https://ai.google.dev/gemini-api/docs/pricing).

### Google Input Tools (Standard, ohne Einrichtung)

Der bisherige Standard ist ein öffentlicher, **nicht offiziell dokumentierter** Endpunkt. In Tests lieferte er für realistische Druckbuchstaben oft nur Symbole oder gar keine brauchbaren Wörter. Er bleibt als einrichtungsfreie Option erhalten, ist aber für den Lernalltag nicht empfehlenswert.

### Ohne Cloud

Handschrift im Elternbereich auf **Aus** stellen: Kinder tippen dann. Für einen späteren Ausbau ist ein lokales Modell (z. B. TrOCR mit Transformers.js) denkbar – es braucht aber rund 67 MB Download und ist auf schwachen Geräten langsam. Deshalb ist es noch nicht eingebaut.

### API-Schlüssel: was Sie wissen sollten

- Schlüssel liegen **getrennt von den Einstellungen** in IndexedDB/localStorage und sind **nie Teil eines Backups** oder eines CSV-Exports.
- Ein Schlüssel in einer reinen Browser-App ist für jeden lesbar, der Zugriff auf das Gerät hat. Für den Familiengebrauch ist das vertretbar; für eine öffentliche Installation mit vielen Kindern sollte ein eigener Proxy dazwischen.
- Beim Anbieter einschränken: nur die jeweilige API und möglichst den HTTP-Referrer.
- **Entfernen** löscht den Schlüssel sofort; die Erkennung fällt auf Tippen zurück.

## Spracheingabe: Anbieter einrichten

Die Spracheingabe ist im Elternbereich unter **Einstellungen → Spracheingabe** wählbar:

| Anbieter | Einrichtung | Verhalten |
|---|---|---|
| **Browser-Spracherkennung (Standard)** | keine, Browser-Unterstützung nötig | Live-Erkennung über die Web Speech API; Aufnahme geht an den Dienst des Browser-Herstellers. |
| **Google Gemini (Audio → KI, online)** | Gemini-API-Schlüssel (kann mit Handschrift/Foto geteilt werden), Modell einstellbar | Sprache wird lokal aufgenommen; nach dem Stoppen wird die Audiodatei einmalig an Gemini zur Transkription gesendet. Kein Live-Zwischenergebnis, benötigt Internet und Einwilligung. |

- Der Gemini-Schlüssel liegt nur lokal und getrennt vom Backup (wie bei der Handschrift). Im kostenlosen Gemini-Tarif dürfen Eingaben zum Produkttraining verwendet werden.
- Der Verbindungstest prüft den Gemini-Schlüssel/Modellzugang. Für die reine Audio-Erkennung muss das gewählte Modell Audio-Eingaben verstehen.
- Ohne passende Unterstützung, ohne Internet/Einwilligung oder bei Fehlern kann jederzeit getippt werden.

---

## Datenschutz

- **Keine SpeakUp-Konten, keine Werbung, keine Tracker, keine Analytics.**
- Lernstände, eigene Wörter, Profile und Einstellungen bleiben in IndexedDB auf dem Gerät (Fallback: localStorage). Optional können Eltern alle Profile manuell in den eigenen Google-Drive-App-Ordner sichern; ohne diese Einrichtung verlässt nichts die App.
- **Spracherkennung (Standard):** Die Web Speech API sendet die Aufnahme an den Erkennungsdienst des Browser-Herstellers (bei Chrome typischerweise Google). **Alternative Gemini:** Die Sprache wird lokal aufgenommen und nach dem Stoppen einmalig an Google Gemini zur Transkription gesendet (kein Live-Zwischenergebnis), benötigt einen eigenen API-Schlüssel. Im kostenlosen Gemini-Tarif dürfen Eingaben zum Produkttraining verwendet werden. SpeakUp speichert keine Audiodaten.
- **Handschrift:** Die Striche werden lokal als PNG gerendert und an den im Elternbereich gewählten Dienst gesendet (Standard: Google Input Tools; optional Google Cloud Vision oder Gemini). SpeakUp speichert das Bild nicht. Ohne Einwilligung oder bei „Aus“ wird nichts gesendet.
- **Foto-Import:** Das Foto wird im Browser verkleinert und einmalig an Google Cloud Vision oder Gemini gesendet. Es wird weder in der App noch im Backup gespeichert. Die Vorschläge bleiben nur im Arbeitsspeicher, bis der Elternbereich verlassen oder der Import verworfen wird. Bei Gemini im kostenlosen Tarif darf Google die eingesendeten Bilder zum Produkttraining verwenden.
- **Vorlesen:** `SpeechSynthesis` nutzt die Stimmen des Geräts. Wenn eine lokale englische Stimme vorhanden ist, werden keine Daten gesendet.
- **URL-Import:** Die eingegebene CSV-URL wird direkt vom Browser geladen. Dabei werden keine Daten an Dritte außer dem gewählten Server übertragen.
- **Google Drive (optional):** Es wird nur auf Knopfdruck eine JSON-Datei im versteckten App-Ordner (`drive.appdata`) des eigenen Google-Kontos gelesen oder geschrieben. Sie enthält keine Einwilligungen, API-Schlüssel oder Client-ID. Der Access-Token bleibt im Arbeitsspeicher und wird nicht gespeichert; nach einem Neuladen ist eine neue Zustimmung nötig.
- Die Einwilligung ist freiwillig. Ohne sie lernt das Kind ausschließlich mit Tippen und Vorlesen.
- Die Einwilligung kann im Elternbereich jederzeit widerrufen werden. Sie ist **nicht** Teil des Backups und muss auf einem neuen Gerät neu erteilt werden.
- Der Elternbereich ist eine pädagogische Hürde, kein Schutz vor technisch versierten Kindern oder Erwachsenen.

---

## Grenzen und bekannte Einschränkungen

- **Web Speech API:** Nicht in jedem Browser verfügbar. Firefox unterstützt sie nicht; Safari/iOS nur eingeschränkt und teils mit Siri-/Diktat-Abhängigkeit. Als Alternative kann im Elternbereich die Spracheingabe über Gemini gewählt werden (lokale Audio-Aufnahme, Transkription nach dem Stoppen, eigener API-Schlüssel, kein Live-Zwischenergebnis). Sonst fällt die App auf Tippen zurück.
- **Mikrofon:** Benötigt eine sichere Umgebung (HTTPS/localhost) und eine Berechtigung. Beim Klick holt SpeakUp die Berechtigung (kurzer Probezugriff) und startet dann die gewählte Erkennung. Bei der Browser-Spracherkennung wartet SpeakUp auf das `start`-Event; erst dann erscheint „Ich höre zu“. Bei Gemini wird lokal aufgenommen und erst nach dem Stoppen transkribiert (kein Live-Zwischenergebnis). Wurde das Mikrofon früher abgelehnt, muss es in den Browser-Einstellungen erlaubt und die Seite neu geladen werden. Verweigerte Berechtigungen werden kindgerecht erklärt.
- **Handschrifterkennung:** Google Input Tools ist ein **nicht offiziell dokumentierter** Dienst. Er kann sich ändern, rate-limitieren oder ausfallen; der öffentliche Endpunkt liefert für viele Eingaben keine brauchbaren Wörter. Deshalb gibt es im Elternbereich zwei optionalen Cloud-Anbieter: **Google Cloud Vision** (1.000 Einheiten/Monat kostenlos, sehr genaue Handschrift-OCR) und **Gemini** (KI mit kostenlosem Kontingent, kann sich verlesen). Beide brauchen einen eigenen API-Schlüssel und Internet. SpeakUp verwirft unbrauchbare Kandidaten, zeigt einen verständlichen Hinweis und bietet sofort das Tippen an. Bei kleinen Erkennungsfehlern kann die Antwort außerdem manuell als richtig gewertet werden; der vorherige falsche Versuch wird dabei zurückgenommen. Der Provider ist über `setHandwritingProvider()` austauschbar; ein lokales Modell ist als Ausbau geplant.
- **Sprachausgabe:** Die Qualität hängt von den installierten Stimmen ab. Fehlt eine englische Stimme, klingt die Aussprache deutsch. Auf iOS muss die Ausgabe teilweise durch eine Nutzergeste freigeschaltet werden.
- **Offline:** Der erste Start muss online erfolgen, damit App-Shell und Vokabeln geladen werden können. Danach funktioniert die App offline. Spracherkennung (Browser und Gemini) und Handschrift benötigen weiterhin Internet.
- **Manuelle Drive-Synchronisierung:** Daten liegen standardmäßig nur auf einem Gerät/Browser. Die optionale Google-Drive-Sicherung braucht eine selbst erstellte OAuth-Client-ID, funktioniert nur auf Knopfdruck und speichert den Token nicht dauerhaft. Bei gleicher Profil-ID oder gleichem Namen gewinnt beim Laden die Cloud-Version; weitere Geräte werden nicht automatisch abgeglichen.
- **CSV:** Kein Import von Audio. Excel kann Emojis oder Sonderzeichen je nach Version verändern; UTF-8 wählen.
- **Foto-Import:** Braucht Internet und einen eingerichteten Cloud-Schlüssel. Handschriftliche Listen und schräge Fotos werden schlechter erkannt als gedruckte, gerade Seiten. Erkannte Paare sind Vorschläge und müssen vor dem Import geprüft werden; die App übersetzt oder ergänzt keine fehlenden Wörter.
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
- **Lehrer-Dashboard** mit einer Übersicht über mehrere Profile auf einem Gerät.
- **Export als Arbeitsblatt** (PDF) mit den Wörtern eines Themas.
- **Weitere Sprachen** als Lernziel (z. B. Französisch), mit austauschbarem Sprachpaket.
- **Subtile Lernstatistik** für Eltern: Zeit pro Tag, häufigste Fehlerarten, Fortschritt über Wochen.
- **Ende-zu-Ende-Verschlüsselung** für die Google-Drive-Datei, damit auch der Anbieter die Vokabellisten nicht lesen kann.
- **Automatisierte Tests** für Antwortprüfung, CSV-Parser, Import-Modi und Fortschrittsmigration.
- **Vollständiger Accessibility-Audit** mit Screenreader- und Kontrastprüfung.
- **Eigene Handschrift-Provider** (z. B. lokal mit Transformers.js/TrOCR) einbauen, um die Abhängigkeit von Google zu reduzieren. Das quantisierte Modell ist ca. 67 MB groß und derzeit für schwache Geräte zu schwer.

---

## Mitmachen

Verbesserungen an Vokabellisten, Fehlermeldungen und Barrierefreiheit sind willkommen. Bitte keine personenbezogenen Daten oder Audioaufnahmen von Kindern in Issues oder Pull Requests veröffentlichen.

**Speak up!**

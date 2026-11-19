/**
 * "Über SpeakUp": Branding, Funktionsweise, Datenschutz, Installation und
 * Grenzen der App – in kindgerechter Sprache, mit Details für Erwachsene.
 */
import * as library from "../core/library.js";
import * as learner from "../core/learner.js";
import { APP_NAME, APP_SUBTITLE, APP_VERSION } from "../core/config.js";
import { icon, esc, plural } from "../ui/dom.js";
import { mascot } from "../ui/mascot.js";
import { unlockTts, speak } from "../core/tts.js";
import { installHint, isStandalone, canInstall, promptInstall } from "../core/install.js";
import { showToast } from "../ui/dom.js";

export function renderAbout(main) {
  const lib = library.getLibrary();
  const settings = learner.getSettings();
  const consent = learner.getConsent();
  const stand = isStandalone();

  main.innerHTML = `
    <div class="stack-lg about-page">
      <section class="about-hero" aria-labelledby="about-title">
        <div class="about-logo-wrap">
          <img src="icons/icon-512.png" alt="SpeakUp Logo: Sprechblase mit Stift" width="128" height="128" class="about-logo">
        </div>
        <div class="about-hero-copy">
          <span class="hero-kicker">${icon("star")} Speak up!</span>
          <h1 id="about-title">${esc(APP_NAME)}</h1>
          <p class="about-sub">${esc(APP_SUBTITLE)}</p>
          <p class="about-lead">
            Vokabeln lernen wie im echten Gespräch: laut sprechen, zuhören,
            mit dem Stift schreiben – und dabei Punkte, Sterne und neue
            Themenwelten sammeln.
          </p>
          <div class="hero-stats">
            <span class="stat-pill">${icon("mic")} Sprache</span>
            <span class="stat-pill">${icon("pencil")} Stift</span>
            <span class="stat-pill">${icon("lock")} Ohne SpeakUp-Konto</span>
          </div>
        </div>
        <div class="about-hero-mascot">${mascot("cheer", { size: 140 })}</div>
      </section>

      <section aria-labelledby="how-title">
        <div class="section-head">
          <h2 id="how-title">So funktioniert's</h2>
          <p>Jede Runde dauert nur wenige Minuten.</p>
        </div>
        <div class="about-grid">
          <div class="panel about-step">
            <span class="about-step-number">1</span>
            <h3>${icon("menu")} Thema &amp; Modus wählen</h3>
            <p>Fünf Welten von Tieren bis Reisen. Übe nur Sprechen, nur Hören,
            nur Schreiben – oder alles im Mix.</p>
          </div>
          <div class="panel about-step">
            <span class="about-step-number">2</span>
            <h3>${icon("mic")} Antwort geben</h3>
            <p>Sprich ins Mikrofon, schreibe mit Stift oder Finger auf die
            Fläche – oder tippe die Antwort. Du entscheidest.</p>
          </div>
          <div class="panel about-step">
            <span class="about-step-number">3</span>
            <h3>${icon("refresh")} Wiederholen &amp; sammeln</h3>
            <p>Richtige Wörter wandern in höhere Boxen und kommen später wieder.
            Fehler tauchen in derselben Runde noch einmal auf. Punkte,
            Meilensteine, Medaillen und ein Glücksrad feiern deine Fortschritte.</p>
          </div>
        </div>
      </section>

      <section class="panel" aria-labelledby="privacy-title">
        <div class="panel-head">
          <div>
            <h2 id="privacy-title">${icon("lock")} Datenschutz in einfachen Worten</h2>
            <p>Was bleibt auf dem Gerät – und was geht ins Internet?</p>
          </div>
        </div>
        <div class="about-facts">
          <div class="about-fact green">
            <span class="about-fact-icon">${icon("check")}</span>
            <div>
              <strong>Bleibt bei dir</strong>
              <p>Punkte, Level, Abzeichen, Wiederholungs-Boxen, eigene Wörter und
              Einstellungen liegen normalerweise nur auf diesem Gerät. Es gibt
              kein SpeakUp-Konto, keine Werbung, keine Tracker und keine Analytics.
              Optional können Eltern alle Profile in ihrem eigenen Google Drive
              sichern – nur auf Knopfdruck.</p>
            </div>
          </div>
          <div class="about-fact">
            <span class="about-fact-icon">${icon("mic")}</span>
            <div>
              <strong>Nur mit deiner Erlaubnis online</strong>
              <p>Für Sprache nutzt ${esc(APP_NAME)} standardmäßig die Browser-Spracherkennung
              (Aufnahme geht an den Dienst des Browser-Herstellers, z. B. Google bei Chrome).
              Alternativ können Eltern im Elternbereich <strong>Google Gemini</strong> für die
              Spracheingabe wählen: dann wird die Aufnahme lokal aufgezeichnet und nach dem
              Stoppen einmalig an Gemini zur Erkennung gesendet (kein Live-Zwischenergebnis).
              Schreibstriche werden als Bild an den eingestellten Dienst geschickt
              (Standard: Google Input Tools, optional Google Cloud Vision oder Gemini).
              Ein Foto für den Vokabel-Import wird nur zum Lesen gesendet und nicht gespeichert.
              ${esc(APP_NAME)} speichert nichts davon dauerhaft. Ohne Erlaubnis lernst du mit Tippen.</p>
            </div>
          </div>
          <div class="about-fact">
            <span class="about-fact-icon">${icon("speaker")}</span>
            <div>
              <strong>Vorlesen ohne Internet</strong>
              <p>Die englische Aussprache kommt aus der Stimme, die auf deinem
              Gerät installiert ist. Dafür werden keine Daten gesendet – die
              Stimme klingt je nach Gerät etwas anders.</p>
            </div>
          </div>
        </div>
        <p class="small muted mb-0 mt-2">
          Aktueller Stand:
          <strong>${consent?.allowOnline ? "Online-Funktionen erlaubt" : "Online-Funktionen aus"}</strong>.
          Ändern kannst du das im Elternbereich unter „Einstellungen“.
        </p>
      </section>

      <section aria-labelledby="install-title">
        <div class="section-head">
          <h2 id="install-title">${icon("download")} Als App installieren</h2>
          <p>${stand ? "SpeakUp läuft bereits als App." : "Funktioniert auf Handy, Tablet und Computer."}</p>
        </div>
        <div class="panel">
          <p>${esc(installHint())}</p>
          <div class="btn-row">
            ${
              canInstall()
                ? `<button type="button" class="btn btn-small" data-action="install">${icon("download")} App installieren</button>`
                : ""
            }
            <a class="btn btn-ghost btn-small" href="#/home">${icon("home")} Zur Startseite</a>
          </div>
          <p class="tiny muted mb-0 mt-2">
            Nach der Installation startet ${esc(APP_NAME)} auch ohne Internet.
            Neue Wörter werden beim nächsten Online-Start nachgeladen.
          </p>
        </div>
      </section>

      <section aria-labelledby="faq-title">
        <div class="section-head">
          <h2 id="faq-title">Häufige Fragen &amp; Grenzen</h2>
        </div>
        <div class="faq-list">
          <details class="faq-item">
            <summary>Das Mikrofon funktioniert nicht.</summary>
            <p>Die Browser-Spracherkennung braucht eine sichere Verbindung (HTTPS oder
            <code>localhost</code>) und einen Browser, der die Web Speech API
            unterstützt – zum Beispiel Chrome, Edge oder Safari. Firefox kann
            es nicht. Auf dem iPhone ist die Erkennung eingeschränkt und
            braucht Siri bzw. Diktat. SpeakUp holt beim Klick auf das Mikrofon
            zuerst die Berechtigung und wartet auf das „start“-Signal – sprich
            erst, wenn „Ich höre zu“ erscheint. Wurde die Berechtigung früher
            abgelehnt, erlaube das Mikrofon in den Browser-Einstellungen und
            lade die Seite neu. Als Alternative können Eltern im Elternbereich
            die Spracheingabe über <strong>Gemini</strong> einstellen (Audio-Aufnahme,
            Erkennung nach dem Stoppen, eigener API-Schlüssel nötig). In allen Fällen
            kannst du tippen.</p>
          </details>
          <details class="faq-item">
            <summary>Meine Handschrift wird nicht erkannt.</summary>
            <p>Standardmäßig nutzt die Erkennung den nicht offiziell dokumentierten
            Dienst Google Input Tools. Er kann ausfallen, und die
            Erkennungsqualität ist nicht zuverlässig. Eltern können im
            Elternbereich <strong>Google Cloud Vision</strong> (1.000 Bilder pro
            Monat kostenlos, sehr genaue Handschrift-OCR) oder
            <strong>Gemini</strong> (KI mit kostenlosem Kontingent) mit einem
            eigenen API-Schlüssel einrichten. Ohne Schlüssel oder bei einem
            Fehler zeigt SpeakUp einen Hinweis und bietet sofort das Tippen an.
            Schreibe in Druckbuchstaben und prüfe, ob Online-Funktionen erlaubt
            sind. Zum Üben ist Tippen der zuverlässigste Weg.</p>
          </details>
          <details class="faq-item">
            <summary>Die Erkennung hat mein Wort falsch verstanden.</summary>
            <p>Bei Sprache und Handschrift kann die Erkennung kleine Fehler machen –
            zum Beispiel ein zusätzliches Komma oder einen Buchstabendreher.
            Wenn deine Antwort eigentlich richtig war, tippe in der Rückmeldung
            auf <strong>„Dennoch als richtig werten“</strong>. Der falsche Versuch
            wird dann zurückgenommen und zählt als richtig. Die Option erscheint
            nur bei kleinen Abweichungen und nur bei Sprache oder Handschrift,
            nicht beim Tippen. Bei großen Abweichungen hilft es, deutlich zu
            sprechen, in Druckbuchstaben zu schreiben oder zu tippen.</p>
          </details>
          <details class="faq-item">
            <summary>Warum klingt die Vorlese-Stimme komisch?</summary>
            <p>${esc(APP_NAME)} nutzt die Stimmen, die im Betriebssystem oder
            Browser installiert sind. Ist keine englische Stimme vorhanden,
            klingt die Aussprache deutsch. Auf vielen Geräten hilft es, unter
            den Systemeinstellungen eine englische Stimme (en-GB oder en-US)
            hinzuzufügen.</p>
          </details>
          <details class="faq-item">
            <summary>Wann gibt es besondere Überraschungen?</summary>
            <p>Bei 100, 250, 500, 1000 und 2000 Punkten feiert Pip einmalig mit
            Konfetti und einem Spruch. Das Tagesziel (50 Punkte an einem Tag)
            gibt es ebenfalls als Feier und Abzeichen. Für jedes Thema gibt es
            Medaillen: 🥉 ab der Hälfte, 🥈 ab drei Vierteln und 🏆 bei allen
            Wörtern. Nach jeder Runde wartet außerdem ein Glücksrad mit einer
            kleinen Überraschung – manchmal mit Bonuspunkten.</p>
          </details>
          <details class="faq-item">
            <summary>Können mehrere Kinder die App nutzen?</summary>
            <p>Ja. Tippe oben in der Kopfzeile auf dein Profil und lege weitere
            Profile an. Jede Person hat ihre eigene Vokabelliste, Punkte und
            Fortschritte. Beim Wechseln wird der aktuelle Stand automatisch
            gesichert. Im Elternbereich lassen sich Profile umbenennen und löschen.</p>
          </details>
          <details class="faq-item">
            <summary>Wo sind meine Daten, wenn ich den Browser wechsle?</summary>
            <p>Die Daten hängen am Browser und Gerät. Für einen Umzug erstelle
            im Elternbereich unter „Sichern“ ein lokales Backup
            (<code>speakup-backup.json</code>) und spiele es auf dem anderen
            Gerät wieder ein. Dort sind alle Vokabellisten und Profile enthalten.
            Das ist die Alternative zu Google Drive – ohne Konto und ohne
            Internet. Wer stattdessen die Cloud nutzen möchte, trägt im
            Elternbereich unter „Einstellungen“ die eigene OAuth-Client-ID ein
            und sichert die Profile manuell in den versteckten App-Ordner des
            eigenen Google-Kontos.</p>
          </details>
          <details class="faq-item">
            <summary>Kann ich eigene Vokabeln hinzufügen?</summary>
            <p>Ja. Im Elternbereich lassen sich Wörter und Themen anlegen,
            bearbeiten und sortieren. CSV-Dateien aus Excel oder Google Sheets
            können mit Vorschau importiert werden. Alternativ ein Foto der
            Vokabelliste machen – die erkannten Paare werden als Vorschläge
            angezeigt und können einzeln abgewählt werden. Die Rechenaufgabe am
            Anfang ist eine Hürde für Kinder, keine Sicherheitsmaßnahme.</p>
          </details>
          <details class="faq-item">
            <summary>Was passiert beim Löschen eines Wortes?</summary>
            <p>Jedes Wort hat eine feste ID. Wird ein Wort gelöscht, verliert nur
            dieses Wort seinen Fortschritt. Beim Bearbeiten kann der Lernstand
            mitgenommen werden. Standardlisten werden bei App-Updates ergänzt,
            ohne eigene Wörter oder Fortschritte zu überschreiben.</p>
          </details>
          <details class="faq-item">
            <summary>Gibt es Werbung, Abos oder In-App-Käufe?</summary>
            <p>Nein. ${esc(APP_NAME)} ist eine kostenlose, werbefreie Web-App
            ohne SpeakUp-Konto. Alle Lernfunktionen sind direkt verfügbar.</p>
          </details>
        </div>
      </section>

      <section class="panel about-version" aria-labelledby="version-title">
        <div>
          <h2 id="version-title">Version &amp; Inhalt</h2>
          <p class="mb-0">
            App <strong>${esc(APP_VERSION)}</strong> ·
            Vokabeldaten <strong>${esc(lib?.dataVersion || "unbekannt")}</strong> ·
            ${plural(lib?.themes?.length || 0, "Thema", "Themen")} ·
            ${plural(lib?.words?.length || 0, "Wort", "Wörter")}
          </p>
          <p class="tiny muted mb-0 mt-1">
            Sprache: ${esc(settings.speechRate || 0.9)}× · Made for kids, parents &amp; teachers.
          </p>
        </div>
        <button type="button" class="btn btn-soft btn-small" data-action="demo-voice">
          ${icon("speaker")} Stimme testen
        </button>
      </section>
    </div>
  `;

  main.querySelector('[data-action="install"]')?.addEventListener("click", async () => {
    const result = await promptInstall();
    if (result.outcome === "accepted") {
      showToast("SpeakUp wird installiert. 🎉", { type: "success", iconName: "check" });
    } else if (result.outcome === "unavailable") {
      showToast(installHint(), { iconName: "info" });
    }
  });

  main.querySelector('[data-action="demo-voice"]')?.addEventListener("click", () => {
    unlockTts();
    speak("Speak up! Let's learn English together.", {
      rate: learner.getSettings().speechRate || 0.9,
      lang: "en-GB",
    });
  });

  return () => {};
}

export default renderAbout;

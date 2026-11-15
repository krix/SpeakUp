/** Datenschutz-Hinweis vor der ersten Nutzung und Einstellungen dazu. */
import { openModal, icon, showToast } from "../ui/dom.js";
import { mascot } from "../ui/mascot.js";
import * as learner from "../core/learner.js";

/**
 * Zeigt den verständlichen Datenschutz-Hinweis.
 * @param {{firstRun?: boolean, onDone?: Function}} options
 */
export function showConsentModal({ firstRun = false, onDone = null } = {}) {
  const current = learner.getConsent();
  const status = current
    ? current.allowOnline
      ? "Online-Funktionen sind aktuell <strong>erlaubt</strong>."
      : "Online-Funktionen sind aktuell <strong>aus</strong>. Du lernst mit Tippen."
    : "";

  const content = `
    <div class="consent-hero">
      ${mascot("happy", { size: 96, className: "mascot-small" })}
      <p class="mb-0">Bevor wir loslegen, erklären wir dir kurz, was mit deiner Stimme und deiner Schrift passiert.</p>
    </div>

    <div class="consent-item">
      <span class="consent-icon">${icon("mic")}</span>
      <div>
        <strong>🎤 Sprache</strong>
        <p>Wenn du ins Mikrofon sprichst, schickt dein Browser die Aufnahme an den Spracherkennungsdienst des Browser-Herstellers (bei Chrome z. B. Google). SpeakUp selbst speichert keine Audioaufnahmen.</p>
      </div>
    </div>

    <div class="consent-item">
      <span class="consent-icon">${icon("pencil")}</span>
      <div>
        <strong>✍️ Handschrift</strong>
        <p>Deine Striche auf der Zeichenfläche werden als Punktdaten an Google Input Tools geschickt, damit das Wort erkannt wird. Auch diese Daten werden von SpeakUp nicht gespeichert. Der Dienst ist nicht offiziell dokumentiert und kann ausfallen – dann kannst du tippen.</p>
      </div>
    </div>

    <div class="consent-item green">
      <span class="consent-icon">${icon("lock")}</span>
      <div>
        <strong>🔒 Bleibt auf deinem Gerät</strong>
        <p>Punkte, Fortschritt, eigene Wörter und Einstellungen liegen nur auf diesem Gerät. Es gibt keine Anmeldung, keine Werbung, keine Tracker und keine Analytics.</p>
      </div>
    </div>

    <p class="small muted mb-0">
      Du kannst auch <strong>ohne Mikrofon und ohne Handschrift-Erkennung</strong> üben und stattdessen tippen.
      Eltern können das jederzeit im Elternbereich ändern – dort steht auch, wie man die Erlaubnis widerruft.
      ${status ? `<br><span class="mt-1" style="display:inline-block">${status}</span>` : ""}
    </p>
  `;

  const actions = [
    {
      label: "Einverstanden – mit Sprache & Stift",
      variant: "btn-primary",
      iconName: "check",
      onClick: async () => {
        await learner.setConsent(true);
      },
    },
    {
      label: "Nur mit Tippen lernen",
      variant: "btn-ghost",
      onClick: async () => {
        await learner.setConsent(false);
        showToast("Alles klar! Du kannst jederzeit tippen.", { iconName: "keyboard" });
      },
    },
  ];

  openModal({
    title: firstRun ? "Willkommen bei SpeakUp!" : "Datenschutz & Online-Funktionen",
    subtitle: "Kurz erklärt – für Kinder und Eltern.",
    content,
    actions,
    dismissible: !firstRun,
    onClose: () => {
      if (typeof onDone === "function") onDone(learner.getConsent());
    },
  });
}

/** Öffnet den Hinweis, wenn eine Funktion ohne Einwilligung genutzt werden soll. */
export function explainOnlineRequired() {
  showConsentModal({ firstRun: false });
}

export default showConsentModal;

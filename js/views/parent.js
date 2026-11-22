/**
 * Elternbereich – durch eine Rechenaufgabe geschützt.
 *
 * Tabs:
 *   Wörter      – Wörter ansehen, anlegen, bearbeiten, sortieren, löschen
 *   Themen      – Themen anlegen, bearbeiten, sortieren, löschen, CSV exportieren
 *   Import      – CSV aus Datei, Einfügen oder URL mit Vorschau importieren
 *   Sichern     – JSON-Backup, CSV-Export, Wiederherstellen, Zurücksetzen
 *   Fortschritt – Statistik pro Wort, Verlauf, Fortschritt zurücksetzen
 *   Einstellungen – Ton, Vorlesen, Handschrift, Einwilligung, Installation
 *
 * Die Rechenaufgabe ist kein Sicherheitsmerkmal, sondern eine Hürde für
 * jüngere Kinder. Alle Daten bleiben lokal.
 */
import * as library from "../core/library.js";
import * as learner from "../core/learner.js";
import * as transfer from "../core/transfer.js";
import * as profiles from "../core/profiles.js";
import * as drive from "../core/drive.js";
import * as westermann from "../core/westermann.js";
import db from "../core/db.js";
import bus from "../core/bus.js";
import { APP_VERSION, PARENT_SESSION_KEY } from "../core/config.js";
import {
  icon,
  esc,
  openModal,
  confirmDialog,
  showToast,
  formatDate,
  formatDuration,
  plural,
  readTextFile,
  setButtonBusy,
  errorMessage,
  sanitizeRichText,
  stripRichText,
} from "../ui/dom.js";
import { sfx, setSfxEnabled } from "../ui/sfx.js";
import { speak, unlockTts } from "../core/tts.js";
import { mascot } from "../ui/mascot.js";
import { showConsentModal } from "./onboarding.js";
import { openProfileSwitcher, openProfileForm } from "../ui/profile-switcher.js";
import { canInstall, promptInstall, installHint, isStandalone } from "../core/install.js";
import { PROVIDER_INFO, isCloudProvider, testCloudProvider } from "../core/handwriting-cloud.js";
import { getApiKey, setApiKey, clearApiKey } from "../core/secrets.js";
import {
  extractVocabularyFromPhoto,
  pairsToCsv,
  photoProviderLabel,
  resolvePhotoProvider,
} from "../core/photo-import.js";

const TABS = [
  { id: "words", label: "Wörter", iconName: "pencil" },
  { id: "themes", label: "Themen", iconName: "menu" },
  { id: "import", label: "Import", iconName: "upload" },
  { id: "backup", label: "Sichern", iconName: "download" },
  { id: "stats", label: "Fortschritt", iconName: "chart" },
  { id: "settings", label: "Einstellungen", iconName: "lock" },
];

const IMPORT_MODES = [
  { id: "add", title: "Hinzufügen", desc: "Nur neue Wörter übernehmen. Vorhandene bleiben unverändert." },
  { id: "merge", title: "Zusammenführen", desc: "Gleiche deutsche Wörter aktualisieren, neue ergänzen." },
  { id: "replace", title: "Ersetzen", desc: "Das Thema wird vollständig durch die Datei ersetzt." },
];

const MODE_LABELS = { speak: "Sprechen", listen: "Hören & Schreiben", write: "Schreiben", mix: "Mix" };

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function makeGateTask() {
  // Zweistellige Multiplikation – für Grundschulkinder ohne Taschenrechner
  // eine echte Hürde, für Erwachsene in wenigen Sekunden gelöst.
  const a = randomInt(12, 19);
  const b = randomInt(3, 9);
  return { a, b, answer: a * b };
}

function freshPhotoState() {
  return {
    busy: false,
    error: "",
    dataUrl: "",
    fileName: "",
    rawText: "",
    pairs: [],
    provider: "",
  };
}

function freshWestermannState() {
  return { busy: false, error: "", catalog: [], query: "", bookId: "", book: null, selectedChapters: [] };
}

function freshImportState(target) {
  return {
    source: "file",
    text: "",
    fileName: "",
    analysis: null,
    target: target || "",
    mode: "merge",
    newName: "",
    newEmoji: "??",
    busy: false,
    error: "",
    photo: freshPhotoState(),
    westermann: freshWestermannState(),
  };
}

function storeUnlock(value) {
  try {
    if (value) sessionStorage.setItem(PARENT_SESSION_KEY, "1");
    else sessionStorage.removeItem(PARENT_SESSION_KEY);
  } catch {
    /* privater Modus – dann gilt die Sperre nur für diese Ansicht */
  }
}

function readUnlock() {
  try {
    return sessionStorage.getItem(PARENT_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Einheitliches Feld für Formulare im Modal. */
function field({ id, label, value = "", type = "text", hint = "", placeholder = "", required = false, autofocus = false }) {
  return `
    <div class="field">
      <label for="${id}">${esc(label)}${required ? " *" : ""}</label>
      <input class="input" id="${id}" name="${id}" type="${type}" value="${esc(value)}"
             placeholder="${esc(placeholder)}" ${required ? "required" : ""} ${autofocus ? "autofocus" : ""}
             ${type === "number" ? 'min="0" step="1"' : ""}>
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}
    </div>`;
}

function textareaField({ id, label, value = "", hint = "", rows = 3 }) {
  return `
    <div class="field">
      <label for="${id}">${esc(label)}</label>
      <textarea class="textarea" id="${id}" name="${id}" rows="${rows}" style="min-height:${rows * 28 + 24}px">${esc(value)}</textarea>
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}
    </div>`;
}

function modalError(dialog, message) {
  if (!dialog) return;
  let node = dialog.querySelector(".form-error");
  if (!node) {
    node = document.createElement("p");
    node.className = "form-error";
    const body = dialog.querySelector(".modal-body");
    if (body) body.prepend(node);
    else dialog.prepend(node);
  }
  node.textContent = message;
}

function clearModalError(dialog) {
  dialog?.querySelector(".form-error")?.remove();
}

/* ============================================================ */

export function renderParent(main) {
  let alive = true;
  const themes = library.getThemes();
  const state = {
    gate: makeGateTask(),
    gateError: "",
    unlocked: readUnlock(),
    tab: "words",
    themeId: themes[0]?.id || null,
    search: "",
    statsSearch: "",
    statsSort: "wrong",
    import: freshImportState(themes[0]?.id),
    backupThemeId: themes[0]?.id || null,
  };

  /* ---------- Grundgerüst ---------- */

  function render() {
    if (!alive) return;
    if (!state.unlocked) return renderGate();

    if (!state.themeId || !library.getTheme(state.themeId)) {
      state.themeId = library.getThemes()[0]?.id || null;
    }

    main.innerHTML = `
      <div class="stack">
        <div class="row-between">
          <div>
            <h1 class="mb-0">Elternbereich</h1>
            <p class="muted small mb-0">Wörter, Themen und Fortschritt verwalten</p>
          </div>
          <button type="button" class="btn btn-ghost btn-small" data-action="lock">
            ${icon("lock")} Sperren
          </button>
        </div>

        <div class="parent-tabs" role="tablist" aria-label="Bereiche im Elternbereich">
          ${TABS.map(
            (tab) => `
            <button type="button" class="parent-tab" role="tab" id="ptab-${tab.id}"
                    data-parent-tab="${tab.id}" aria-selected="${state.tab === tab.id}"
                    aria-controls="parent-panel">
              ${icon(tab.iconName)} ${esc(tab.label)}
            </button>`
          ).join("")}
        </div>

        <div id="parent-panel" role="tabpanel" aria-labelledby="ptab-${state.tab}"></div>
      </div>`;

    main.querySelector('[data-action="lock"]')?.addEventListener("click", () => {
      state.unlocked = false;
      storeUnlock(false);
      state.gate = makeGateTask();
      state.gateError = "";
      render();
      showToast("Elternbereich gesperrt.", { iconName: "lock" });
    });

    main.querySelectorAll("[data-parent-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.parentTab === state.tab) return;
        sfx.click();
        state.tab = button.dataset.parentTab;
        render();
      });
    });

    renderPanel();
  }

  function renderPanel() {
    if (!alive) return;
    const panel = main.querySelector("#parent-panel");
    if (!panel) return;
    switch (state.tab) {
      case "words":
        return renderWords(panel);
      case "themes":
        return renderThemes(panel);
      case "import":
        return renderImport(panel);
      case "backup":
        return renderBackup(panel);
      case "stats":
        return renderStats(panel);
      case "settings":
        return renderSettings(panel);
      default:
        return renderWords(panel);
    }
  }

  /* ---------- Elternsperre ---------- */

  function renderGate() {
    const { a, b } = state.gate;
    main.innerHTML = `
      <div class="card panel parent-gate-note">
        <div class="gate-icon">${icon("lock")}</div>
        <h1>Elternbereich</h1>
        <p class="muted">Dieser Bereich ist für Erwachsene. Bitte löse kurz die Aufgabe.</p>
        <p class="gate-task" id="gate-task" aria-live="polite">${a} × ${b} = ?</p>
        <form class="gate-form" id="gate-form" autocomplete="off">
          <input class="input" type="number" inputmode="numeric" id="gate-answer" name="answer"
                 aria-label="Ergebnis der Aufgabe" placeholder="?" required>
          <button class="btn" type="submit">${icon("check")} Weiter</button>
        </form>
        <p class="gate-error" id="gate-error" role="alert">${esc(state.gateError)}</p>
        <a class="btn-link" href="#/home">${icon("back")} Zurück zum Lernen</a>
      </div>`;

    const form = main.querySelector("#gate-form");
    const input = main.querySelector("#gate-answer");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = Number.parseInt(input?.value || "", 10);
      if (Number.isFinite(value) && value === state.gate.answer) {
        state.unlocked = true;
        state.gateError = "";
        storeUnlock(true);
        render();
        showToast("Elternbereich entsperrt.", { type: "success", iconName: "check" });
        return;
      }
      state.gate = makeGateTask();
      state.gateError = "Das war leider falsch. Hier ist eine neue Aufgabe.";
      render();
      main.querySelector("#gate-answer")?.focus();
    });
    input?.focus();
  }

  /* ---------- Wörter ---------- */

  function renderWords(panel) {
    const themeOptions = library
      .getThemes()
      .map(
        (theme) =>
          `<option value="${esc(theme.id)}" ${theme.id === state.themeId ? "selected" : ""}>${esc(theme.emoji)} ${esc(theme.name)}</option>`
      )
      .join("");
    const theme = state.themeId ? library.getTheme(state.themeId) : null;
    const words = theme ? library.getWords(theme.id) : [];
    const progress = learner.getProgressMap();
    const query = state.search.trim().toLowerCase();
    const visible = query
      ? words.filter((word) =>
          `${word.de} ${word.en} ${(word.alternatives || []).join(" ")}`.toLowerCase().includes(query)
        )
      : words;

    panel.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Wörter</h2>
            <p>${theme ? `${esc(theme.name)} · ${plural(words.length, "Wort", "Wörter")}` : "Kein Thema vorhanden"}</p>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-ghost btn-small" data-action="make-list" ${words.length ? "" : "disabled"}>
              ${icon("plus")} Eigene Liste
            </button>
            <button type="button" class="btn btn-small" data-action="add-word" ${theme ? "" : "disabled"}>
              ${icon("plus")} Neues Wort
            </button>
          </div>
        </div>

        <div class="toolbar">
          <label class="sr-only" for="word-theme">Thema wählen</label>
          <select class="select" id="word-theme" style="max-width:260px">${themeOptions}</select>
          <label class="sr-only" for="word-search">Wörter durchsuchen</label>
          <input class="input" id="word-search" type="search" placeholder="Suchen …"
                 value="${esc(state.search)}" style="max-width:220px">
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost btn-small" data-action="sort-az" ${theme ? "" : "disabled"}>A–Z</button>
          <button type="button" class="btn btn-ghost btn-small" data-action="sort-za" ${theme ? "" : "disabled"}>Z–A</button>
        </div>

        ${
          words.length
            ? `<div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Deutsch</th>
                      <th scope="col">Englisch</th>
                      <th scope="col">Alternativen / Beispiel</th>
                      <th scope="col">Box</th>
                      <th scope="col">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${words
                      .map((word, index) => {
                        const record = progress.get(word.id);
                        const matches = !query || visible.includes(word);
                        return `
                        <tr data-search="${esc(`${word.de} ${word.en} ${(word.alternatives || []).join(" ")}`.toLowerCase())}" ${matches ? "" : "hidden"}>
                          <td class="tiny muted">${index + 1}</td>
                          <td>
                            <strong>${sanitizeRichText(word.de)}</strong>
                            ${word.emoji ? `<span aria-hidden="true"> ${esc(word.emoji)}</span>` : ""}
                          </td>
                          <td>${sanitizeRichText(word.en)}</td>
                          <td class="tiny">
                            ${word.alternatives?.length ? `<div>${word.alternatives.map((alt) => sanitizeRichText(alt)).join(", ")}</div>` : `<span class="muted">–</span>`}
                            ${word.example ? `<div class="muted">„${sanitizeRichText(word.example)}“</div>` : ""}
                          </td>
                          <td><span class="preview-stat" title="Leitner-Box">${record?.seen ? record.box : "neu"}</span></td>
                          <td class="actions">
                            <button type="button" class="icon-btn tiny-btn" data-word-action="up" data-id="${esc(word.id)}" aria-label="Nach oben" ${index === 0 ? "disabled" : ""}>${icon("back", "icon-arrow-up")}</button>
                            <button type="button" class="icon-btn tiny-btn" data-word-action="down" data-id="${esc(word.id)}" aria-label="Nach unten" ${index === words.length - 1 ? "disabled" : ""}>${icon("forward", "icon-arrow-down")}</button>
                            <button type="button" class="icon-btn tiny-btn" data-word-action="edit" data-id="${esc(word.id)}" aria-label="Wort bearbeiten">${icon("pencil")}</button>
                            <button type="button" class="icon-btn tiny-btn" data-word-action="delete" data-id="${esc(word.id)}" aria-label="Wort löschen">${icon("trash")}</button>
                          </td>
                        </tr>`;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>
              <p class="scroll-hint">Auf schmalen Bildschirmen lässt sich die Tabelle seitlich scrollen.</p>`
            : `<div class="table-empty">
                ${theme ? "In diesem Thema sind noch keine Wörter. Füge das erste hinzu!" : "Lege zuerst ein Thema an."}
              </div>`
        }

        <div class="callout mt-2">
          ${icon("info")}
          <div>
            <p class="mb-0"><strong>ID &amp; Fortschritt:</strong> Jedes Wort hat eine feste ID aus Thema, Deutsch und Englisch.
            Beim Bearbeiten kannst du den Lernfortschritt mitnehmen. Gelöschte Wörter verlieren nur ihren eigenen Fortschritt.</p>
          </div>
        </div>
      </div>`;

    panel.querySelector("#word-theme")?.addEventListener("change", (event) => {
      state.themeId = event.target.value;
      state.search = "";
      renderPanel();
    });

    panel.querySelector("#word-search")?.addEventListener("input", (event) => {
      state.search = event.target.value;
      const search = state.search.trim().toLowerCase();
      panel.querySelectorAll("tbody tr[data-search]").forEach((row) => {
        row.hidden = Boolean(search) && !row.dataset.search.includes(search);
      });
    });

    panel.querySelector('[data-action="add-word"]')?.addEventListener("click", () => openWordModal(null));
    panel.querySelector('[data-action="make-list"]')?.addEventListener("click", () => openCustomListModal(theme, visible));
    panel.querySelector('[data-action="sort-az"]')?.addEventListener("click", () => sortWords("az"));
    panel.querySelector('[data-action="sort-za"]')?.addEventListener("click", () => sortWords("za"));

    panel.querySelectorAll("[data-word-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const word = library.getWord(button.dataset.id);
        if (!word) return;
        switch (button.dataset.wordAction) {
          case "up":
            library.moveWord(word.id, "up").then(renderPanel);
            break;
          case "down":
            library.moveWord(word.id, "down").then(renderPanel);
            break;
          case "edit":
            openWordModal(word);
            break;
          case "delete":
            deleteWord(word);
            break;
        }
      });
    });
  }

  async function sortWords(direction) {
    if (!state.themeId) return;
    await library.sortWords(state.themeId, direction);
    showToast("Wörter neu sortiert.", { type: "success", iconName: "check" });
    renderPanel();
  }

  function openCustomListModal(theme, visibleWords) {
    if (!theme) return;
    const sourceWords = Array.isArray(visibleWords) && visibleWords.length ? visibleWords : library.getWords(theme.id);
    const modal = openModal({
      title: "Eigene Lernliste erstellen",
      content: `
        <form id="custom-list-form" class="form-grid" novalidate>
          ${field({ id: "cl-name", label: "Name der Liste", value: `Meine Liste – ${theme.name}`, required: true, autofocus: true })}
          ${field({ id: "cl-emoji", label: "Emoji (optional)", value: "📝", placeholder: "z. B. 📝" })}
          <div class="field">
            <span class="field-label">Wörter auswählen</span>
            <div class="check-list" style="max-height:260px;overflow:auto;border:1px solid var(--c-line);border-radius:12px;padding:10px;">
              ${sourceWords.map((w) => `
                <label class="check-row"><input type="checkbox" name="cl-word" value="${esc(w.id)}" checked>
                  <span>${esc(w.de)} <span class="tiny muted">– ${esc(w.en)}</span></span>
                </label>`).join("")}
            </div>
            <p class="field-hint">Ausgewählte Wörter werden in ein neues Thema kopiert. Der Lernfortschritt der Originalwörter bleibt unverändert.</p>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-close>Abbrechen</button>
            <button type="submit" class="btn">${icon("plus")} Liste erstellen</button>
          </div>
        </form>`,
    });
    const form = modal.body.querySelector("#custom-list-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get("cl-name") || "").trim();
      const emoji = String(fd.get("cl-emoji") || "").trim() || "📝";
      const ids = new Set(fd.getAll("cl-word").map(String));
      const selected = sourceWords.filter((w) => ids.has(w.id));
      if (!name) { showToast("Bitte gib einen Namen ein.", { type: "warn" }); return; }
      if (!selected.length) { showToast("Bitte wähle mindestens ein Wort aus.", { type: "warn" }); return; }
      try {
        const rows = selected.map((w) => ({
          de: w.de, en: w.en, alternatives: w.alternatives || [], example: w.example || "", emoji: w.emoji || "",
          imageUrl: w.imageUrl || "", audioUrl: w.audioUrl || "", source: w.source || null,
        }));
        const result = await library.applyImport({
          themeId: null,
          newTheme: { name, emoji, source: { type: "custom-list", bookId: "", bookName: theme.name } },
          rows,
          mode: "add",
        });
        modal.close();
        state.themeId = result.themeId;
        showToast(`Liste „${name}“ mit ${result.added} Wörtern erstellt.`, { type: "success", iconName: "check" });
        renderPanel();
      } catch (err) {
        showToast(err.message || "Liste konnte nicht erstellt werden.", { type: "error" });
      }
    });
  }

  function openWordModal(word) {
    const isEdit = Boolean(word);
    const themes = library.getThemes();
    const selectedTheme = word?.themeId || state.themeId || themes[0]?.id;
    const content = `
      <form id="word-form" autocomplete="off">
        <div class="field-row">
          ${field({ id: "de", label: "Deutsch", value: word?.de || "", required: true, autofocus: !isEdit, placeholder: "z. B. Hund" })}
          ${field({ id: "en", label: "Englisch", value: word?.en || "", required: true, autofocus: isEdit, placeholder: "z. B. dog" })}
        </div>
        ${field({
          id: "alternatives",
          label: "Alternativen",
          value: (word?.alternatives || []).join(" | "),
          hint: "Mehrere Antworten mit | oder Komma trennen, z. B. „dog | doggy“.",
          placeholder: "dog | doggy",
        })}
        ${field({
          id: "example",
          label: "Beispielsatz",
          value: word?.example || "",
          hint: "Wird im Feedback angezeigt. Englisch ist am besten.",
          placeholder: "The dog is big.",
        })}
        <div class="field-row">
          ${field({ id: "emoji", label: "Emoji", value: word?.emoji || "", placeholder: "🐶", hint: "Optional – hilft beim Erinnern." })}
          <div class="field">
            <label for="themeId">Thema</label>
            <select class="select" id="themeId" name="themeId">
              ${themes
                .map(
                  (theme) =>
                    `<option value="${esc(theme.id)}" ${theme.id === selectedTheme ? "selected" : ""}>${esc(theme.emoji)} ${esc(theme.name)}</option>`
                )
                .join("")}
            </select>
          </div>
        </div>
        ${
          isEdit
            ? `<label class="check-row">
                <input type="checkbox" id="keep-progress" name="keepProgress" checked>
                <span>Lernfortschritt mitnehmen, wenn sich Deutsch, Englisch oder Thema ändern.</span>
              </label>`
            : ""
        }
      </form>`;

    openModal({
      title: isEdit ? "Wort bearbeiten" : "Neues Wort",
      subtitle: isEdit ? "Änderungen gelten sofort für alle Runden." : "Das Wort wird am Ende des Themas eingefügt.",
      content,
      size: "modal-lg",
      actions: [
        { label: "Abbrechen", variant: "btn-ghost" },
        {
          label: "Speichern",
          variant: "btn-primary",
          iconName: "check",
          onClick: async ({ dialog }) => {
            clearModalError(dialog);
            const form = dialog.querySelector("#word-form");
            const get = (name) => form.elements[name]?.value ?? "";
            const data = {
              de: get("de").trim(),
              en: get("en").trim(),
              alternatives: get("alternatives")
                .split(/[|,;]/)
                .map((part) => part.trim())
                .filter(Boolean),
              example: get("example").trim(),
              emoji: get("emoji").trim(),
              themeId: get("themeId"),
            };
            if (!data.de || !data.en) {
              modalError(dialog, "Bitte fülle Deutsch und Englisch aus.");
              return false;
            }
            try {
              if (isEdit) {
                const keep = form.elements.keepProgress?.checked ?? true;
                const result = await library.updateWord(word.id, data, { keepProgress: keep });
                if (result.changed) {
                  if (keep) await learner.migrateProgress(result.oldId, result.newId);
                  else await learner.deleteProgress(result.oldId);
                }
                showToast("Wort gespeichert.", { type: "success", iconName: "check" });
              } else {
                await library.addWord(data.themeId, data);
                showToast("Wort hinzugefügt.", { type: "success", iconName: "plus" });
              }
              state.themeId = data.themeId;
              renderPanel();
            } catch (error) {
              modalError(dialog, error.message || "Das Wort konnte nicht gespeichert werden.");
              return false;
            }
          },
        },
      ],
    });
  }

  async function deleteWord(word) {
    const ok = await confirmDialog({
      title: "Wort löschen?",
      message: `„${word.de} / ${word.en}“ wird aus dem Thema entfernt. Der Lernfortschritt für dieses Wort wird ebenfalls gelöscht.`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await library.deleteWord(word.id);
    await learner.deleteProgress(word.id);
    showToast("Wort gelöscht.", { iconName: "trash" });
    renderPanel();
  }

  /* ---------- Themen ---------- */

  function renderThemes(panel) {
    const themes = library.getThemes();
    const progress = learner.getProgressMap();
    const points = learner.getProfile().points;

    const groups = [];
    const bookGroups = new Map();
    for (const theme of themes) {
      const bookId = theme.source?.type === "westermann-book" ? (theme.source.bookId || theme.source.bookName || theme.id) : "";
      if (bookId) {
        let g = bookGroups.get(bookId);
        if (!g) {
          g = { kind: "book", id: bookId, name: theme.source.bookName || "Westermann-Buch", themes: [] };
          bookGroups.set(bookId, g);
          groups.push(g);
        }
        g.themes.push(theme);
      } else {
        groups.push({ kind: "theme", theme });
      }
    }

    const renderThemeRow = (theme, index, total, nested = false) => {
      const stats = library.getThemeStats(theme.id, progress);
      return `
        <div class="theme-admin-row ${nested ? "is-nested" : ""}">
          <span class="emoji" aria-hidden="true">${esc(theme.emoji)}</span>
          <div>
            <div class="name">${esc(theme.name)}</div>
            <div class="meta">
              ${plural(stats.total, "Wort", "Wörter")} · ${stats.mastered} gemeistert ·
              ${theme.unlockPoints > 0 ? `ab ${theme.unlockPoints} Punkten` : "sofort frei"} ·
              ${theme.origin === "default" ? "Standard" : "eigenes Thema"}
            </div>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-soft btn-small" data-theme-action="manage" data-id="${esc(theme.id)}">Wörter</button>
            <button type="button" class="btn btn-ghost btn-small" data-theme-action="export" data-id="${esc(theme.id)}">${icon("download")} CSV</button>
            <button type="button" class="icon-btn tiny-btn" data-theme-action="up" data-id="${esc(theme.id)}" aria-label="Nach oben" ${index === 0 ? "disabled" : ""}>${icon("back", "icon-arrow-up")}</button>
            <button type="button" class="icon-btn tiny-btn" data-theme-action="down" data-id="${esc(theme.id)}" aria-label="Nach unten" ${index === total - 1 ? "disabled" : ""}>${icon("forward", "icon-arrow-down")}</button>
            <button type="button" class="icon-btn tiny-btn" data-theme-action="edit" data-id="${esc(theme.id)}" aria-label="Thema bearbeiten">${icon("pencil")}</button>
            <button type="button" class="icon-btn tiny-btn" data-theme-action="delete" data-id="${esc(theme.id)}" aria-label="Thema löschen">${icon("trash")}</button>
          </div>
        </div>`;
    };

    panel.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Themen</h2>
            <p>${plural(themes.length, "Thema", "Themen")} · importierte Buchkapitel werden nach Buch gruppiert</p>
          </div>
          <div class="row">
            <button type="button" class="btn btn-ghost btn-small" data-action="sort-themes" ${themes.length > 1 ? "" : "disabled"}>A–Z</button>
            <button type="button" class="btn btn-small" data-action="add-theme">${icon("plus")} Neues Thema</button>
          </div>
        </div>

        ${
          themes.length
            ? `<div class="theme-admin-list">
                ${groups.map((group) => {
                  if (group.kind === "theme") {
                    const index = themes.findIndex((t) => t.id === group.theme.id);
                    return renderThemeRow(group.theme, index, themes.length);
                  }
                  const totalWords = group.themes.reduce((s, t) => s + library.getWords(t.id).length, 0);
                  return `
                    <section class="theme-book-group">
                      <div class="theme-book-head">
                        <div>
                          <strong>${icon("book")} ${esc(group.name)}</strong>
                          <div class="tiny muted">${group.themes.length} Kapitel · ${totalWords} Wörter</div>
                        </div>
                      </div>
                      <div class="theme-book-chapters">
                        ${group.themes.map((theme, idx) => {
                          const index = themes.findIndex((t) => t.id === theme.id);
                          return renderThemeRow(theme, index, themes.length, true);
                        }).join("")}
                      </div>
                    </section>`;
                }).join("")}
              </div>`
            : `<div class="table-empty">Noch keine Themen. Lege das erste an!</div>`
        }

        <div class="callout mt-2">
          ${icon("info")}
          <div>
            <p class="mb-0">Themen mit <strong>Punkte-Sperre</strong> öffnen sich erst, wenn dein Kind genug Punkte gesammelt hat.
            Aktuell: <strong>${points} Punkte</strong>. Eigene Themen sind immer frei, wenn du 0 Punkte einträgst.</p>
          </div>
        </div>
      </div>`;

    panel.querySelector('[data-action="add-theme"]')?.addEventListener("click", () => openThemeModal(null));
    panel.querySelector('[data-action="sort-themes"]')?.addEventListener("click", async () => {
      await library.sortThemes("az");
      showToast("Themen neu sortiert.", { type: "success", iconName: "check" });
      renderPanel();
    });

    panel.querySelectorAll("[data-theme-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const theme = library.getTheme(button.dataset.id);
        if (!theme) return;
        switch (button.dataset.themeAction) {
          case "manage":
            state.themeId = theme.id;
            state.tab = "words";
            render();
            break;
          case "export":
            exportThemeCsv(theme.id);
            break;
          case "up":
            library.moveTheme(theme.id, "up").then(renderPanel);
            break;
          case "down":
            library.moveTheme(theme.id, "down").then(renderPanel);
            break;
          case "edit":
            openThemeModal(theme);
            break;
          case "delete":
            deleteTheme(theme);
            break;
        }
      });
    });
  }

  function openThemeModal(theme) {
    const isEdit = Boolean(theme);
    const content = `
      <form id="theme-form" autocomplete="off">
        <div class="field-row">
          ${field({ id: "name", label: "Name", value: theme?.name || "", required: true, autofocus: true, placeholder: "z. B. Tierwelt" })}
          ${field({ id: "emoji", label: "Emoji", value: theme?.emoji || "📘", placeholder: "📘", hint: "Ein Symbol für die Themenkarte." })}
        </div>
        ${field({
          id: "unlockPoints",
          label: "Freischalten ab Punkten",
          value: String(theme?.unlockPoints ?? 0),
          type: "number",
          hint: "0 = sofort frei. Empfehlung: 0, 60, 120, 200.",
        })}
        <p class="tiny muted mb-0">Ein eigenes Thema ist immer bearbeitbar. Standardthemen werden beim App-Update nicht überschrieben, sobald du sie änderst.</p>
      </form>`;

    openModal({
      title: isEdit ? "Thema bearbeiten" : "Neues Thema",
      content,
      actions: [
        { label: "Abbrechen", variant: "btn-ghost" },
        {
          label: "Speichern",
          variant: "btn-primary",
          iconName: "check",
          onClick: async ({ dialog }) => {
            clearModalError(dialog);
            const form = dialog.querySelector("#theme-form");
            const data = {
              name: form.elements.name.value.trim(),
              emoji: form.elements.emoji.value.trim(),
              unlockPoints: Number.parseInt(form.elements.unlockPoints.value || "0", 10) || 0,
            };
            if (!data.name) {
              modalError(dialog, "Bitte gib einen Namen für das Thema ein.");
              return false;
            }
            try {
              if (isEdit) {
                await library.updateTheme(theme.id, data);
                showToast("Thema gespeichert.", { type: "success", iconName: "check" });
              } else {
                const created = await library.addTheme(data);
                state.themeId = created.id;
                showToast("Thema angelegt. Jetzt Wörter hinzufügen!", { type: "success", iconName: "plus" });
              }
              renderPanel();
            } catch (error) {
              modalError(dialog, error.message || "Das Thema konnte nicht gespeichert werden.");
              return false;
            }
          },
        },
      ],
    });
  }

  async function deleteTheme(theme) {
    const words = library.getWords(theme.id);
    const ok = await confirmDialog({
      title: "Thema löschen?",
      message: `„${theme.name}“ und ${plural(words.length, "Wort", "Wörter")} werden gelöscht. Der zugehörige Lernfortschritt geht verloren. Ein Standardthema kann durch „Standardlisten wiederherstellen“ zurückkommen.`,
      confirmLabel: "Thema löschen",
      danger: true,
    });
    if (!ok) return;
    const result = await library.deleteTheme(theme.id);
    for (const id of result?.removedWordIds || []) await learner.deleteProgress(id);
    if (state.themeId === theme.id) state.themeId = library.getThemes()[0]?.id || null;
    showToast("Thema gelöscht.", { iconName: "trash" });
    renderPanel();
  }

  function exportThemeCsv(themeId) {
    try {
      const count = transfer.downloadThemeCsv(themeId);
      showToast(`${plural(count, "Wort", "Wörter")} als CSV exportiert.`, {
        type: "success",
        iconName: "download",
      });
    } catch (error) {
      showToast(error.message || "Der Export ist fehlgeschlagen.", { type: "error" });
    }
  }

  /* ---------- Import ---------- */

  function renderImport(panel) {
    const imp = state.import;
    const photo = imp.photo;
    const themes = library.getThemes();
    if (!imp.target) imp.target = themes[0]?.id || "__new__";
    if (!themes.some((theme) => theme.id === imp.target) && imp.target !== "__new__") {
      imp.target = themes[0]?.id || "__new__";
    }
    const analysis = imp.analysis;
    const targetIsNew = imp.target === "__new__";
    const selectedCount = analysis
      ? analysis.entries.filter((entry) => !entry.errors.length && entry.selected !== false).length
      : 0;

    const previewRows = analysis
      ? analysis.entries.slice(0, 100)
          .map((entry, index) => {
            const status = entry.errors.length
              ? `<span class="row-status err">Fehler</span>`
              : entry.duplicateInFile
                ? `<span class="row-status warn">doppelt</span>`
                : entry.existsByGerman && !targetIsNew
                  ? `<span class="row-status warn">vorhanden</span>`
                  : `<span class="row-status ok">neu</span>`;
            return `
              <tr>
                <td class="select-col">
                  <label class="row-check">
                    <input type="checkbox" data-row-select="${index}"
                           ${!entry.errors.length && entry.selected !== false ? "checked" : ""}
                           ${entry.errors.length ? "disabled" : ""}
                           aria-label="Zeile ${entry.line}: ${esc(entry.de)} importieren">
                    <span class="box"></span>
                  </label>
                </td>
                <td>${entry.line}</td>
                <td>${status}</td>
                <td class="row-${entry.errors.length ? "error" : entry.warnings.length ? "warn" : ""}">${esc(entry.de)}</td>
                <td class="row-${entry.errors.length ? "error" : entry.warnings.length ? "warn" : ""}">${esc(entry.en)}</td>
                <td class="tiny">${esc(entry.alternatives.join(" | "))}</td>
                <td class="tiny">${esc(entry.example)}</td>
                <td>${esc(entry.emoji)}</td>
              </tr>`;
          })
          .join("")
      : "";

    panel.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Vokabeln importieren</h2>
            <p>CSV mit Semikolon: deutsch;englisch;alternativen;beispielsatz;emoji</p>
          </div>
        </div>

        <div class="import-tabs" role="tablist" aria-label="Import-Quelle">
          ${[
            ["westermann", "Buch", "menu"],
            ["photo", "Foto", "camera"],
            ["file", "Datei", "download"],
            ["paste", "Einfügen", "pencil"],
            ["url", "URL", "cloud"],
          ]
            .map(
              ([id, label, iconName]) => `
            <button type="button" class="import-tab" role="tab" data-import-source="${id}"
                    aria-selected="${imp.source === id}">${icon(iconName)} ${label}</button>`
            )
            .join("")}
        </div>

        <div class="import-source">
          ${
            imp.source === "westermann"
              ? `
              <div class="westermann-import">
                <div class="callout">
                  ${icon("cloud")}
                  <p class="mb-0"><strong>Westermann-Bücher</strong> laden Wörter, Bilder und Audio aus dem öffentlichen Vokabeltrainer-Katalog. Nutze das nur für Bücher, auf die du Zugriff hast.</p>
                </div>
                <div class="field-row">
                  <div class="field grow">
                    <label for="westermann-query">Buch suchen</label>
                    <input class="input" id="westermann-query" type="search" value="${esc(imp.westermann.query)}" placeholder="z. B. Camden Market 5">
                  </div>
                  <button type="button" class="btn btn-ghost" data-action="westermann-load-catalog" ${imp.westermann.busy ? "disabled" : ""}>
                    ${icon("refresh")} ${imp.westermann.catalog.length ? "Liste aktualisieren" : "Bücher laden"}
                  </button>
                </div>
                ${imp.westermann.error ? `<div class="callout danger">${icon("info")}<p class="mb-0">${esc(imp.westermann.error)}</p></div>` : ""}
                ${imp.westermann.busy ? `<div class="callout" role="status">${icon("refresh")}<p class="mb-0">Westermann-Daten werden geladen …</p></div>` : ""}
                ${(() => {
                  const q = imp.westermann.query.trim().toLowerCase();
                  const items = (imp.westermann.catalog || []).filter((b) => !q || `${b.name} ${b.id}`.toLowerCase().includes(q)).slice(0, 30);
                  if (!imp.westermann.catalog.length) return `<p class="tiny muted mb-0">Noch keine Bücher geladen. Tippe auf „Bücher laden“.</p>`;
                  if (!items.length) return `<p class="tiny muted mb-0">Kein Buch passt zur Suche.</p>`;
                  return `<div class="westermann-book-list">${items.map((b) => `
                    <button type="button" class="westermann-book ${imp.westermann.bookId === b.id ? "is-active" : ""}" data-action="westermann-select-book" data-book-id="${esc(b.id)}">
                      <span class="westermann-book-name">${esc(b.name)}</span>
                      <span class="tiny muted">${esc(b.language || "")} · ${b.vocabCount} Wörter</span>
                    </button>`).join("")}</div>`;
                })()}
                ${imp.westermann.book ? `
                  <div class="westermann-book-detail">
                    <h3>${esc(imp.westermann.book.name)}</h3>
                    <p class="tiny muted">${imp.westermann.book.words.length} Wörter geladen${imp.westermann.book.coverUrl ? " · Bilder/Audio verfügbar" : ""}</p>
                    <div class="field-row">
                      <button type="button" class="btn btn-ghost btn-small" data-action="westermann-all-chapters">Alle Kapitel</button>
                      <button type="button" class="btn btn-ghost btn-small" data-action="westermann-no-chapters">Keine Kapitel</button>
                    </div>
                    <div class="westermann-chapters">
                      ${westermann.groupWordsByChapter(imp.westermann.book).map((g) => {
                        const checked = imp.westermann.selectedChapters.includes(g.id);
                        return `<label class="check-row"><input type="checkbox" data-westermann-chapter="${esc(g.id)}" ${checked ? "checked" : ""}> <span>${esc(g.name)} <span class="tiny muted">(${g.words.length})</span></span></label>`;
                      }).join("")}
                    </div>
                    <div class="btn-row">
                      <button type="button" class="btn" data-action="westermann-apply" ${imp.westermann.busy ? "disabled" : ""}>${icon("download")} Auswahl übernehmen</button>
                    </div>
                  </div>` : ""}
              </div>`
            : imp.source === "photo"
              ? `
              <div class="photo-import">
                <div class="callout" id="photo-provider-status" role="status">
                  ${icon("refresh")}
                  <p class="mb-0">Dienst wird geprüft …</p>
                </div>

                <label class="dropzone photo-dropzone" for="photo-file" tabindex="0">
                  ${icon("camera")}
                  <span>${photo.dataUrl ? "Anderes Foto wählen" : "Foto der Vokabelliste aufnehmen oder auswählen"}</span>
                  <span class="tiny">JPG oder PNG · wird vor dem Senden verkleinert</span>
                  ${photo.fileName ? `<span class="file-name">${esc(photo.fileName)}</span>` : ""}
                </label>
                <input type="file" id="photo-file" accept="image/*" class="sr-only">

                ${photo.busy ? `<div class="callout" role="status">${icon("refresh")}<p class="mb-0">Foto wird gelesen … das kann ein paar Sekunden dauern.</p></div>` : ""}
                ${photo.error ? `<div class="callout danger">${icon("info")}<p class="mb-0">${esc(photo.error)}</p></div>` : ""}

                ${photo.dataUrl ? `<img class="photo-preview" src="${photo.dataUrl}" alt="Vorschau des ausgewählten Fotos">` : ""}

                ${
                  photo.pairs.length
                    ? `<div class="photo-summary">
                         <span class="preview-stat ok">${photo.pairs.length} ${photo.pairs.length === 1 ? "Vorschlag" : "Vorschläge"}</span>
                         <button type="button" class="btn btn-ghost btn-small" data-action="swap-photo">${icon("refresh")} Richtung tauschen</button>
                       </div>`
                    : ""
                }

                ${photo.rawText ? `<details class="provider-help"><summary>Erkannten Text anzeigen</summary><pre class="ocr-text">${esc(photo.rawText)}</pre></details>` : ""}

                <div class="btn-row">
                  <button type="button" class="btn btn-ghost btn-small" data-action="photo-settings">${icon("lock")} Dienst einrichten</button>
                </div>
                <p class="tiny muted mb-0">Tipp: Liste gerade von oben fotografieren, gute Beleuchtung, eine Seite pro Foto. Prüfe die Vorschläge unten und hake nur an, was stimmt.</p>
              </div>`
              : imp.source === "file"
              ? `
              <label class="dropzone" id="csv-dropzone" for="csv-file" tabindex="0">
                ${icon("upload")}
                <span>CSV-Datei hier ablegen oder tippen zum Auswählen</span>
                <span class="tiny">UTF-8, max. 5 MB · Semikolon, Komma oder Tabulator</span>
                ${imp.fileName ? `<span class="file-name">${esc(imp.fileName)}</span>` : ""}
              </label>
              <input type="file" id="csv-file" accept=".csv,.txt,text/csv,text/plain" class="sr-only">`
              : imp.source === "paste"
                ? `
              <div class="field">
                <label for="csv-paste">CSV-Text einfügen (z. B. aus Excel oder Google Sheets)</label>
                <textarea class="textarea" id="csv-paste" rows="8" placeholder="deutsch;englisch;alternativen;beispielsatz;emoji&#10;Hund;dog;doggy;The dog is big.;🐶">${esc(imp.text)}</textarea>
                <span class="hint">Die erste Zeile sollte die Spaltennamen enthalten. Kopiere den Bereich inklusive Kopfzeile.</span>
              </div>
              <button type="button" class="btn" data-action="analyze-paste">${icon("eye")} Vorschau erstellen</button>`
                : `
              <div class="field">
                <label for="csv-url">Link zu einer CSV-Datei</label>
                <input class="input" id="csv-url" type="url" inputmode="url" placeholder="https://example.com/vokabeln.csv" value="${esc(imp.source === "url" && /^https?:\/\//i.test(imp.fileName) ? imp.fileName : "")}">
                <span class="hint">Die Datei muss öffentlich erreichbar sein (CORS erlaubt). Google-Sheets-Exportlinks funktionieren oft.</span>
              </div>
              <button type="button" class="btn" data-action="load-url" ${imp.busy ? "disabled" : ""}>
                ${icon("cloud")} ${imp.busy ? "Lade …" : "Von URL laden"}
              </button>`
          }
        </div>

        ${imp.error ? `<div class="callout danger">${icon("info")}<p class="mb-0">${esc(imp.error)}</p></div>` : ""}

        ${
          analysis
            ? `
          <div class="preview-stats">
            <span class="preview-stat">${plural(analysis.counts.total, "Zeile", "Zeilen")}</span>
            <span class="preview-stat ok">${analysis.counts.valid} gültig</span>
            <span class="preview-stat select-stat" id="import-selected-stat">${selectedCount} ausgewählt</span>
            ${analysis.counts.errors ? `<span class="preview-stat err">${analysis.counts.errors} mit Fehlern</span>` : ""}
            ${analysis.counts.existingRows && !targetIsNew ? `<span class="preview-stat warn">${analysis.counts.existingRows} schon vorhanden</span>` : ""}
            ${analysis.counts.duplicateRows ? `<span class="preview-stat warn">${analysis.counts.duplicateRows} doppelt</span>` : ""}
            <span class="preview-stat">Trenner: ${analysis.delimiter === "\t" ? "Tabulator" : analysis.delimiter === "," ? "Komma" : "Semikolon"}</span>
          </div>

          ${analysis.globalErrors.length
            ? `<div class="callout danger">${icon("info")}<div><strong>Bitte zuerst beheben:</strong><ul class="error-list">${analysis.globalErrors.map((error) => `<li>${esc(error)}</li>`).join("")}</ul></div></div>`
            : ""}
          ${analysis.warnings.length
            ? `<div class="callout warn">${icon("info")}<div><ul class="error-list" style="background:none;border:0;padding-left:20px">${analysis.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></div></div>`
            : ""}

          ${analysis.entries.some((entry) => entry.errors.length)
            ? `<div class="callout danger">${icon("info")}<div><strong>Zeilen mit Fehlern werden übersprungen:</strong>
                 <ul class="error-list">${analysis.entries
                   .filter((entry) => entry.errors.length)
                   .slice(0, 20)
                   .map((entry) => `<li>${entry.errors.map((error) => esc(error)).join(" ")}</li>`)
                   .join("")}</ul></div></div>`
            : ""}

          <div class="preview-table mt-2">
            <table class="data preview">
              <thead><tr>
                <th class="select-col">
                  <label class="row-check">
                    <input type="checkbox" id="import-select-all" ${selectedCount && selectedCount === analysis.counts.valid ? "checked" : ""} aria-label="Alle Zeilen auswählen">
                    <span class="box"></span>
                  </label>
                </th>
                <th>Zeile</th><th>Status</th><th>Deutsch</th><th>Englisch</th><th>Alternativen</th><th>Beispiel</th><th>Emoji</th>
              </tr></thead>
              <tbody>${previewRows}</tbody>
            </table>
          </div>
          ${analysis.entries.length > 100 ? `<p class="scroll-hint">Nur die ersten 100 Zeilen werden angezeigt.</p>` : ""}
        `
            : ""
        }

        <div class="import-options">
          <h3>Ziel</h3>
          <div class="field-row">
            <div class="field">
              <label for="import-target">Thema</label>
              <select class="select" id="import-target">
                ${themes.map((theme) => `<option value="${esc(theme.id)}" ${theme.id === imp.target ? "selected" : ""}>${esc(theme.emoji)} ${esc(theme.name)}</option>`).join("")}
                <option value="__new__" ${targetIsNew ? "selected" : ""}>+ Neues Thema anlegen</option>
              </select>
            </div>
            ${
              targetIsNew
                ? `
              <div class="field">
                <label for="import-new-name">Name des neuen Themas</label>
                <input class="input" id="import-new-name" value="${esc(imp.newName)}" placeholder="z. B. Weltraum">
              </div>
              <div class="field">
                <label for="import-new-emoji">Emoji</label>
                <input class="input" id="import-new-emoji" value="${esc(imp.newEmoji)}" placeholder="🚀">
              </div>`
                : ""
            }
          </div>

          ${
            targetIsNew
              ? `<div class="callout">${icon("info")}<p class="mb-0">Das neue Thema wird angelegt und alle gültigen Zeilen werden hinzugefügt.</p></div>`
              : `
            <fieldset class="fieldset">
              <legend>Was soll passieren?</legend>
              ${IMPORT_MODES.map(
                (mode) => `
                <label class="radio-card">
                  <input type="radio" name="import-mode" value="${mode.id}" ${imp.mode === mode.id ? "checked" : ""}>
                  <span><strong>${esc(mode.title)}</strong><small>${esc(mode.desc)}</small></span>
                </label>`
              ).join("")}
            </fieldset>`
          }

          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-action="apply-import"
                    ${!analysis || analysis.globalErrors.length || !selectedCount || imp.busy ? "disabled" : ""}>
              ${icon("check")} ${analysis ? `${selectedCount} ${selectedCount === 1 ? "Wort" : "Wörter"} importieren` : "Importieren"}
            </button>
            <button type="button" class="btn btn-ghost" data-action="discard-import">Verwerfen</button>
            <button type="button" class="btn-link" data-action="download-template">${icon("download")} CSV-Vorlage herunterladen</button>
          </div>
        </div>
      </div>`;

    /* Quellen-Tabs */
    panel.querySelectorAll("[data-import-source]").forEach((button) => {
      button.addEventListener("click", () => {
        state.import.source = button.dataset.importSource;
        state.import.error = "";
        renderPanel();
      });
    });

    /* Datei */
    const fileInput = panel.querySelector("#csv-file");
    const dropzone = panel.querySelector("#csv-dropzone");
    fileInput?.addEventListener("change", () => {
      if (fileInput.files?.[0]) handleCsvFile(fileInput.files[0]);
    });
    ["dragenter", "dragover"].forEach((type) => {
      dropzone?.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add("is-drag");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      dropzone?.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-drag");
      });
    });
    dropzone?.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) handleCsvFile(file);
    });
    dropzone?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput?.click();
      }
    });

    /* Einfügen */
    panel.querySelector('[data-action="analyze-paste"]')?.addEventListener("click", () => {
      const textarea = panel.querySelector("#csv-paste");
      state.import.text = textarea?.value || "";
      state.import.fileName = "Eingefügter Text";
      analyzeImport();
      renderPanel();
    });

    /* URL */
    panel.querySelector('[data-action="load-url"]')?.addEventListener("click", async () => {
      const input = panel.querySelector("#csv-url");
      const url = input?.value.trim() || "";
      if (!/^https?:\/\//i.test(url)) {
        state.import.error = "Bitte gib einen vollständigen Link ein (beginnend mit https://).";
        renderPanel();
        return;
      }
      state.import.busy = true;
      state.import.error = "";
      renderPanel();
      try {
        const response = await fetch(url, { headers: { Accept: "text/csv,text/plain,*/*" } });
        if (!response.ok) throw new Error(`Der Server antwortet mit ${response.status}.`);
        const text = await response.text();
        state.import.text = text;
        state.import.fileName = url;
        analyzeImport();
      } catch (error) {
        state.import.error =
          `Die Datei konnte nicht geladen werden. ${error.message} ` +
          "Möglicherweise erlaubt der Server den Zugriff nicht (CORS) – lade die Datei dann herunter und nutze „Datei“.";
      } finally {
        state.import.busy = false;
        renderPanel();
      }
    });

    /* Ziel & Modus */
    panel.querySelector("#import-target")?.addEventListener("change", (event) => {
      state.import.target = event.target.value;
      if (state.import.text) analyzeImport();
      renderPanel();
    });
    panel.querySelector("#import-new-name")?.addEventListener("input", (event) => {
      state.import.newName = event.target.value;
    });
    panel.querySelector("#import-new-emoji")?.addEventListener("input", (event) => {
      state.import.newEmoji = event.target.value;
    });
    panel.querySelectorAll('input[name="import-mode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        state.import.mode = radio.value;
      });
    });

    /* Auswahl in der Vorschau */
    panel.querySelectorAll("[data-row-select]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const entry = state.import.analysis?.entries[Number(checkbox.dataset.rowSelect)];
        if (!entry) return;
        entry.selected = checkbox.checked;
        updateImportSelectionUi(panel);
      });
    });
    panel.querySelector("#import-select-all")?.addEventListener("change", (event) => {
      const checked = event.target.checked;
      const analysisNow = state.import.analysis;
      if (!analysisNow) return;
      for (const entry of analysisNow.entries) {
        if (!entry.errors.length) entry.selected = checked;
      }
      // Alle Häkchen und Zähler direkt aktualisieren, ohne neu zu rendern.
      panel.querySelectorAll("[data-row-select]").forEach((box) => {
        const entry = analysisNow.entries[Number(box.dataset.rowSelect)];
        if (entry && !entry.errors.length) box.checked = checked;
      });
      updateImportSelectionUi(panel);
    });

    /* Westermann */
    panel.querySelector('[data-action="westermann-load-catalog"]')?.addEventListener("click", async () => {
      const w = state.import.westermann;
      w.busy = true; w.error = ""; renderPanel();
      try { w.catalog = await westermann.fetchBookCatalog({ language: "" }); }
      catch (e) { w.error = e.message || "Bücherliste konnte nicht geladen werden."; }
      finally { w.busy = false; renderPanel(); }
    });
    panel.querySelector("#westermann-query")?.addEventListener("input", (e) => {
      state.import.westermann.query = e.target.value;
      renderPanel();
      const q = panel.querySelector("#westermann-query");
      if (q) { q.focus(); q.selectionStart = q.selectionEnd = q.value.length; }
    });
    panel.querySelectorAll('[data-action="westermann-select-book"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const w = state.import.westermann;
        w.bookId = btn.dataset.bookId; w.busy = true; w.error = ""; w.book = null; renderPanel();
        try {
          w.book = await westermann.fetchBook(w.bookId);
          w.selectedChapters = westermann.groupWordsByChapter(w.book).map((g) => g.id);
          state.import.newName = w.book.name;
          state.import.newEmoji = "📘";
          state.import.target = "__new__";
        } catch (e) { w.error = e.message || "Buch konnte nicht geladen werden."; }
        finally { w.busy = false; renderPanel(); }
      });
    });
    panel.querySelectorAll("[data-westermann-chapter]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.westermannChapter;
        const set = new Set(state.import.westermann.selectedChapters);
        if (cb.checked) set.add(id); else set.delete(id);
        state.import.westermann.selectedChapters = [...set];
      });
    });
    panel.querySelector('[data-action="westermann-all-chapters"]')?.addEventListener("click", () => {
      const w = state.import.westermann; if (!w.book) return;
      w.selectedChapters = westermann.groupWordsByChapter(w.book).map((g) => g.id); renderPanel();
    });
    panel.querySelector('[data-action="westermann-no-chapters"]')?.addEventListener("click", () => {
      state.import.westermann.selectedChapters = []; renderPanel();
    });
    panel.querySelector('[data-action="westermann-apply"]')?.addEventListener("click", async () => {
      const w = state.import.westermann;
      if (!w.book) return;
      const selected = new Set(w.selectedChapters);
      const groups = westermann.groupWordsByChapter(w.book).filter((g) => selected.has(g.id));
      const rows = groups.flatMap((g) => g.words);
      if (!rows.length) { w.error = "Bitte wähle mindestens ein Kapitel aus."; renderPanel(); return; }

      // Westermann-Import: pro Kapitel ein eigenes Thema anlegen (Kapitelname = Thema).
      const button = panel.querySelector('[data-action="westermann-apply"]');
      setButtonBusy(button, true, "Importiere …");
      try {
        const themeIds = [];
        for (const group of groups) {
          const result = await library.applyImport({
            newTheme: {
              name: group.name || w.book.name,
              emoji: "📘",
              source: {
                type: "westermann-book",
                bookId: w.book.id,
                bookName: w.book.name,
                chapter: group.id,
                chapterName: group.chapterName || group.name,
              },
            },
            rows: group.words.map((row) => ({
              ...row,
              source: {
                type: "westermann-book",
                bookId: w.book.id,
                bookName: w.book.name,
                chapter: group.id,
                chapterName: group.chapterName || group.name,
                section: row.section || "",
                page: row.page || "",
              },
            })),
            mode: "add",
          });
          themeIds.push(result.themeId);
        }
        bus.emit("words:change");
        showToast(`${rows.length} Wörter in ${groups.length} ${groups.length === 1 ? "Thema" : "Themen"} importiert.`, { type: "success", iconName: "check" });
        state.import = freshImportState(themeIds[0] || library.getThemes()[0]?.id);
        state.tab = "words";
        state.wordsThemeId = themeIds[0] || state.wordsThemeId;
        renderPanel();
      } catch (e) {
        w.error = e.message || "Import fehlgeschlagen.";
        renderPanel();
      } finally {
        setButtonBusy(button, false);
      }
    });

    /* Foto */
    const photoInput = panel.querySelector("#photo-file");
    const photoDrop = panel.querySelector(".photo-dropzone");
    photoInput?.addEventListener("change", () => {
      if (photoInput.files?.[0]) handlePhoto(photoInput.files[0]);
    });
    ["dragenter", "dragover"].forEach((type) => {
      photoDrop?.addEventListener(type, (event) => {
        event.preventDefault();
        photoDrop.classList.add("is-drag");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      photoDrop?.addEventListener(type, (event) => {
        event.preventDefault();
        photoDrop.classList.remove("is-drag");
      });
    });
    photoDrop?.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) handlePhoto(file);
    });
    photoDrop?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        photoInput?.click();
      }
    });
    panel.querySelector('[data-action="swap-photo"]')?.addEventListener("click", () => {
      const pairs = state.import.photo.pairs;
      state.import.photo.pairs = pairs.map(({ de, en }) => ({ de: en, en: de }));
      state.import.photo.rawText = state.import.photo.pairs
        .map((pair) => `${pair.de} – ${pair.en}`)
        .join("\n");
      if (state.import.photo.pairs.length) applyPhotoPairs();
      renderPanel();
    });
    panel.querySelector('[data-action="photo-settings"]')?.addEventListener("click", () => {
      state.tab = "settings";
      renderPanel();
      showToast("API-Schlüssel lassen sich unter „Einstellungen“ eintragen.", { type: "info", iconName: "lock" });
    });
    if (imp.source === "photo") hydratePhotoProvider(panel);

    /* Aktionen */
    panel.querySelector('[data-action="apply-import"]')?.addEventListener("click", () => applyImport());
    panel.querySelector('[data-action="discard-import"]')?.addEventListener("click", () => {
      state.import = freshImportState(library.getThemes()[0]?.id);
      renderPanel();
    });
    panel.querySelector('[data-action="download-template"]')?.addEventListener("click", () => {
      transfer.downloadCsvTemplate();
      showToast("CSV-Vorlage heruntergeladen.", { type: "success", iconName: "download" });
    });
  }

  async function handleCsvFile(file) {
    try {
      const text = await readTextFile(file);
      state.import.text = text;
      state.import.fileName = file.name;
      state.import.error = "";
      analyzeImport();
    } catch (error) {
      state.import.error = error.message || "Die Datei konnte nicht gelesen werden.";
    }
    renderPanel();
  }

  function analyzeImport() {
    const imp = state.import;
    imp.analysis = null;
    if (!imp.text.trim()) {
      imp.error = "Die Datei ist leer.";
      return;
    }
    const themeId = imp.target === "__new__" ? null : imp.target;
    try {
      imp.analysis = transfer.analyzeVocabulary(imp.text, { themeId });
      imp.error = "";
    } catch (error) {
      imp.error = error.message || "Die Datei konnte nicht gelesen werden.";
    }
  }

  /** Zähler und Import-Button an die aktuelle Zeilenauswahl anpassen. */
  function updateImportSelectionUi(panel) {
    const imp = state.import;
    const analysis = imp.analysis;
    if (!analysis) return;

    const selectedCount = analysis.entries.filter(
      (entry) => !entry.errors.length && entry.selected !== false
    ).length;

    const stat = panel.querySelector("#import-selected-stat");
    if (stat) stat.textContent = `${selectedCount} ausgewählt`;

    const button = panel.querySelector('[data-action="apply-import"]');
    if (button) {
      button.disabled = !selectedCount || imp.busy || analysis.globalErrors.length > 0;
      button.innerHTML = `${icon("check")} ${selectedCount} ${
        selectedCount === 1 ? "Wort" : "Wörter"
      } importieren`;
    }

    const validCount = analysis.entries.filter((entry) => !entry.errors.length).length;
    const all = panel.querySelector("#import-select-all");
    if (all) {
      all.checked = selectedCount > 0 && selectedCount === validCount;
      all.indeterminate = selectedCount > 0 && selectedCount < validCount;
    }
  }

  /* ---------- Foto-Import ---------- */

  /** Zeigt an, welcher Dienst das Foto lesen würde (oder dass keiner da ist). */
  async function hydratePhotoProvider(panel) {
    const status = panel.querySelector("#photo-provider-status");
    if (!status) return;
    try {
      const providerId = await resolvePhotoProvider(learner.getSettings());
      state.import.photo.provider = providerId || "";
      if (!status.isConnected) return;
      if (providerId) {
        status.className = "callout";
        status.innerHTML = `${icon("cloud")}<p class="mb-0">Foto-Erkennung mit <strong>${esc(
          photoProviderLabel(providerId)
        )}</strong>. Das Bild wird nur zum Lesen gesendet und nicht gespeichert.</p>`;
      } else {
        status.className = "callout warn";
        status.innerHTML = `${icon("info")}<div><p class="mb-0"><strong>Für Fotos ist noch kein Dienst eingerichtet.</strong></p>
          <p class="tiny mb-0">Ein Elternteil kann unter „Einstellungen“ einen API-Schlüssel für Google Cloud Vision (empfohlen) oder Gemini eintragen. Alternativ klappt der Import als CSV-Datei.</p></div>`;
      }
    } catch (error) {
      if (!status.isConnected) return;
      status.className = "callout danger";
      status.innerHTML = `${icon("info")}<p class="mb-0">${esc(
        error.message || "Der Dienst konnte nicht geprüft werden."
      )}</p>`;
    }
  }

  /** Foto lesen, Vorschläge erzeugen und als CSV in die vorhandene Vorschau geben. */
  async function handlePhoto(file) {
    const photo = state.import.photo;
    if (photo.busy) return;
    photo.busy = true;
    photo.error = "";
    photo.dataUrl = "";
    photo.rawText = "";
    photo.pairs = [];
    photo.fileName = file?.name || "Foto";
    state.import.analysis = null;
    state.import.text = "";
    state.import.error = "";
    renderPanel();

    try {
      const settings = learner.getSettings();
      const provider = await resolvePhotoProvider(settings);
      if (!provider) {
        throw new Error(
          "Es ist kein Dienst für Fotos eingerichtet. Ein Elternteil kann unter „Einstellungen“ einen Schlüssel für Google Cloud Vision oder Gemini eintragen."
        );
      }
      const result = await extractVocabularyFromPhoto(file, {
        provider,
        model: settings.handwritingModel,
      });
      photo.provider = provider;
      photo.dataUrl = result.image.dataUrl;
      photo.rawText = result.rawText;
      photo.pairs = result.pairs;
      applyPhotoPairs();
    } catch (error) {
      photo.error = error.message || "Das Foto konnte nicht gelesen werden.";
    } finally {
      photo.busy = false;
      renderPanel();
    }
  }

  /** Übernimmt die aktuellen Foto-Vorschläge in den CSV-Prüfablauf. */
  function applyPhotoPairs() {
    const imp = state.import;
    const pairs = imp.photo.pairs;
    if (!pairs.length) return;
    imp.text = pairsToCsv(pairs);
    imp.fileName = imp.photo.fileName || "Foto";
    analyzeImport();
  }

  async function applyImport() {
    const imp = state.import;
    if (!imp.analysis) return;
    const themeId = imp.target === "__new__" ? null : imp.target;
    const westermannBook = imp.source === "westermann" ? imp.westermann?.book : null;
    const newTheme =
      imp.target === "__new__"
        ? {
            name: imp.newName.trim(),
            emoji: imp.newEmoji.trim(),
            unlockPoints: 0,
            source: westermannBook
              ? { type: "westermann-book", bookId: westermannBook.id, bookName: westermannBook.name }
              : undefined,
          }
        : null;

    if (newTheme && !newTheme.name) {
      imp.error = "Bitte gib einen Namen für das neue Thema ein.";
      renderPanel();
      return;
    }

    imp.busy = true;
    renderPanel();
    try {
      const result = await transfer.applyVocabularyImport(imp.analysis, {
        mode: imp.mode,
        themeId,
        newTheme,
      });

      for (const migration of result.migrations || []) {
        await learner.migrateProgress(migration.from, migration.to);
      }
      for (const removedId of result.removedWordIds || []) {
        await learner.deleteProgress(removedId);
      }

      const summary = [
        result.added ? `${result.added} hinzugefügt` : "",
        result.updated ? `${result.updated} aktualisiert` : "",
        result.skipped ? `${result.skipped} übersprungen` : "",
      ]
        .filter(Boolean)
        .join(", ");

      state.import = freshImportState(result.themeId);
      state.tab = "words";
      state.themeId = result.themeId;
      render();
      showToast(summary || "Import abgeschlossen.", { type: "success", iconName: "check" });
    } catch (error) {
      imp.busy = false;
      imp.error = error.message || "Der Import ist fehlgeschlagen.";
      renderPanel();
    }
  }

  /* ---------- Sichern & Zurücksetzen ---------- */

  function renderBackup(panel) {
    const themes = library.getThemes();
    if (!state.backupThemeId || !library.getTheme(state.backupThemeId)) {
      state.backupThemeId = themes[0]?.id || null;
    }

    panel.innerHTML = `
      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Lokales Backup (ohne Google Drive)</h2>
              <p>Die Alternative zur Cloud-Sicherung: eine Datei mit <strong>allen Vokabellisten</strong>,
              eigenen Themen, allen Profilen, Lernfortschritt, Sitzungen und Einstellungen.
              Kein Konto, kein Internet nötig.</p>
            </div>
            <button type="button" class="btn btn-small" data-action="download-backup">
              ${icon("download")} Backup-Datei herunterladen
            </button>
          </div>
          <p class="tiny mb-0">Dateiname: <code>speakup-backup.json</code></p>
          <div class="callout success">
            ${icon("lock")}
            <p class="mb-0"><strong>Alles bleibt lokal.</strong> Die Datei wird nur auf diesem Gerät erzeugt.
            Sie enthält bewusst <em>keine</em> Mikrofon- oder Handschrift-Einwilligung,
            <em>keine</em> API-Schlüssel und <em>keine</em> Google-Client-ID.</p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Lokales Backup wiederherstellen</h2>
              <p>Alternative zum Cloud-Laden: Ersetzt Vokabellisten, Profile und Fortschritt durch den Stand aus <code>speakup-backup.json</code>.</p>
            </div>
          </div>
          <label class="dropzone" for="backup-file" tabindex="0">
            ${icon("upload")}
            <span>speakup-backup.json auswählen (lokale Datei)</span>
            <span class="tiny">Nach dem Einlesen wird die App neu geladen.</span>
          </label>
          <input type="file" id="backup-file" accept=".json,application/json" class="sr-only">
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>CSV exportieren</h2>
              <p>Pro Thema eine Datei – perfekt zum Bearbeiten in Excel oder Google Sheets.</p>
            </div>
          </div>
          <div class="toolbar">
            <label class="sr-only" for="backup-theme">Thema für CSV-Export</label>
            <select class="select" id="backup-theme" style="max-width:280px">
              ${themes.map((theme) => `<option value="${esc(theme.id)}" ${theme.id === state.backupThemeId ? "selected" : ""}>${esc(theme.emoji)} ${esc(theme.name)} (${library.getWords(theme.id).length})</option>`).join("")}
            </select>
            <button type="button" class="btn btn-soft btn-small" data-action="export-csv">${icon("download")} Thema als CSV</button>
            <button type="button" class="btn-link" data-action="download-template">${icon("download")} Leere Vorlage</button>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Zurücksetzen</h2>
              <p>Bitte vorsichtig verwenden – Aktionen lassen sich nicht rückgängig machen.</p>
            </div>
          </div>
          <div class="settings-list">
            <div class="setting-row">
              <div class="setting-text">
                <strong>Standardlisten wiederherstellen</strong>
                <small>Eigene Wörter und Themen werden verworfen. Der Fortschritt bleibt, wo die IDs gleich sind.</small>
              </div>
              <button type="button" class="btn btn-ghost btn-small" data-action="reset-library">Wiederherstellen</button>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <strong>Lernfortschritt zurücksetzen</strong>
                <small>Punkte, Level, Abzeichen, Serien und Boxen werden gelöscht. Wörter bleiben erhalten.</small>
              </div>
              <button type="button" class="btn btn-ghost btn-small" data-action="reset-progress">Zurücksetzen</button>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <strong>Alle Daten löschen</strong>
                <small>Löscht Wörter, Fortschritt, Einstellungen und Einwilligung. Danach startet SpeakUp wie neu.</small>
              </div>
              <button type="button" class="btn btn-danger btn-small" data-action="wipe-all">Alles löschen</button>
            </div>
          </div>
        </div>

        <div class="callout">
          ${icon("info")}
          <p class="mb-0">Tipp: Erstelle vor größeren Änderungen ein lokales Backup. Die Datei heißt
          <code>speakup-backup.json</code>; sie ist die Alternative zur Google-Drive-Sicherung und
          lässt sich auf ein anderes Gerät kopieren.</p>
        </div>
      </div>`;

    panel.querySelector('[data-action="download-backup"]')?.addEventListener("click", async () => {
      try {
        await transfer.downloadBackup();
        showToast("Lokales Backup heruntergeladen.", { type: "success", iconName: "download" });
      } catch (error) {
        showToast(error.message || "Das Backup konnte nicht erstellt werden.", { type: "error" });
      }
    });

    const backupInput = panel.querySelector("#backup-file");
    backupInput?.addEventListener("change", () => {
      if (backupInput.files?.[0]) restoreFromFile(backupInput.files[0]);
    });
    panel.querySelector('label[for="backup-file"]')?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        backupInput?.click();
      }
    });

    panel.querySelector("#backup-theme")?.addEventListener("change", (event) => {
      state.backupThemeId = event.target.value;
    });
    panel.querySelector('[data-action="export-csv"]')?.addEventListener("click", () => {
      if (state.backupThemeId) exportThemeCsv(state.backupThemeId);
    });
    panel.querySelector('[data-action="download-template"]')?.addEventListener("click", () => {
      transfer.downloadCsvTemplate();
      showToast("CSV-Vorlage heruntergeladen.", { type: "success", iconName: "download" });
    });

    panel.querySelector('[data-action="reset-library"]')?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Standardlisten wiederherstellen?",
        message: "Eigene Wörter und Themen werden gelöscht. Der Lernfortschritt bleibt bei Wörtern erhalten, die es weiterhin gibt.",
        confirmLabel: "Wiederherstellen",
        danger: true,
      });
      if (!ok) return;
      try {
        const result = await library.resetToDefaults();
        await learner.pruneProgress(library.getAllWords().map((word) => word.id));
        for (const removed of result.removedWordIds) await learner.deleteProgress(removed);
        state.themeId = library.getThemes()[0]?.id || null;
        state.backupThemeId = state.themeId;
        showToast("Standardlisten wiederhergestellt.", { type: "success", iconName: "check" });
        renderPanel();
      } catch (error) {
        showToast(error.message || "Die Standardlisten konnten nicht geladen werden.", { type: "error" });
      }
    });

    panel.querySelector('[data-action="reset-progress"]')?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Lernfortschritt zurücksetzen?",
        message: "Punkte, Level, Abzeichen, Tages-Serie und alle Wiederholungs-Boxen werden gelöscht. Die Vokabeln bleiben erhalten.",
        confirmLabel: "Fortschritt löschen",
        danger: true,
      });
      if (!ok) return;
      await learner.resetProgress();
      await learner.reloadSessions();
      showToast("Lernfortschritt zurückgesetzt.", { type: "success", iconName: "refresh" });
      renderPanel();
    });

    panel.querySelector('[data-action="wipe-all"]')?.addEventListener("click", async () => {
      const first = await confirmDialog({
        title: "Wirklich alle Daten löschen?",
        message: "Wörter, Themen, Fortschritt, Einstellungen und die Einwilligung werden unwiderruflich gelöscht.",
        confirmLabel: "Weiter",
        danger: true,
      });
      if (!first) return;
      const second = await confirmDialog({
        title: "Letzte Warnung",
        message: "Möchtest du wirklich alles löschen? Ein Backup kannst du vorher über „Backup erstellen“ sichern.",
        confirmLabel: "Ja, alles löschen",
        danger: true,
      });
      if (!second) return;
      try {
        await db.clearAll();
        try {
          storeUnlock(false);
        } catch {
          /* ignorieren */
        }
        showToast("Alle Daten gelöscht. SpeakUp startet neu.", { iconName: "trash" });
        setTimeout(() => window.location.reload(), 700);
      } catch (error) {
        showToast(error.message || "Die Daten konnten nicht gelöscht werden.", { type: "error" });
      }
    });
  }

  async function restoreFromFile(file) {
    try {
      const text = await readTextFile(file, 20 * 1024 * 1024);
      const check = transfer.validateBackup(text);
      if (!check.valid) {
        showToast(check.error, { type: "error", iconName: "info" });
        return;
      }
      const data = check.backup.data;
      const ok = await confirmDialog({
        title: "Backup wiederherstellen?",
        message:
          `Das Backup enthält ${plural(data.library.themes.length, "Thema", "Themen")}, ` +
          `${plural(data.library.words.length, "Wort", "Wörter")} und ` +
          `${plural(data.progress?.length || 0, "Fortschrittseintrag", "Fortschrittseinträge")}. ` +
          "Die aktuellen Daten werden ersetzt.",
        confirmLabel: "Wiederherstellen",
        danger: true,
      });
      if (!ok) return;
      await transfer.restoreBackup(check.backup);
      showToast("Backup eingespielt. Die App wird neu geladen …", { type: "success", iconName: "check" });
      setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      showToast(error.message || "Das Backup konnte nicht wiederhergestellt werden.", { type: "error" });
    }
  }

  /* ---------- Fortschritt ---------- */

  function renderStats(panel) {
    const allWords = library.getAllWords();
    const progress = learner.getProgressMap();
    const profile = learner.getProfile();
    const boxes = learner.getBoxCounts();
    const query = state.statsSearch.trim().toLowerCase();

    const rows = allWords
      .map((word) => {
        const theme = library.getTheme(word.themeId);
        const record = progress.get(word.id);
        return {
          word,
          theme,
          record,
          seen: record?.seen || 0,
          correct: record?.correct || 0,
          wrong: record?.wrong || 0,
          box: record?.box || 1,
          accuracy: record?.seen ? record.correct / record.seen : -1,
          lastSeen: record?.lastSeen || 0,
          speakSeen: record?.speakSeen || 0,
          speakCorrect: record?.speakCorrect || 0,
          writeSeen: record?.writeSeen || 0,
          writeCorrect: record?.writeCorrect || 0,
        };
      })
      .filter((row) => {
        if (!query) return true;
        return `${row.word.de} ${row.word.en} ${row.theme?.name || ""}`.toLowerCase().includes(query);
      });

    const sorters = {
      wrong: (a, b) =>
        (a.seen ? 0 : 1) - (b.seen ? 0 : 1) ||
        b.wrong - a.wrong ||
        a.accuracy - b.accuracy ||
        a.word.de.localeCompare(b.word.de, "de"),
      box: (a, b) => (a.seen ? 0 : 1) - (b.seen ? 0 : 1) || a.box - b.box || b.wrong - a.wrong,
      az: (a, b) => a.word.de.localeCompare(b.word.de, "de"),
      accuracy: (a, b) => (a.seen ? 0 : 1) - (b.seen ? 0 : 1) || a.accuracy - b.accuracy,
    };
    rows.sort(sorters[state.statsSort] || sorters.wrong);

    const started = rows.filter((row) => row.seen > 0).length;
    const mastered = [...progress.values()].filter((record) => learner.isMastered(record)).length;
    const seenTotal = Object.values(boxes).reduce((sum, value) => sum + value, 0);

    panel.innerHTML = `
      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Lernstand</h2>
              <p>${plural(allWords.length, "Wort", "Wörter")} · ${mastered} gemeistert · ${profile.points} Punkte</p>
            </div>
            <button type="button" class="btn btn-ghost btn-small" data-action="reset-progress">${icon("refresh")} Fortschritt zurücksetzen</button>
          </div>

          <div class="stat-grid">
            <div class="stat-card"><span class="stat-icon">${icon("chart")}</span><strong>${started}</strong><span>Wörter angefangen</span></div>
            <div class="stat-card"><span class="stat-icon">${icon("star")}</span><strong>${mastered}</strong><span>gemeistert</span></div>
            <div class="stat-card"><span class="stat-icon">${icon("mic")}</span><strong>${profile.speakCorrect || 0}</strong><span>richtig gesprochen</span></div>
            <div class="stat-card"><span class="stat-icon">${icon("pencil")}</span><strong>${profile.writeCorrect || 0}</strong><span>richtig geschrieben</span></div>
          </div>

          <div class="toolbar mt-3">
            <label class="sr-only" for="stats-search">Wörter durchsuchen</label>
            <input class="input" id="stats-search" type="search" placeholder="Wort oder Thema suchen …"
                   value="${esc(state.statsSearch)}" style="max-width:260px">
            <label class="sr-only" for="stats-sort">Sortierung</label>
            <select class="select" id="stats-sort" style="max-width:220px">
              <option value="wrong" ${state.statsSort === "wrong" ? "selected" : ""}>Meiste Fehler zuerst</option>
              <option value="box" ${state.statsSort === "box" ? "selected" : ""}>Niedrigste Box zuerst</option>
              <option value="accuracy" ${state.statsSort === "accuracy" ? "selected" : ""}>Schwächste Quote</option>
              <option value="az" ${state.statsSort === "az" ? "selected" : ""}>Alphabetisch</option>
            </select>
            <span class="spacer"></span>
            <span class="tiny muted">${rows.length} Einträge</span>
          </div>

          ${
            rows.length
              ? `<div class="table-wrap">
                  <table class="data">
                    <thead><tr>
                      <th scope="col">Wort</th><th scope="col">Thema</th><th scope="col">Box</th>
                      <th scope="col">Sprechen</th><th scope="col">Schreiben</th><th scope="col">Quote</th><th scope="col">Zuletzt</th><th scope="col">Aktion</th>
                    </tr></thead>
                    <tbody>
                      ${rows
                        .map((row) => {
                          const accuracy = row.seen ? `${Math.round(row.accuracy * 100)} %` : "–";
                          return `
                          <tr data-search="${esc(`${stripRichText(row.word.de)} ${stripRichText(row.word.en)} ${row.theme?.name || ""}`.toLowerCase())}">
                            <td><strong>${sanitizeRichText(row.word.de)}</strong><div class="tiny muted">${sanitizeRichText(row.word.en)}</div></td>
                            <td class="tiny">${esc(row.theme?.emoji || "")} ${esc(row.theme?.name || "–")}</td>
                            <td><span class="preview-stat">${row.seen ? row.box : "neu"}</span></td>
                            <td class="tiny">${row.speakCorrect}/${row.speakSeen}</td>
                            <td class="tiny">${row.writeCorrect}/${row.writeSeen}</td>
                            <td class="bold">${accuracy}</td>
                            <td class="tiny muted">${row.lastSeen ? esc(formatDate(row.lastSeen)) : "–"}</td>
                            <td class="actions">
                              <button type="button" class="icon-btn tiny-btn" data-stat-speak="${esc(stripRichText(row.word.en))}" aria-label="Wort vorlesen">${icon("speaker")}</button>
                              <button type="button" class="icon-btn tiny-btn" data-stat-reset="${esc(row.word.id)}" aria-label="Fortschritt dieses Wortes löschen" ${row.seen ? "" : "disabled"}>${icon("refresh")}</button>
                            </td>
                          </tr>`;
                        })
                        .join("")}
                    </tbody>
                  </table>
                </div>
                <p class="scroll-hint">Quote = richtige Antworten geteilt durch alle Versuche.</p>`
              : `<div class="table-empty">Keine Wörter gefunden.</div>`
          }
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>Wiederholungs-Boxen</h2><p>${seenTotal} Wörter im System</p></div></div>
          <div class="box-chart">
            ${[1, 2, 3, 4, 5]
              .map((box) => {
                const count = boxes[box] || 0;
                const percent = seenTotal ? Math.round((count / seenTotal) * 100) : 0;
                return `
                <div class="box-row">
                  <span class="box-label"><span class="box-chip">${box}</span> ${esc(learner.LEITNER_LABELS[box])}</span>
                  <span class="box-bar"><span style="width:${percent}%"></span></span>
                  <span class="tiny bold muted">${count}</span>
                </div>`;
              })
              .join("")}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>Rundenverlauf</h2><p>Die letzten 12 Runden</p></div></div>
          <div id="parent-history" class="history-list"><div class="table-empty">Wird geladen …</div></div>
          <div class="btn-row mt-2">
            <button type="button" class="btn btn-ghost btn-small" data-action="clear-history">${icon("trash")} Verlauf löschen</button>
          </div>
        </div>
      </div>`;

    panel.querySelector("#stats-search")?.addEventListener("input", (event) => {
      state.statsSearch = event.target.value;
      const search = state.statsSearch.trim().toLowerCase();
      panel.querySelectorAll("tbody tr[data-search]").forEach((row) => {
        row.hidden = Boolean(search) && !row.dataset.search.includes(search);
      });
    });

    panel.querySelector("#stats-sort")?.addEventListener("change", (event) => {
      state.statsSort = event.target.value;
      renderPanel();
    });

    panel.querySelectorAll("[data-stat-speak]").forEach((button) => {
      button.addEventListener("click", () => {
        unlockTts();
        speak(button.dataset.statSpeak, { rate: learner.getSettings().speechRate || 0.9 });
      });
    });

    panel.querySelectorAll("[data-stat-reset]").forEach((button) => {
      button.addEventListener("click", async () => {
        const word = library.getWord(button.dataset.statReset);
        if (!word) return;
        const ok = await confirmDialog({
          title: "Fortschritt löschen?",
          message: `Der Lernstand von „${word.de} / ${word.en}“ wird gelöscht. Das Wort selbst bleibt erhalten.`,
          confirmLabel: "Löschen",
          danger: true,
        });
        if (!ok) return;
        await learner.deleteProgress(word.id);
        showToast("Fortschritt für dieses Wort gelöscht.", { iconName: "refresh" });
        renderPanel();
      });
    });

    panel.querySelector('[data-action="reset-progress"]')?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Gesamten Fortschritt zurücksetzen?",
        message: "Punkte, Level, Abzeichen, Serie und alle Boxen werden gelöscht. Wörter und Themen bleiben erhalten.",
        confirmLabel: "Zurücksetzen",
        danger: true,
      });
      if (!ok) return;
      await learner.resetProgress();
      await learner.reloadSessions();
      showToast("Fortschritt zurückgesetzt.", { type: "success", iconName: "refresh" });
      renderPanel();
    });

    panel.querySelector('[data-action="clear-history"]')?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Verlauf löschen?",
        message: "Nur die Liste der letzten Runden wird gelöscht. Punkte und Abzeichen bleiben erhalten.",
        confirmLabel: "Verlauf löschen",
        danger: true,
      });
      if (!ok) return;
      await db.sessionsClear();
      await learner.reloadSessions();
      showToast("Verlauf gelöscht.", { iconName: "trash" });
      renderPanel();
    });

    let aliveHistory = true;
    learner
      .getSessions()
      .then((sessions) => {
        if (!aliveHistory) return;
        const list = panel.querySelector("#parent-history");
        if (!list) return;
        if (!sessions.length) {
          list.innerHTML = `<div class="table-empty">Noch keine Runde abgeschlossen.</div>`;
          return;
        }
        list.innerHTML = sessions
          .slice(0, 12)
          .map((session) => {
            const theme = session.themeId ? library.getTheme(session.themeId) : null;
            const accuracy = session.attempts ? Math.round((session.firstTryCorrect / (session.totalWords || 1)) * 100) : null;
            return `
              <div class="history-row">
                <span class="history-emoji" aria-hidden="true">${esc(theme?.emoji || "🌈")}</span>
                <div class="history-main">
                  <strong>${esc(theme?.name || "Alle Themen")} · ${esc(MODE_LABELS[session.mode] || "Mix")}</strong>
                  <small>${esc(formatDate(session.at))} · ${plural(session.totalWords || 0, "Wort", "Wörter")} ·
                  ${session.firstTryCorrect ?? "–"} beim ersten Versuch · ${esc(formatDuration(session.durationMs))}</small>
                </div>
                <span class="history-points">+${session.points || 0}</span>
              </div>`;
          })
          .join("");
      })
      .catch(() => {
        const list = panel.querySelector("#parent-history");
        if (list) list.innerHTML = `<div class="table-empty">Der Verlauf konnte nicht geladen werden.</div>`;
      });
  }

  /* ---------- Einstellungen ---------- */

  /**
   * Erklärt den gewählten Handschrift-Anbieter und blendet Schlüssel-Felder ein.
   * Der Schlüssel selbst wird nie vorausgefüllt, nur sein Status.
   */
  function providerConfigMarkup(settings) {
    const provider = settings.handwritingProvider || "google-input-tools";

    if (provider === "off") {
      return `<div class="callout">
        ${icon("keyboard")}
        <p class="mb-0">Handschrift ist aus. Dein Kind übt mit Tastatur und Vorlesen – es werden keine Schreibbilder gesendet.</p>
      </div>`;
    }

    if (provider === "google-input-tools") {
      return `<div class="callout warn">
        ${icon("info")}
        <div>
          <p class="mb-1"><strong>Ohne Einrichtung, aber unzuverlässig.</strong></p>
          <p class="mb-0 small">Dieser Dienst ist nicht offiziell dokumentiert. In Tests erkannte er einfache Druckbuchstaben oft falsch. Für verlässliche Treffer empfehlen wir Google Cloud Vision – dort sind 1.000 Bilder pro Monat kostenlos.</p>
        </div>
      </div>`;
    }

    const isVision = provider === "google-vision";
    const info = PROVIDER_INFO[provider] || {};
    const id = isVision ? "google-vision" : "gemini";
    const intro = isVision
      ? `<p class="mb-1"><strong>Sehr genaue Handschrift- und Foto-Erkennung.</strong></p>
         <p class="mb-0 small">Ein Bild der Schrift oder ein Foto einer Vokabelliste geht an Google Cloud Vision. 1.000 Einheiten pro Monat sind kostenlos; erst danach wird es kostenpflichtig – vorausgesetzt, im Google-Projekt ist ein Abrechnungskonto hinterlegt. Fotos werden nicht gespeichert.</p>`
      : `<p class="mb-1"><strong>KI-Transkription mit kostenlosem Kontingent.</strong></p>
         <p class="mb-0 small">Ein Bild der Schrift oder ein Foto einer Vokabelliste geht an Google Gemini. Im kostenlosen Tarif darf Google die Inhalte zum Verbessern der Produkte verwenden – hier sind das nur einzelne Vokabel-Bilder. Ein KI-Modell kann sich außerdem verlesen. Fotos werden nicht gespeichert.</p>`;

    return `
      <div class="provider-config">
        <div class="callout ${isVision ? "success" : "warn"}">
          ${icon(isVision ? "cloud" : "info")}
          <div>${intro}</div>
        </div>

        <div class="field">
          <label class="small bold" for="key-input-${id}">API-Schlüssel</label>
          <div class="key-row">
            <input class="input" id="key-input-${id}" data-key-input="${id}"
                   type="password" autocomplete="off" spellcheck="false"
                   placeholder="Schlüssel einfügen …" aria-describedby="key-status-${id}">
            <button type="button" class="btn btn-ghost btn-small" data-key-toggle="${id}" aria-pressed="false">
              ${icon("eye")} Zeigen
            </button>
          </div>
          <p class="tiny muted mb-0" id="key-status-${id}" data-key-status="${id}" role="status">wird geprüft …</p>
        </div>

        ${
          isVision
            ? ""
            : `<div class="field">
                 <label class="small bold" for="model-input-gemini">Gemini-Modell (Handschrift &amp; Foto)</label>
                 <input class="input" id="model-input-gemini" data-model-input="gemini" type="text"
                        spellcheck="false" autocomplete="off"
                        value="${esc(settings.handwritingModel || "gemini-3.5-flash-lite")}">
                 <p class="tiny muted mb-0">Muss ein Gemini-Modell sein, das Bilder versteht. Wird beim Verlassen des Feldes gespeichert. (Spracheingabe nutzt ggf. ein eigenes Modell.)</p>
               </div>`
        }

        <div class="btn-row">
          <button type="button" class="btn btn-small" data-key-save="${id}">${icon("check")} Schlüssel speichern</button>
          <button type="button" class="btn btn-soft btn-small" data-key-test="${id}">${icon("refresh")} Verbindung testen</button>
          <button type="button" class="btn btn-ghost btn-small" data-key-clear="${id}">${icon("trash")} Entfernen</button>
        </div>

        <details class="provider-help">
          <summary>Einrichtung, Kosten &amp; Datenschutz</summary>
          <ol class="small">
            ${
              isVision
                ? `<li>Im Google-Cloud-Projekt die <a href="${info.docsUrl}" target="_blank" rel="noopener noreferrer">Cloud Vision API aktivieren</a>.</li>
                   <li>Unter „Anmeldedaten“ einen <a href="${info.keyUrl}" target="_blank" rel="noopener noreferrer">API-Schlüssel</a> erstellen.</li>
                   <li>Den Schlüssel einschränken: API „Cloud Vision API“ und – wenn möglich – HTTP-Referrer eurer SpeakUp-Adresse.</li>
                   <li>Schlüssel hier einfügen, speichern und „Verbindung testen“ wählen.</li>
                   <li>Gratis-Kontingent und Grenzen stehen in den <a href="${info.quotaUrl}" target="_blank" rel="noopener noreferrer">Vision-Kontingenten</a>.</li>`
                : `<li>In Google AI Studio einen <a href="${info.keyUrl}" target="_blank" rel="noopener noreferrer">API-Schlüssel</a> erstellen.</li>
                   <li>Free-Tier-Limits und Preise in der <a href="${info.quotaUrl}" target="_blank" rel="noopener noreferrer">Gemini-Dokumentation</a> prüfen.</li>
                   <li>Schlüssel speichern, Modell prüfen und „Verbindung testen“ wählen.</li>
                   <li>Im kostenlosen Tarif dürfen Eingaben zum Verbessern von Google-Produkten verwendet werden. Wer das nicht möchte, nutzt Google Vision (kostenpflichtiges Konto nötig) oder tippt.</li>`
            }
          </ol>
          <p class="tiny muted mb-0">
            Der Schlüssel liegt nur auf diesem Gerät, ist für jeden mit Gerätezugriff lesbar
            und wird <strong>nicht</strong> ins Backup geschrieben. Für eine Veröffentlichung
            mit vielen Kindern ist ein eigener Server dazwischen die sicherere Variante.
          </p>
        </details>
      </div>`;
  }

  function speechProviderConfigMarkup(settings) {
    const provider = settings.speechProvider || "browser";
    const info = PROVIDER_INFO.gemini || {};
    if (provider !== "gemini") {
      return `<div class="callout">
        ${icon("mic")}
        <div>
          <p class="mb-1"><strong>Browser-Spracherkennung (Standard).</strong></p>
          <p class="mb-0 small">Die Aufnahme geht zur Erkennung an den Dienst des Browser-Herstellers (z. B. Google bei Chrome). Das braucht Internet, eine sichere Verbindung und je nach Browser passende Unterstützung. In Firefox funktioniert es nicht – dann bitte tippen oder Gemini als Alternative wählen.</p>
        </div>
      </div>`;
    }

    return `
      <div class="provider-config">
        <div class="callout warn">
          ${icon("info")}
          <div>
            <p class="mb-1"><strong>Gemini als Alternative zur Browser-Spracherkennung.</strong></p>
            <p class="mb-0 small">Die Sprache wird lokal aufgenommen. Nach dem Stoppen (nochmal tippen) wird die Audiodatei einmalig an Google Gemini zur Erkennung gesendet – es gibt kein Live-Zwischenergebnis. Benötigt Internet, Einwilligung und einen Gemini-API-Schlüssel. Im kostenlosen Tarif darf Google Inhalte zum Verbessern der Produkte verwenden.</p>
          </div>
        </div>

        <div class="field">
          <label class="small bold" for="key-input-gemini-speech">Gemini-API-Schlüssel</label>
          <div class="key-row">
            <input class="input" id="key-input-gemini-speech" data-key-input="gemini" data-key-scope="speech"
                   type="password" autocomplete="off" spellcheck="false"
                   placeholder="Schlüssel einfügen …" aria-describedby="key-status-gemini-speech">
            <button type="button" class="btn btn-ghost btn-small" data-key-toggle="gemini" data-key-scope="speech" aria-pressed="false">
              ${icon("eye")} Zeigen
            </button>
          </div>
          <p class="tiny muted mb-0" id="key-status-gemini-speech" data-key-status="gemini" data-key-scope="speech" role="status">wird geprüft …</p>
        </div>

        <div class="field">
          <label class="small bold" for="model-input-gemini-speech">Gemini-Modell (Sprache)</label>
          <input class="input" id="model-input-gemini-speech" data-model-input="gemini-speech" type="text"
                 spellcheck="false" autocomplete="off"
                 value="${esc(settings.speechModel || "gemini-3.5-flash-lite")}">
          <p class="tiny muted mb-0">Muss ein Gemini-Modell sein, das Audio versteht. Wird beim Verlassen des Feldes gespeichert. Derselbe Schlüssel wie für Handschrift/Foto/Gemini kann verwendet werden.</p>
        </div>

        <div class="btn-row">
          <button type="button" class="btn btn-small" data-key-save="gemini" data-key-scope="speech">${icon("check")} Schlüssel speichern</button>
          <button type="button" class="btn btn-soft btn-small" data-key-test="gemini" data-key-scope="speech">${icon("refresh")} Verbindung testen</button>
          <button type="button" class="btn btn-ghost btn-small" data-key-clear="gemini" data-key-scope="speech">${icon("trash")} Entfernen</button>
        </div>

        <details class="provider-help">
          <summary>Einrichtung, Kosten &amp; Datenschutz</summary>
          <ol class="small">
            <li>In Google AI Studio einen <a href="${info.keyUrl || "https://aistudio.google.com/apikey"}" target="_blank" rel="noopener noreferrer">API-Schlüssel</a> erstellen.</li>
            <li>Free-Tier-Limits und Preise in der <a href="${info.quotaUrl || "https://ai.google.dev/pricing"}" target="_blank" rel="noopener noreferrer">Gemini-Dokumentation</a> prüfen.</li>
            <li>Schlüssel speichern, Modell prüfen und „Verbindung testen“ wählen.</li>
            <li>Im kostenlosen Tarif dürfen Eingaben zum Verbessern von Google-Produkten verwendet werden. Die Aufnahme wird nur zur Erkennung gesendet und nicht von SpeakUp gespeichert.</li>
          </ol>
          <p class="tiny muted mb-0">
            Der Schlüssel liegt nur auf diesem Gerät, ist für jeden mit Gerätezugriff lesbar
            und wird <strong>nicht</strong> ins Backup geschrieben.
          </p>
        </details>
      </div>`;
  }

  async function hydrateProviderConfig(panel) {
    const settings = learner.getSettings();
    const provider = settings.handwritingProvider || "google-input-tools";
    if (!isCloudProvider(provider)) return;
    const status = panel.querySelector(`[data-key-status="${provider}"]:not([data-key-scope="speech"])`);
    if (!status) return;
    const key = await getApiKey(provider);
    if (!status.isConnected) return;
    status.textContent = key
      ? "Ein Schlüssel ist gespeichert – nur auf diesem Gerät, nicht im Backup."
      : "Noch kein Schlüssel gespeichert – die Erkennung bleibt so lange aus.";
    status.classList.toggle("is-ok", Boolean(key));
  }

  async function hydrateSpeechProviderConfig(panel) {
    const settings = learner.getSettings();
    if ((settings.speechProvider || "browser") !== "gemini") return;
    const status = panel.querySelector('[data-key-status="gemini"][data-key-scope="speech"]');
    if (!status) return;
    const key = await getApiKey("gemini");
    if (!status.isConnected) return;
    status.textContent = key
      ? "Ein Gemini-Schlüssel ist gespeichert – nur auf diesem Gerät, nicht im Backup."
      : "Noch kein Gemini-Schlüssel gespeichert – die Spracheingabe mit Gemini bleibt so lange aus.";
    status.classList.toggle("is-ok", Boolean(key));
  }

  function bindProviderConfig(panel) {
    const settings = learner.getSettings();
    const provider = settings.handwritingProvider || "google-input-tools";

    panel.querySelector("#set-handwriting-provider")?.addEventListener("change", async (event) => {
      const value = event.target.value;
      await learner.updateSettings({
        handwritingProvider: value,
        handwriting: value !== "off",
      });
      renderPanel();
      showToast(
        value === "off"
          ? "Handschrift ist aus – es wird getippt."
          : `Handschrift-Anbieter: ${PROVIDER_INFO[value]?.label || value}.`,
        { iconName: "pencil" }
      );
    });

    if (!isCloudProvider(provider)) return;
    const scopeSel = ':not([data-key-scope="speech"])';

    panel.querySelector(`[data-key-toggle="${provider}"]${scopeSel}`)?.addEventListener("click", (event) => {
      const input = panel.querySelector(`[data-key-input="${provider}"]${scopeSel}`);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      event.currentTarget.setAttribute("aria-pressed", String(show));
      event.currentTarget.innerHTML = `${icon("eye")} ${show ? "Verbergen" : "Zeigen"}`;
    });

    panel.querySelector(`[data-key-save="${provider}"]${scopeSel}`)?.addEventListener("click", async () => {
      const input = panel.querySelector(`[data-key-input="${provider}"]${scopeSel}`);
      const value = input?.value.trim() || "";
      if (!value) {
        input?.focus();
        showToast("Bitte zuerst einen API-Schlüssel einfügen.", { type: "warn", iconName: "info" });
        return;
      }
      await setApiKey(provider, value);
      input.value = "";
      await hydrateProviderConfig(panel);
      await hydrateSpeechProviderConfig(panel);
      showToast("Schlüssel gespeichert. Er bleibt auf diesem Gerät und ist nicht im Backup.", {
        type: "success",
        iconName: "check",
      });
    });

    panel.querySelector(`[data-key-clear="${provider}"]${scopeSel}`)?.addEventListener("click", async () => {
      const confirmed = await confirmDialog({
        title: "Schlüssel entfernen?",
        message: provider === "gemini"
          ? "Spracheingabe mit Gemini, Handschrift mit Gemini und Foto-Import mit Gemini funktionieren danach nicht mehr, bis ein neuer Schlüssel gespeichert wird. Tippen funktioniert weiterhin."
          : "Die Handschrifterkennung ist danach aus, bis ein neuer Schlüssel gespeichert wird. Tippen funktioniert weiterhin.",
        confirmLabel: "Entfernen",
        danger: true,
      });
      if (!confirmed) return;
      await clearApiKey(provider);
      await hydrateProviderConfig(panel);
      await hydrateSpeechProviderConfig(panel);
      showToast(provider === "gemini" ? "Gemini-API-Schlüssel entfernt." : "API-Schlüssel entfernt.", { iconName: "trash" });
    });

    panel.querySelector(`[data-key-test="${provider}"]${scopeSel}`)?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const original = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `${icon("refresh")} Prüfe …`;
      const status = panel.querySelector(`[data-key-status="${provider}"]${scopeSel}`);
      const model =
        panel.querySelector('[data-model-input="gemini"]')?.value.trim() ||
        learner.getSettings().handwritingModel;
      try {
        const message = await testCloudProvider(provider, { model });
        showToast(message, { type: "success", iconName: "check" });
        if (status) {
          status.textContent = message;
          status.classList.add("is-ok");
        }
      } catch (error) {
        const message = error?.message || "Der Verbindungstest ist fehlgeschlagen.";
        showToast(message, { type: "warn", iconName: "info" });
        if (status) {
          status.textContent = message;
          status.classList.remove("is-ok");
        }
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.innerHTML = original;
        }
      }
    });

    panel.querySelector('[data-model-input="gemini"]')?.addEventListener("change", async (event) => {
      const value = event.target.value.trim() || "gemini-3.5-flash-lite";
      event.target.value = value;
      await learner.updateSettings({ handwritingModel: value });
      showToast("Modell für Handschrift/Foto gespeichert.", { iconName: "check" });
    });
  }

  function bindSpeechProviderConfig(panel) {
    panel.querySelector("#set-speech-provider")?.addEventListener("change", async (event) => {
      const value = event.target.value === "gemini" ? "gemini" : "browser";
      await learner.updateSettings({ speechProvider: value });
      renderPanel();
      showToast(
        value === "gemini"
          ? "Spracheingabe: Gemini (Audio → KI)."
          : "Spracheingabe: Browser-Spracherkennung.",
        { iconName: "mic" }
      );
    });

    if ((learner.getSettings().speechProvider || "browser") !== "gemini") return;

    panel.querySelector('[data-key-toggle="gemini"][data-key-scope="speech"]')?.addEventListener("click", (event) => {
      const input = panel.querySelector('[data-key-input="gemini"][data-key-scope="speech"]');
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      event.currentTarget.setAttribute("aria-pressed", String(show));
      event.currentTarget.innerHTML = `${icon("eye")} ${show ? "Verbergen" : "Zeigen"}`;
    });

    panel.querySelector('[data-key-save="gemini"][data-key-scope="speech"]')?.addEventListener("click", async () => {
      const input = panel.querySelector('[data-key-input="gemini"][data-key-scope="speech"]');
      const value = input?.value.trim() || "";
      if (!value) {
        input?.focus();
        showToast("Bitte zuerst einen API-Schlüssel einfügen.", { type: "warn", iconName: "info" });
        return;
      }
      await setApiKey("gemini", value);
      input.value = "";
      await hydrateProviderConfig(panel);
      await hydrateSpeechProviderConfig(panel);
      showToast("Gemini-Schlüssel gespeichert. Er bleibt auf diesem Gerät und ist nicht im Backup.", {
        type: "success",
        iconName: "check",
      });
    });

    panel.querySelector('[data-key-clear="gemini"][data-key-scope="speech"]')?.addEventListener("click", async () => {
      const confirmed = await confirmDialog({
        title: "Gemini-Schlüssel entfernen?",
        message: "Spracheingabe mit Gemini, Handschrift mit Gemini und Foto-Import mit Gemini funktionieren danach nicht mehr, bis ein neuer Schlüssel gespeichert wird.",
        confirmLabel: "Entfernen",
        danger: true,
      });
      if (!confirmed) return;
      await clearApiKey("gemini");
      await hydrateProviderConfig(panel);
      await hydrateSpeechProviderConfig(panel);
      showToast("Gemini-API-Schlüssel entfernt.", { iconName: "trash" });
    });

    panel.querySelector('[data-key-test="gemini"][data-key-scope="speech"]')?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const original = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `${icon("refresh")} Prüfe …`;
      const status = panel.querySelector('[data-key-status="gemini"][data-key-scope="speech"]');
      const model =
        panel.querySelector('[data-model-input="gemini-speech"]')?.value.trim() ||
        learner.getSettings().speechModel;
      try {
        const message = await testCloudProvider("gemini", { model });
        showToast(message, { type: "success", iconName: "check" });
        if (status) {
          status.textContent = `${message} (Schlüssel gültig für Gemini.)`;
          status.classList.add("is-ok");
        }
      } catch (error) {
        const message = error?.message || "Der Verbindungstest ist fehlgeschlagen.";
        showToast(message, { type: "warn", iconName: "info" });
        if (status) {
          status.textContent = message;
          status.classList.remove("is-ok");
        }
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.innerHTML = original;
        }
      }
    });

    panel.querySelector('[data-model-input="gemini-speech"]')?.addEventListener("change", async (event) => {
      const value = event.target.value.trim() || "gemini-3.5-flash-lite";
      event.target.value = value;
      await learner.updateSettings({ speechModel: value });
      showToast("Modell für Spracheingabe gespeichert.", { iconName: "check" });
    });
  }

  /** Client-ID, Verbindungsstatus und letzte Sicherung im Einstellungsfeld zeigen. */
  async function hydrateDriveStatus(panel) {
    if (!alive) return;
    const status = await drive.getStatus();
    const input = panel.querySelector("#drive-client-id");
    if (input && document.activeElement !== input) {
      input.value = status.configured ? await drive.getClientId() : "";
    }
    const line = panel.querySelector("#drive-status");
    if (!line) return;

    if (!status.configured) {
      line.textContent = "Noch keine Client-ID gespeichert. Die Cloud-Funktion ist aus.";
    } else if (!status.connected) {
      line.textContent = "Client-ID gespeichert. Nicht verbunden – der Token gilt nur für diese Sitzung.";
    } else if (status.lastSync?.uploadedAt) {
      line.textContent = `Verbunden. Letzte Sicherung: ${formatDate(new Date(status.lastSync.uploadedAt).getTime())} · ${plural(status.lastSync.profileCount || 0, "Profil", "Profile")}.`;
    } else {
      line.textContent = "Verbunden. In dieser Installation wurde noch nicht gesichert.";
    }

    panel.querySelector('[data-action="drive-connect"]')?.toggleAttribute("disabled", status.connected || !status.configured);
    panel.querySelector('[data-action="drive-disconnect"]')?.toggleAttribute("disabled", !status.connected);
    panel.querySelector('[data-action="drive-upload"]')?.toggleAttribute("disabled", !status.connected);
    panel.querySelector('[data-action="drive-download"]')?.toggleAttribute("disabled", !status.connected);
  }

  async function withBusy(button, label, task) {
    setButtonBusy(button, true, label);
    try {
      return await task();
    } finally {
      setButtonBusy(button, false);
    }
  }

  /** Stellt bei Bedarf die Verbindung zu Google Drive wieder her. */
  async function ensureDrive() {
    if (!drive.isConnected()) await drive.connect();
  }

  function bindProfileSettings(panel) {
    panel.querySelector('[data-action="profile-create"]')?.addEventListener("click", () => {
      openProfileForm({ mode: "create" });
    });

    panel.querySelector('[data-action="profile-switcher"]')?.addEventListener("click", () => {
      openProfileSwitcher();
    });

    panel.querySelector("#parent-profile-list")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-parent-profile]");
      if (!button) return;
      const id = button.dataset.profileId;
      const profile = profiles.isReady() ? profiles.listProfiles().find((item) => item.id === id) : null;
      if (!profile) return;
      const action = button.dataset.parentProfile;

      try {
        if (action === "activate") {
          button.disabled = true;
          await profiles.switchProfile(id);
          window.location.reload();
          return;
        }
        if (action === "rename") {
          openProfileForm({ mode: "rename", profile, onDone: () => renderPanel() });
          return;
        }
        if (action === "delete") {
          const ok = await confirmDialog({
            title: "Profil löschen?",
            message: `„${profile.name}“ und alle seine Wörter, Punkte und Fortschritte werden gelöscht. Das lässt sich nicht rückgängig machen.`,
            confirmLabel: "Profil löschen",
            danger: true,
          });
          if (!ok) return;
          button.disabled = true;
          const wasActive = profile.active;
          await profiles.deleteProfile(id);
          if (wasActive) {
            window.location.reload();
            return;
          }
          showToast("Profil gelöscht.", { type: "success", iconName: "check" });
          renderPanel();
          return;
        }
      } catch (err) {
        button.disabled = false;
        showToast(errorMessage(err), { type: "error" });
      }
    });
  }

  function bindDriveSettings(panel) {
    panel.querySelector('[data-action="drive-save-client"]')?.addEventListener("click", async () => {
      const value = panel.querySelector("#drive-client-id")?.value.trim() || "";
      await drive.setClientId(value);
      showToast(value ? "Client-ID gespeichert." : "Client-ID entfernt.", { type: "success", iconName: "check" });
      await hydrateDriveStatus(panel);
    });

    panel.querySelector('[data-action="drive-clear-client"]')?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Client-ID entfernen?",
        message: "Die Verbindung wird getrennt und die gespeicherte Client-ID gelöscht. Deine lokalen Daten bleiben erhalten.",
        confirmLabel: "Entfernen",
        danger: true,
      });
      if (!ok) return;
      drive.disconnect();
      await drive.setClientId("");
      showToast("Google-Drive-Einrichtung entfernt.", { iconName: "cloud" });
      renderPanel();
    });

    panel.querySelector('[data-action="drive-connect"]')?.addEventListener("click", async (event) => {
      try {
        await withBusy(event.currentTarget, "Verbinde …", () => drive.connect());
        showToast("Mit Google Drive verbunden.", { type: "success", iconName: "cloud" });
      } catch (err) {
        showToast(errorMessage(err), { type: "error" });
      }
      await hydrateDriveStatus(panel);
    });

    panel.querySelector('[data-action="drive-disconnect"]')?.addEventListener("click", async () => {
      drive.disconnect();
      showToast("Google Drive getrennt.", { iconName: "cloud" });
      await hydrateDriveStatus(panel);
    });

    panel.querySelector('[data-action="drive-upload"]')?.addEventListener("click", async (event) => {
      try {
        const info = await withBusy(event.currentTarget, "Sichere …", async () => {
          await ensureDrive();
          return drive.upload();
        });
        showToast(`${plural(info.profileCount, "Profil", "Profile")} in der Cloud gesichert.`, {
          type: "success",
          iconName: "check",
        });
      } catch (err) {
        showToast(errorMessage(err), { type: "error" });
      }
      await hydrateDriveStatus(panel);
    });

    panel.querySelector('[data-action="drive-download"]')?.addEventListener("click", async (event) => {
      try {
        const remote = await withBusy(event.currentTarget, "Lade …", async () => {
          await ensureDrive();
          return drive.download();
        });
        if (!remote) {
          showToast("In der Cloud liegt noch keine SpeakUp-Datei.", { iconName: "cloud" });
          return;
        }
        const count = remote.payload.profiles.length;
        const stand = remote.file?.modifiedTime ? formatDate(new Date(remote.file.modifiedTime).getTime()) : "unbekannt";
        const ok = await confirmDialog({
          title: "Aus Google Drive laden?",
          message: `Die Cloud enthält ${plural(count, "Profil", "Profile")} (Stand: ${stand}). Profile mit gleicher ID oder gleichem Namen werden überschrieben, neue kommen dazu. Deine lokale Einwilligung bleibt erhalten.`,
          confirmLabel: "Cloud-Daten laden",
          danger: true,
        });
        if (!ok) return;
        const result = await drive.applyDownloaded(remote.payload);
        showToast(`${plural(result.added + result.updated, "Profil", "Profile")} übernommen.`, {
          type: "success",
          iconName: "check",
        });
        window.location.reload();
      } catch (err) {
        showToast(errorMessage(err), { type: "error" });
      }
      await hydrateDriveStatus(panel);
    });
  }

  function renderSettings(panel) {
    const settings = learner.getSettings();
    const consent = learner.getConsent();
    const level = learner.getLevelInfo();
    const lib = library.getLibrary();
    const stand = isStandalone();
    const providerId = settings.handwritingProvider || "google-input-tools";
    const providerLabel = PROVIDER_INFO[providerId]?.label || "Google Input Tools";
    const providerOptions = ["google-input-tools", "google-vision", "gemini", "off"]
      .map((id) => `<option value="${id}" ${id === providerId ? "selected" : ""}>${esc(PROVIDER_INFO[id].label)}</option>`)
      .join("");
    const handwritingSentence =
      providerId === "off" || settings.handwriting === false
        ? "Handschrift ist aus – es werden keine Schreibbilder gesendet."
        : `Schreibbilder gehen an ${esc(providerLabel)}.`;
    const speechProviderId = settings.speechProvider || "browser";
    const speechProviderOptions = [
      { id: "browser", label: "Browser-Spracherkennung (Standard)" },
      { id: "gemini", label: "Google Gemini (Audio → KI, online)" },
    ]
      .map((item) => `<option value="${item.id}" ${item.id === speechProviderId ? "selected" : ""}>${esc(item.label)}</option>`)
      .join("");
    const speechSentence =
      speechProviderId === "gemini"
        ? "Sprachaufnahmen werden lokal aufgenommen und zur Erkennung an Google Gemini gesendet."
        : "Sprachaufnahmen gehen an den Spracherkennungsdienst des Browsers.";
    const profileRows = profiles.isReady()
      ? profiles.listProfiles()
      : [];

    panel.innerHTML = `
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><div><h2>Lernen &amp; Darstellung</h2><p>Gilt sofort für alle Runden.</p></div></div>
          <div class="settings-list">
            <div class="setting-row">
              <div class="setting-text">
                <strong>Toneffekte</strong>
                <small>Kurze Töne bei richtig/falsch. Die Vorlese-Stimme bleibt davon unberührt.</small>
              </div>
              <label class="switch">
                <input type="checkbox" id="set-effects" ${settings.effects ? "checked" : ""} aria-label="Toneffekte">
                <span class="switch-track"></span>
              </label>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <strong>Englisch automatisch vorlesen</strong>
                <small>Im Hörmodus wird das Wort direkt abgespielt.</small>
              </div>
              <label class="switch">
                <input type="checkbox" id="set-autospeak" ${settings.autoSpeak ? "checked" : ""} aria-label="Automatisch vorlesen">
                <span class="switch-track"></span>
              </label>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <strong>Handschrifterkennung</strong>
                <small>Wenn aus, lernen Kinder nur mit Tastatur. Sonst geht ein Bild der Schrift an den unten gewählten Dienst.</small>
              </div>
              <label class="switch">
                <input type="checkbox" id="set-handwriting" ${settings.handwriting !== false ? "checked" : ""} aria-label="Handschrifterkennung">
                <span class="switch-track"></span>
              </label>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <strong>Vorlese-Geschwindigkeit</strong>
                <small>Aktuell: ${settings.speechRate || 0.9}× – langsamer ist für den Anfang besser.</small>
              </div>
              <label class="sr-only" for="set-rate">Vorlese-Geschwindigkeit</label>
              <select class="select" id="set-rate" style="max-width:150px">
                <option value="0.7" ${Number(settings.speechRate) === 0.7 ? "selected" : ""}>0,7×</option>
                <option value="0.8" ${Number(settings.speechRate) === 0.8 ? "selected" : ""}>0,8×</option>
                <option value="0.9" ${Number(settings.speechRate) === 0.9 ? "selected" : ""}>0,9×</option>
                <option value="1" ${Number(settings.speechRate) === 1 ? "selected" : ""}>1,0×</option>
              </select>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>Handschrift-Erkennung</h2><p>Welcher Dienst liest die Schrift?</p></div></div>
          <div class="settings-list">
            <div class="setting-row">
              <div class="setting-text">
                <strong>Anbieter</strong>
                <small>Gilt ab der nächsten Antwort. „Aus“ bedeutet: nur Tippen.</small>
              </div>
              <label class="sr-only" for="set-handwriting-provider">Handschrift-Anbieter</label>
              <select class="select" id="set-handwriting-provider" style="max-width:260px">
                ${providerOptions}
              </select>
            </div>
          </div>
          ${providerConfigMarkup(settings)}
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>Spracheingabe</h2><p>Wie wird gesprochene Antwort erkannt?</p></div></div>
          <div class="settings-list">
            <div class="setting-row">
              <div class="setting-text">
                <strong>Anbieter</strong>
                <small>Standard ist die Browser-Spracherkennung. Gemini ist eine Alternative, wenn sie im Browser nicht gut funktioniert oder fehlt.</small>
              </div>
              <label class="sr-only" for="set-speech-provider">Anbieter für Spracheingabe</label>
              <select class="select" id="set-speech-provider" style="max-width:260px">
                ${speechProviderOptions}
              </select>
            </div>
          </div>
          ${speechProviderConfigMarkup(settings)}
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>Benutzerprofile</h2><p>Jede Person lernt mit eigener Liste und eigenem Fortschritt.</p></div></div>
          <div class="profile-switcher-list" id="parent-profile-list">
            ${
              profileRows.length
                ? profileRows
                    .map(
                      (profile) => `
                  <div class="profile-row ${profile.active ? "is-active" : ""}">
                    <span class="profile-row-emoji" aria-hidden="true">${esc(profile.emoji)}</span>
                    <div class="profile-row-text">
                      <strong>${esc(profile.name)}${profile.active ? ' <span class="mini-badge">Aktiv</span>' : ""}</strong>
                      <small>${plural(profile.wordCount, "Wort", "Wörter")}</small>
                    </div>
                    <div class="profile-row-actions">
                      ${
                        profile.active
                          ? ""
                          : `<button type="button" class="tiny-btn" data-parent-profile="activate" data-profile-id="${esc(profile.id)}" aria-label="${esc(profile.name)} aktivieren" title="Aktivieren">${icon("check")}</button>`
                      }
                      <button type="button" class="tiny-btn" data-parent-profile="rename" data-profile-id="${esc(profile.id)}" aria-label="${esc(profile.name)} umbenennen" title="Umbenennen">${icon("pencil")}</button>
                      ${
                        profileRows.length > 1
                          ? `<button type="button" class="tiny-btn" data-parent-profile="delete" data-profile-id="${esc(profile.id)}" aria-label="${esc(profile.name)} löschen" title="Löschen">${icon("trash")}</button>`
                          : ""
                      }
                    </div>
                  </div>`
                    )
                    .join("")
                : '<p class="small muted mb-0">Profile werden beim Start geladen.</p>'
            }
          </div>
          <div class="btn-row mt-2">
            <button type="button" class="btn btn-small" data-action="profile-create">${icon("plus")} Neues Profil</button>
            <button type="button" class="btn btn-ghost btn-small" data-action="profile-switcher">${icon("refresh")} Profil wechseln</button>
          </div>
          <p class="tiny muted mt-2 mb-0">Ein Wechsel sichert den aktuellen Stand automatisch. Die Einwilligung für Online-Funktionen gilt je Profil und bleibt auf diesem Gerät.</p>
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>Google Drive (optional)</h2><p>Vokabellisten und Einstellungen manuell sichern – ohne SpeakUp-Konto.</p></div></div>
          <div class="callout">
            ${icon("cloud")}
            <div>
              <p class="mb-1"><strong>Nur auf Knopfdruck.</strong> SpeakUp legt eine einzige Datei im versteckten App-Ordner deines Google-Kontos an.</p>
              <p class="mb-0">Darin liegen alle Profile mit Wörtern, Lernstand und Einstellungen. Einwilligungen, API-Schlüssel und deine Client-ID kommen nicht hinein. Nach dem Neuladen ist die Verbindung kurz getrennt.</p>
            </div>
          </div>
          <div class="field mt-2">
            <label class="field-label" for="drive-client-id">Eigene Google-OAuth-Client-ID</label>
            <input class="input" id="drive-client-id" type="text" autocomplete="off" spellcheck="false" placeholder="123456…apps.googleusercontent.com">
            <p class="hint">Google Cloud Console → API &amp; Dienste → Anmeldedaten → OAuth-Client-ID vom Typ „Webanwendung“. Bei „Autorisierte JavaScript-Ursprünge“ die Adresse dieser Installation eintragen (z. B. <code>http://localhost:8000</code>). Die Drive API muss für das Projekt aktiviert sein.</p>
          </div>
          <div class="btn-row mt-2">
            <button type="button" class="btn btn-small" data-action="drive-save-client">${icon("check")} Client-ID speichern</button>
            <button type="button" class="btn btn-ghost btn-small" data-action="drive-clear-client">${icon("trash")} Entfernen</button>
          </div>
          <p class="tiny muted" id="drive-status" role="status">wird geprüft …</p>
          <div class="btn-row">
            <button type="button" class="btn btn-soft btn-small" data-action="drive-connect">${icon("cloud")} Verbinden</button>
            <button type="button" class="btn btn-ghost btn-small" data-action="drive-disconnect">Trennen</button>
            <button type="button" class="btn btn-soft btn-small" data-action="drive-upload">${icon("upload")} Jetzt sichern</button>
            <button type="button" class="btn btn-soft btn-small" data-action="drive-download">${icon("download")} Aus Cloud laden</button>
          </div>
          <details class="provider-help mt-2">
            <summary>Wie richte ich Google Drive ein?</summary>
            <div class="small">
              <p>1. In der Google Cloud Console ein Projekt anlegen und die <strong>Google Drive API</strong> aktivieren.</p>
              <p>2. Prüfen, dass der Zugriff auf <code>drive.appdata</code> für dein Konto zugelassen ist.</p>
              <p>3. Eine <strong>OAuth-Client-ID für Webanwendungen</strong> erstellen. Als JavaScript-Ursprung genau die Adresse eintragen, unter der SpeakUp läuft (Protokoll, Host und Port müssen stimmen).</p>
              <p>4. Die ID oben einfügen, speichern und auf „Verbinden“ klicken. Google fragt einmalig nach Konto und Zustimmung.</p>
              <p class="mb-0">Beim Laden gewinnt die Cloud-Version: Profile mit gleicher ID oder gleichem Namen werden aktualisiert, neue kommen dazu. Deine lokale Einwilligung bleibt erhalten.</p>
            </div>
          </details>
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>Datenschutz &amp; Einwilligung</h2><p>Mikrofon, Handschrift und Foto-Import sind Online-Funktionen.</p></div></div>
          <div class="callout ${consent?.allowOnline ? "success" : "warn"}">
            ${icon(consent?.allowOnline ? "check" : "info")}
            <div>
              <p class="mb-1"><strong>${consent?.allowOnline ? "Online-Funktionen sind erlaubt." : "Online-Funktionen sind aus."}</strong></p>
              <p class="mb-0">${
                consent?.allowOnline
                  ? `${speechSentence} ${handwritingSentence} Fotos für den Vokabel-Import werden nur zum Lesen gesendet. SpeakUp speichert nichts davon.`
                  : "Dein Kind lernt mit Tippen und Vorlesen. Es werden keine Sprachaufnahmen, Schreibbilder oder Fotos gesendet."
              }</p>
            </div>
          </div>
          <div class="btn-row mt-2">
            <button type="button" class="btn btn-soft btn-small" data-action="consent-allow">${icon("mic")} Erlauben</button>
            <button type="button" class="btn btn-ghost btn-small" data-action="consent-deny">${icon("lock")} Nicht erlauben / widerrufen</button>
            <button type="button" class="btn-link" data-action="consent-info">${icon("info")} Datenschutzhinweis ansehen</button>
          </div>
          ${consent ? `<p class="tiny muted mt-2 mb-0">Gespeichert am ${esc(formatDate(new Date(consent.acceptedAt).getTime()))}.</p>` : ""}
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>App installieren</h2><p>${stand ? "SpeakUp läuft bereits als App." : "Als App auf dem Startbildschirm ablegen."}</p></div></div>
          <p class="small">${esc(installHint())}</p>
          <div class="btn-row">
            ${
              canInstall()
                ? `<button type="button" class="btn btn-small" data-action="install">${icon("download")} App installieren</button>`
                : ""
            }
            <a class="btn btn-ghost btn-small" href="#/ueber">${icon("info")} Mehr über SpeakUp</a>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>Über diese Installation</h2></div></div>
          <div class="settings-list">
            <div class="setting-row">
              <div class="setting-text"><strong>Version</strong><small>App ${esc(APP_VERSION)} · Daten ${esc(lib.dataVersion || "unbekannt")}</small></div>
            </div>
            <div class="setting-row">
              <div class="setting-text"><strong>Inhalte</strong><small>${plural(lib.themes.length, "Thema", "Themen")} · ${plural(lib.words.length, "Wort", "Wörter")} · Level ${level.level} (${esc(level.title)})</small></div>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <strong>Speicher</strong>
                <small>${db.usingFallback ? "localStorage (eingeschränkter Modus)" : "IndexedDB auf diesem Gerät"} · <span id="storage-detail">wird geprüft …</span></small>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-text"><strong>Elternbereich</strong><small>Die Rechenaufgabe ist eine Hürde für Kinder, keine Sicherheitsmaßnahme.</small></div>
              <button type="button" class="btn btn-ghost btn-small" data-action="lock">${icon("lock")} Sperren</button>
            </div>
          </div>
        </div>
      </div>`;

    panel.querySelector("#set-effects")?.addEventListener("change", async (event) => {
      const value = event.target.checked;
      setSfxEnabled(value);
      await learner.updateSettings({ effects: value });
      if (value) sfx.correct();
    });

    panel.querySelector("#set-autospeak")?.addEventListener("change", async (event) => {
      await learner.updateSettings({ autoSpeak: event.target.checked });
      showToast(event.target.checked ? "Wort wird automatisch vorgelesen." : "Automatisches Vorlesen ist aus.", {
        iconName: "speaker",
      });
    });

    panel.querySelector("#set-handwriting")?.addEventListener("change", async (event) => {
      const enabled = event.target.checked;
      const patch = { handwriting: enabled };
      // „Aus“ beim Anbieter würde das Einschalten sonst wirkungslos machen.
      if (enabled && learner.getSettings().handwritingProvider === "off") {
        patch.handwritingProvider = "google-input-tools";
      }
      await learner.updateSettings(patch);
      if (patch.handwritingProvider) renderPanel();
      showToast(
        enabled
          ? "Handschrifterkennung ist an."
          : "Handschrifterkennung ist aus – es wird getippt.",
        { iconName: "pencil" }
      );
    });

    panel.querySelector("#set-rate")?.addEventListener("change", async (event) => {
      await learner.updateSettings({ speechRate: Number(event.target.value) || 0.9 });
      unlockTts();
      speak("Hello! Let's learn English.", { rate: Number(event.target.value) || 0.9 });
    });

    panel.querySelector('[data-action="consent-allow"]')?.addEventListener("click", async () => {
      await learner.setConsent(true);
      showToast("Online-Funktionen erlaubt.", { type: "success", iconName: "check" });
      renderPanel();
    });

    panel.querySelector('[data-action="consent-deny"]')?.addEventListener("click", async () => {
      await learner.setConsent(false);
      showToast("Online-Funktionen sind aus. Es wird getippt.", { iconName: "keyboard" });
      renderPanel();
    });

    panel.querySelector('[data-action="consent-info"]')?.addEventListener("click", () => {
      showConsentModal({ onDone: () => renderPanel() });
    });

    panel.querySelector('[data-action="install"]')?.addEventListener("click", async () => {
      const result = await promptInstall();
      if (result.outcome === "accepted") {
        showToast("SpeakUp wird installiert. 🎉", { type: "success", iconName: "check" });
      } else if (result.outcome === "unavailable") {
        showToast(installHint(), { iconName: "info" });
      }
    });

    panel.querySelector('[data-action="lock"]')?.addEventListener("click", () => {
      state.unlocked = false;
      storeUnlock(false);
      state.gate = makeGateTask();
      state.gateError = "";
      render();
    });

    // Speicherbelegung (rein informativ)
    if (navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((estimate) => {
          const detail = panel.querySelector("#storage-detail");
          if (!detail || !estimate) return;
          const used = estimate.usage || 0;
          const mb = used > 1024 * 1024 ? `${(used / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(used / 1024))} KB`;
          detail.textContent = `${mb} belegt`;
        })
        .catch(() => {});
    }

    bindProviderConfig(panel);
    void hydrateProviderConfig(panel);
    bindSpeechProviderConfig(panel);
    void hydrateSpeechProviderConfig(panel);
    bindProfileSettings(panel);
    bindDriveSettings(panel);
    void hydrateDriveStatus(panel);
  }

  /* ---------- Start ---------- */

  // Bei Änderungen von außen (z. B. Fortschritt) nur die Ansicht aktualisieren,
  // wenn das Panel sichtbar ist. So bleiben offene Modale unberührt.
  const offLibrary = bus.on("library:change", () => {
    if (alive && state.unlocked && !document.querySelector(".modal-backdrop")) {
      renderPanel();
    }
  });

  render();

  return () => {
    alive = false;
    offLibrary();
  };
}

export default renderParent;

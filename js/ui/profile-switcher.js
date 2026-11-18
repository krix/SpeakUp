/**
 * Dialog zum Wechseln und Verwalten der Benutzerprofile.
 *
 * Der Wechsel speichert den aktuellen Stand automatisch und lädt die Seite
 * neu. So übernehmen alle Module (Lernstand, Stimme, Zeichenfläche) sauber
 * das Profil, das gerade aktiv ist.
 */
import * as profiles from "../core/profiles.js";
import { icon, esc, plural, openModal, confirmDialog, showToast, errorMessage } from "./dom.js";

function renderRows(list) {
  return list
    .map(
      (profile) => `
      <div class="profile-row ${profile.active ? "is-active" : ""}">
        <span class="profile-row-emoji" aria-hidden="true">${esc(profile.emoji)}</span>
        <div class="profile-row-text">
          <strong>${esc(profile.name)}${profile.active ? ' <span class="mini-badge">Aktiv</span>' : ""}</strong>
          <small>${plural(profile.wordCount, "Wort", "Wörter")} · zuletzt ${esc(new Date(profile.updatedAt).toLocaleDateString("de-DE"))}</small>
        </div>
        <div class="profile-row-actions">
          ${
            profile.active
              ? ""
              : `<button type="button" class="tiny-btn" data-profile-action="activate" data-profile-id="${esc(profile.id)}" aria-label="${esc(profile.name)} aktivieren" title="Aktivieren">${icon("check")}</button>`
          }
          <button type="button" class="tiny-btn" data-profile-action="rename" data-profile-id="${esc(profile.id)}" aria-label="${esc(profile.name)} umbenennen" title="Umbenennen">${icon("pencil")}</button>
          ${
            list.length > 1
              ? `<button type="button" class="tiny-btn" data-profile-action="delete" data-profile-id="${esc(profile.id)}" aria-label="${esc(profile.name)} löschen" title="Löschen">${icon("trash")}</button>`
              : ""
          }
        </div>
      </div>`
    )
    .join("");
}

/**
 * Kleines Formular für „Neues Profil“ und „Umbenennen“.
 * Bei onDone wird die aufrufende Ansicht aktualisiert (z. B. der Dialog).
 */
export function openProfileForm({ mode = "create", profile = null, onDone = null } = {}) {
  const isCreate = mode === "create";
  openModal({
    title: isCreate ? "Neues Profil" : "Profil umbenennen",
    subtitle: isCreate
      ? "Jede Person bekommt eine eigene Vokabelliste und einen eigenen Lernstand."
      : "Der Name erscheint oben in der Kopfzeile.",
    content: `
      <div class="stack">
        <div class="field">
          <label class="field-label" for="profile-name-input">Name</label>
          <input class="input" id="profile-name-input" type="text" maxlength="32" autocomplete="off"
            value="${isCreate ? "" : esc(profile?.name || "")}" placeholder="z. B. Mia">
          <p class="form-error" data-profile-error role="alert"></p>
        </div>
        <p class="tiny muted mb-0">Ein neues Profil startet mit den Standardwörtern. Es fragt einmalig nach der Erlaubnis für Online-Funktionen.</p>
      </div>`,
    actions: [
      { label: "Abbrechen", variant: "btn-ghost" },
      {
        label: "Speichern",
        variant: "btn-primary",
        iconName: "check",
        onClick: async ({ close, body }) => {
          const input = body.querySelector("#profile-name-input");
          const error = body.querySelector("[data-profile-error]");
          const name = String(input?.value || "").trim();
          if (!name) {
            error.textContent = "Bitte gib einen Namen ein.";
            input?.focus();
            return false;
          }
          try {
            if (isCreate) {
              await profiles.createProfile(name);
              close();
              window.location.reload();
              return false;
            }
            await profiles.renameProfile(profile.id, name);
            showToast("Profil umbenannt.", { type: "success", iconName: "check" });
            if (typeof onDone === "function") onDone();
          } catch (err) {
            error.textContent = errorMessage(err);
            return false;
          }
        },
      },
    ],
    initialFocus: "#profile-name-input",
  });
}

/** Öffnet die Profilübersicht mit Wechseln, Anlegen, Umbenennen und Löschen. */
export function openProfileSwitcher() {
  const modal = openModal({
    title: "Profil wechseln",
    subtitle: "Wer lernt gerade? Alle Daten bleiben auf diesem Gerät.",
    content: `
      <div class="stack">
        <div id="profile-switcher-list" class="profile-switcher-list"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-small" data-action="profile-create">${icon("plus")} Neues Profil</button>
        </div>
        <p class="tiny muted mb-0">Beim Wechseln wird der aktuelle Stand automatisch gesichert. Die Erlaubnis für Mikrofon und Handschrift gilt pro Profil.</p>
      </div>`,
    actions: [{ label: "Schließen", variant: "btn-ghost" }],
  });

  const body = modal.dialog.querySelector(".modal-body");

  function paint() {
    const host = body.querySelector("#profile-switcher-list");
    if (!host) return;
    host.innerHTML = renderRows(profiles.listProfiles());
  }

  body.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.matches('[data-action="profile-create"]')) {
      openProfileForm({ mode: "create" });
      return;
    }

    const action = button.dataset.profileAction;
    const id = button.dataset.profileId;
    if (!action || !id) return;
    const current = profiles.listProfiles().find((profile) => profile.id === id);
    if (!current) return;

    if (action === "activate") {
      button.disabled = true;
      try {
        await profiles.switchProfile(id);
        modal.close();
        window.location.reload();
      } catch (err) {
        button.disabled = false;
        showToast(errorMessage(err), { type: "error" });
      }
      return;
    }

    if (action === "rename") {
      openProfileForm({ mode: "rename", profile: current, onDone: paint });
      return;
    }

    if (action === "delete") {
      const ok = await confirmDialog({
        title: "Profil löschen?",
        message: `„${current.name}“ und alle seine Wörter, Punkte und Fortschritte werden gelöscht. Das lässt sich nicht rückgängig machen.`,
        confirmLabel: "Profil löschen",
        danger: true,
      });
      if (!ok) return;
      button.disabled = true;
      try {
        const wasActive = current.active;
        await profiles.deleteProfile(id);
        if (wasActive) {
          modal.close();
          window.location.reload();
          return;
        }
        paint();
        showToast("Profil gelöscht.", { type: "success", iconName: "check" });
      } catch (err) {
        button.disabled = false;
        showToast(errorMessage(err), { type: "error" });
      }
    }
  });

  paint();
  return modal;
}

export default { openProfileSwitcher, openProfileForm };

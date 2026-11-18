/**
 * SpeakUp – App-Shell, Router und Startablauf.
 *
 * Aufgaben:
 *   - Datenbank, Vokabeln und Lernprofil laden
 *   - Hash-Routing (#/home, #/lernen, #/fortschritt, #/eltern, #/ueber)
 *   - Kopfzeile (Punkte, Ton) und Tabbar synchron halten
 *   - Service Worker, Update-Hinweis und Online-Status
 *   - Datenschutz-Hinweis beim allerersten Start
 *
 * Es gibt keinen Build-Schritt: alle Module werden direkt vom Browser geladen.
 */
import db from "./core/db.js";
import bus from "./core/bus.js";
import * as library from "./core/library.js";
import * as learner from "./core/learner.js";
import * as profiles from "./core/profiles.js";
import { APP_NAME } from "./core/config.js";
import { setupInstallPrompt } from "./core/install.js";
import { unlockTts, stopSpeaking } from "./core/tts.js";
import { setSfxEnabled, sfx } from "./ui/sfx.js";
import {
  icon,
  esc,
  showToast,
  closeAllModals,
  focusMain,
} from "./ui/dom.js";
import { renderHome } from "./views/home.js";
import { renderSession } from "./views/session.js";
import { renderProgress } from "./views/progress.js";
import { renderParent } from "./views/parent.js";
import { renderAbout } from "./views/about.js";
import { showConsentModal } from "./views/onboarding.js";
import { openProfileSwitcher } from "./ui/profile-switcher.js";
import { applyHandwritingProvider } from "./core/handwriting-cloud.js";

const BASE_TITLE = "SpeakUp – Englisch lernen mit Sprache & Stift";

const ROUTES = {
  home: { render: renderHome, title: "Lernen", tab: "home" },
  lernen: { render: renderSession, title: "Lernrunde", tab: null },
  fortschritt: { render: renderProgress, title: "Fortschritt", tab: "progress" },
  eltern: { render: renderParent, title: "Elternbereich", tab: "parent" },
  ueber: { render: renderAbout, title: "Über SpeakUp", tab: "about" },
};

const main = document.getElementById("main");
const backBtn = document.getElementById("back-btn");
const pointsChip = document.getElementById("points-chip");
const pointsValue = document.getElementById("points-value");
const soundBtn = document.getElementById("sound-btn");
const profileBtn = document.getElementById("profile-btn");
const profileEmoji = document.getElementById("profile-emoji");
const profileName = document.getElementById("profile-name");
const tabbar = document.getElementById("tabbar");
const splash = document.getElementById("splash");
const updateBanner = document.getElementById("update-banner");
const updateBtn = document.getElementById("update-btn");
const updateDismiss = document.getElementById("update-dismiss");

let currentRoute = null;
let currentCleanup = null;
let renderToken = 0;
let booted = false;
let previousPoints = 0;

/* ============================================================
   Kopfzeile
   ============================================================ */

function syncPoints({ animate = false } = {}) {
  const points = Math.max(0, Number(learner.getProfile()?.points) || 0);
  if (!pointsValue) return;
  pointsValue.textContent = new Intl.NumberFormat("de-DE").format(points);
  pointsChip?.setAttribute("title", `${points} Punkte gesammelt`);
  if (animate && points > previousPoints && pointsChip) {
    pointsChip.classList.remove("bump");
    // Neustart der Animation erzwingen.
    void pointsChip.offsetWidth;
    pointsChip.classList.add("bump");
    setTimeout(() => pointsChip.classList.remove("bump"), 400);
  }
  previousPoints = points;
}

/** Zeigt, welches Profil gerade aktiv ist. */
function syncProfile() {
  if (!profiles.isReady()) return;
  const active = profiles.getActiveProfile();
  if (profileEmoji) profileEmoji.textContent = active.emoji || "🦊";
  if (profileName) profileName.textContent = active.name;
  profileBtn?.setAttribute("aria-label", `Profil ${active.name} – wechseln`);
  profileBtn?.setAttribute("title", `Profil wechseln: ${active.name}`);
}

function syncSound() {
  const enabled = learner.getSettings()?.effects !== false;
  setSfxEnabled(enabled);
  if (!soundBtn) return;
  soundBtn.setAttribute("aria-pressed", String(enabled));
  soundBtn.setAttribute("aria-label", enabled ? "Toneffekte ausschalten" : "Toneffekte einschalten");
  soundBtn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-sound-${enabled ? "on" : "off"}"/></svg>`;
}

/** Wählt den im Elternbereich eingestellten Handschrift-Anbieter. */
function syncHandwritingProvider() {
  try {
    applyHandwritingProvider(learner.getSettings() || {});
  } catch (error) {
    console.warn("[app] Handschrift-Anbieter konnte nicht gesetzt werden", error);
  }
}

function setActiveTab(tabId) {
  if (!tabbar) return;
  tabbar.querySelectorAll("[data-tab]").forEach((link) => {
    const active = link.dataset.tab === tabId;
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function setDocumentTitle(title) {
  document.title = title ? `${title} · ${APP_NAME}` : BASE_TITLE;
}

/* ============================================================
   Router
   ============================================================ */

function normalizeHash() {
  let raw = location.hash || "";
  if (!raw.startsWith("#/")) {
    if (raw === "#main") {
      focusMain();
      return null;
    }
    // Leere oder fremde Hash-Werte auf die Startseite umleiten.
    history.replaceState(null, "", `${location.pathname}${location.search}#/home`);
    raw = "#/home";
  }
  const name = raw.slice(2).split("?")[0].replace(/\/+$/, "") || "home";
  return ROUTES[name] ? name : "home";
}

function runCleanup() {
  if (typeof currentCleanup === "function") {
    try {
      currentCleanup();
    } catch (error) {
      console.warn("[app] Ansicht konnte nicht aufgeräumt werden", error);
    }
  }
  currentCleanup = null;
  stopSpeaking();
}

function renderRoute({ force = false } = {}) {
  if (!booted || !main) return;
  const name = normalizeHash();
  if (name === null) return;
  if (!force && name === currentRoute) return;

  const token = ++renderToken;
  runCleanup();
  closeAllModals();

  const route = ROUTES[name];
  currentRoute = name;
  main.innerHTML = "";
  main.removeAttribute("aria-busy");

  try {
    const cleanup = route.render(main);
    if (token !== renderToken) {
      // Eine neuere Navigation hat bereits übernommen.
      if (typeof cleanup === "function") cleanup();
      return;
    }
    currentCleanup = typeof cleanup === "function" ? cleanup : null;
  } catch (error) {
    console.error("[app] Ansicht konnte nicht gerendert werden", error);
    main.innerHTML = `
      <div class="card panel center">
        <h1>Da ist etwas schiefgelaufen</h1>
        <p class="muted">${esc(error?.message || "Unbekannter Fehler")}</p>
        <div class="btn-row" style="justify-content:center">
          <button type="button" class="btn" data-action="reload">${icon("refresh")} Neu laden</button>
          <a class="btn btn-ghost" href="#/home">${icon("home")} Startseite</a>
        </div>
      </div>`;
    main.querySelector('[data-action="reload"]')?.addEventListener("click", () => window.location.reload());
  }

  setActiveTab(route.tab);
  setDocumentTitle(route.title);
  // Auf der Lernseite setzt die Ansicht selbst den Fokus.
  if (name !== "lernen") focusMain();
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function wireNavigation() {
  window.addEventListener("hashchange", () => renderRoute());

  backBtn?.addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.hash = "#/home";
  });

  // Der Skip-Link darf den Hash-Router nicht auslösen.
  document.querySelector(".skip-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    focusMain();
  });

  // Ein einziger globaler Listener schaltet die Ton-Effekte.
  soundBtn?.addEventListener("click", async () => {
    const enabled = learner.getSettings()?.effects !== false;
    await learner.updateSettings({ effects: !enabled });
    if (!enabled) sfx.click();
  });

  // Profilchip öffnet die Übersicht zum Wechseln und Anlegen.
  profileBtn?.addEventListener("click", () => openProfileSwitcher());

  // Punkte und Einstellungen aus anderen Ansichten übernehmen.
  bus.on("learner:change", () => syncPoints({ animate: true }));
  bus.on("profile:change", () => syncProfile());
  bus.on("settings:change", () => {
    syncSound();
    syncHandwritingProvider();
  });
  bus.on("progress:change", () => syncPoints());

  // Ansichten können einen vollständigen Neuaufbau anfordern, ohne den
  // Router zu kennen. So werden Ereignis-Listener zuverlässig ersetzt.
  bus.on("route:refresh", () => renderRoute({ force: true }));
}

/* ============================================================
   Start
   ============================================================ */

function hideSplash() {
  if (!splash) return;
  splash.classList.add("is-hidden");
  setTimeout(() => splash.remove(), 450);
}

function showBootError(error) {
  const isFile = location.protocol === "file:";
  const message = isFile
    ? "Die Vokabellisten können nicht geladen werden, weil die App direkt aus einer Datei geöffnet wurde."
    : error?.message || "Die Vokabeln konnten nicht geladen werden.";
  if (main) {
    main.innerHTML = `
      <div class="card panel center">
        <h1>SpeakUp konnte nicht starten</h1>
        <p class="muted">${esc(message)}</p>
        ${
          isFile
            ? `<div class="callout warn" style="text-align:left">
                 ${icon("info")}
                 <p class="mb-0">Starte SpeakUp über einen kleinen Webserver, z. B. im Projektordner mit
                 <code>python -m http.server 8000</code> und öffne dann
                 <code>http://localhost:8000</code>.</p>
               </div>`
            : `<p class="small muted">Prüfe die Internetverbindung und lade die Seite neu.
               Bereits gespeicherte Wörter funktionieren auch offline.</p>`
        }
        <div class="btn-row" style="justify-content:center">
          <button type="button" class="btn" data-action="reload">${icon("refresh")} Neu laden</button>
        </div>
      </div>`;
    main.querySelector('[data-action="reload"]')?.addEventListener("click", () => window.location.reload());
  }
  hideSplash();
}

async function boot() {
  // Installation kann bereits vor dem Datenladen angeboten werden.
  setupInstallPrompt();
  wireNavigation();
  syncSound();
  syncPoints();
  enableTtsUnlock();

  try {
    await db.init();
    const hadLibrary = Boolean(await db.kvGet("library"));
    await learner.init();
    const info = await library.init();
    syncHandwritingProvider();

    // Falls Standardwörter umbenannt wurden, den Fortschritt übernehmen.
    for (const migration of info.migrations || []) {
      if (migration?.from && migration?.to && migration.from !== migration.to) {
        await learner.migrateProgress(migration.from, migration.to);
      }
    }

    // Bestehende Daten als erstes Profil übernehmen bzw. Profilstand laden.
    await profiles.init();
    await profiles.refreshActiveSnapshot();
    syncProfile();

    booted = true;
    syncSound();
    syncPoints();

    renderRoute({ force: true });
    hideSplash();

    if (info.offline) {
      showToast("Offline-Modus: Es werden die gespeicherten Wörter verwendet.", {
        type: "warn",
        iconName: "cloud",
        duration: 5000,
      });
    } else if (hadLibrary) {
      if (info.addedWords || info.addedThemes || info.updatedWords) {
        const parts = [];
        if (info.addedWords) parts.push(`${info.addedWords} neue ${info.addedWords === 1 ? "Wort" : "Wörter"}`);
        if (info.updatedWords) parts.push(`${info.updatedWords} aktualisiert`);
        if (info.addedThemes) parts.push(`${info.addedThemes} neue ${info.addedThemes === 1 ? "Thema" : "Themen"}`);
        showToast(`Vokabeln ergänzt: ${parts.join(", ")}.`, { type: "success", iconName: "check" });
      }
      if (info.migrations?.length) {
        showToast("Fortschritt für geänderte Wörter übernommen.", { iconName: "refresh" });
      }
    }

    // Datenschutz-Hinweis beim ersten Start (nicht schließbar).
    if (learner.needsConsent()) {
      showConsentModal({
        firstRun: true,
        onDone: () => {
          syncSound();
          renderRoute({ force: true });
        },
      });
    }

    registerServiceWorker();
    setupOnlineStatus();
    checkForDataUpdate();
    setupVisibilityChecks();
  } catch (error) {
    console.error("[app] Start fehlgeschlagen", error);
    showBootError(error);
  }
}

/* ============================================================
   Sprache & Ton nach der ersten Geste freischalten
   ============================================================ */

function enableTtsUnlock() {
  const unlock = () => {
    unlockTts();
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
  };
  document.addEventListener("pointerdown", unlock, { once: true, passive: true });
  document.addEventListener("keydown", unlock, { once: true });
}

/* ============================================================
   Online / Offline
   ============================================================ */

function setupOnlineStatus() {
  window.addEventListener("online", () => {
    showToast("Wieder online. Neue Wörter werden geprüft.", { type: "success", iconName: "cloud" });
    checkForDataUpdate();
  });
  window.addEventListener("offline", () => {
    showToast("Du bist offline. SpeakUp funktioniert weiter mit gespeicherten Daten.", {
      type: "warn",
      iconName: "cloud",
      duration: 5000,
    });
  });
}

function setupVisibilityChecks() {
  let last = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - last < 30 * 60 * 1000) return;
    last = Date.now();
    if (navigator.onLine) checkForDataUpdate();
  });
}

/* ============================================================
   Service Worker, Daten-Updates und Update-Banner
   ============================================================ */

let pendingWorker = null;
let updateKind = null;
let awaitingReload = false;
let registration = null;
let checkingData = false;

function showUpdateBanner(text, kind) {
  if (!updateBanner) return;
  updateKind = kind;
  const label = updateBanner.querySelector("span");
  if (label) label.textContent = text;
  updateBanner.hidden = false;
  if (updateBtn) updateBtn.disabled = false;
}

function hideUpdateBanner() {
  if (updateBanner) updateBanner.hidden = true;
  updateKind = null;
}

function askWorker(type, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const controller = navigator.serviceWorker?.controller;
    if (!controller) {
      reject(new Error("Kein Service Worker aktiv."));
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("Zeitüberschreitung")), timeout);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    try {
      controller.postMessage({ type }, [channel.port2]);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function readDeployedDataVersion() {
  if (navigator.serviceWorker?.controller) {
    try {
      const result = await askWorker("CHECK_DATA", 7000);
      if (result?.ok) return result.version || null;
    } catch {
      /* fällt auf direkten Fetch zurück */
    }
  }
  try {
    const response = await fetch(`data/index.json?check=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.version || null;
  } catch {
    return null;
  }
}

async function checkForDataUpdate() {
  if (!booted || checkingData || !navigator.onLine) return;
  checkingData = true;
  try {
    const deployed = await readDeployedDataVersion();
    const current = library.getLibrary()?.dataVersion;
    if (!deployed || !current || deployed === current) return;
    const dismissed = sessionStorage.getItem("speakup:dismissed-update");
    if (dismissed === deployed) return;
    if (pendingWorker) return; // App-Update hat Vorrang.
    showUpdateBanner("Neue Wörter verfügbar – jetzt aktualisieren!", "data");
    updateBanner?.setAttribute("data-version", deployed);
  } catch (error) {
    console.warn("[app] Daten-Update-Prüfung fehlgeschlagen", error);
  } finally {
    checkingData = false;
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "SPEAKUP_DATA_UPDATED" && !updateKind) {
      showUpdateBanner("Neue Wörter verfügbar – jetzt aktualisieren!", "data");
    }
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!awaitingReload) return;
    awaitingReload = false;
    window.location.reload();
  });

  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) {
        pendingWorker = reg.waiting;
        showUpdateBanner("Neue Version verfügbar – jetzt aktualisieren!", "sw");
      }
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            pendingWorker = reg.waiting || installing;
            showUpdateBanner("Neue Version verfügbar – jetzt aktualisieren!", "sw");
          }
        });
      });
    })
    .catch((error) => {
      console.warn("[app] Service Worker konnte nicht registriert werden", error);
    });

  // Nach dem ersten Rendern prüfen, ob der Worker eine neue Fassung findet.
  window.setTimeout(() => {
    registration?.update?.().catch(() => {});
  }, 4000);
}

async function refreshDataCache() {
  try {
    await askWorker("REFRESH_DATA", 20000);
  } catch (error) {
    console.warn("[app] Datencache konnte nicht erneuert werden", error);
  }
}

updateBtn?.addEventListener("click", async () => {
  updateBtn.disabled = true;
  if (pendingWorker) {
    awaitingReload = true;
    pendingWorker.postMessage({ type: "SKIP_WAITING" });
    // Falls der Worker nicht antwortet, trotzdem neu laden.
    setTimeout(() => {
      if (awaitingReload) window.location.reload();
    }, 4000);
    return;
  }
  if (updateKind === "data") {
    await refreshDataCache();
  }
  window.location.reload();
});

updateDismiss?.addEventListener("click", () => {
  if (updateKind === "data" && updateBanner) {
    const version = updateBanner.getAttribute("data-version");
    if (version) {
      try {
        sessionStorage.setItem("speakup:dismissed-update", version);
      } catch {
        /* privater Modus */
      }
    }
  }
  hideUpdateBanner();
});

/* ============================================================
   Aufräumen & Start
   ============================================================ */

window.addEventListener("pagehide", () => runCleanup());

// Der Router startet erst, wenn die Daten bereit sind.
boot();

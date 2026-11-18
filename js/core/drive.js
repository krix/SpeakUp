/**
 * Google-Drive-Synchronisierung für SpeakUp.
 *
 * Es gibt kein Backend: Die OAuth-Client-ID wird im Elternbereich lokal
 * eingetragen, der Zugriff läuft über Google Identity Services. Der
 * Access-Token bleibt nur im Speicher dieser Page – er wird weder in
 * localStorage noch in ein Backup geschrieben. Nach einem Neuladen muss
 * daher erneut „Verbinden“ geklickt werden.
 *
 * Gespeichert wird eine einzige Datei im geschützten appDataFolder:
 * sie enthält alle lokalen Profile (Vokabellisten, Lernstand, Einstellungen).
 * Einwilligungen und API-Schlüssel werden bewusst ausgelassen. Upload und
 * Download laufen nur auf ausdrücklichen Knopfdruck.
 */
import db from "./db.js";
import * as profiles from "./profiles.js";
import { APP_VERSION } from "./config.js";

const CLIENT_ID_KEY = "googleClientId";
const SYNC_KEY = "driveSync";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "speakup-cloud.json";
const GIS_URL = "https://accounts.google.com/gsi/client";
const API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

let accessToken = null;
let tokenClient = null;
let scriptPromise = null;

/** Lädt das offizielle GIS-Skript nur dann, wenn es wirklich gebraucht wird. */
function loadIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_URL;
    script.async = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error("Das Google-Anmeldeskript konnte nicht geladen werden."));
    };
    script.onerror = () => reject(new Error("Google Drive ist gerade nicht erreichbar."));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function getClientId() {
  return String((await db.kvGet(CLIENT_ID_KEY)) || "");
}

export async function setClientId(value) {
  const clientId = String(value || "").trim();
  if (clientId) await db.kvSet(CLIENT_ID_KEY, clientId);
  else await db.kvDelete(CLIENT_ID_KEY);
  // Eine geänderte Client-ID braucht auch einen neuen Token-Client.
  if (tokenClient && tokenClient.__speakupClientId !== clientId) {
    tokenClient = null;
    accessToken = null;
  }
  return clientId;
}

export function isConnected() {
  return Boolean(accessToken);
}

export async function getSyncInfo() {
  const info = await db.kvGet(SYNC_KEY);
  return info && typeof info === "object" ? info : null;
}

export async function getStatus() {
  return {
    configured: Boolean(await getClientId()),
    connected: isConnected(),
    lastSync: await getSyncInfo(),
  };
}

/**
 * Holt einen Access-Token. Beim ersten Aufruf darf Google nach Zustimmung
 * und Konto fragen; danach kommt der Token ohne sichtbare Abfrage zurück.
 */
export async function connect() {
  const clientId = await getClientId();
  if (!clientId) throw new Error("Bitte trage zuerst deine Google-Client-ID ein.");
  if (accessToken) return accessToken;
  await loadIdentityScript();

  return new Promise((resolve, reject) => {
    let settled = false;
    let forcePrompt = false;

    const finishError = (message) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    try {
      if (!tokenClient || tokenClient.__speakupClientId !== clientId) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: (response) => {
            if (response?.access_token) {
              accessToken = response.access_token;
              settled = true;
              resolve(accessToken);
              return;
            }
            const code = response?.error || "unbekannt";
            if (!forcePrompt && /consent_required|interaction_required|login_required/.test(code)) {
              // Stiller Versuch war nicht berechtigt: jetzt Konto/Zustimmung fragen.
              forcePrompt = true;
              tokenClient.requestAccessToken({ prompt: "consent" });
              return;
            }
            finishError(`Google Drive hat den Zugriff verweigert (${code}).`);
          },
          error_callback: (error) => finishError(error?.type || "Die Google-Anmeldung ist fehlgeschlagen."),
        });
        tokenClient.__speakupClientId = clientId;
      }
      tokenClient.requestAccessToken(forcePrompt ? { prompt: "consent" } : { prompt: "" });
    } catch (error) {
      finishError(error?.message || "Die Google-Anmeldung ist fehlgeschlagen.");
    }
  });
}

/** Entfernt den Token und widerruft die erteilte Freigabe. */
export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    } catch {
      // Ein Widerruf ist nur Komfort – der Token ist in jedem Fall weg.
    }
  }
  accessToken = null;
  tokenClient = null;
}

async function apiFetch(url, options = {}) {
  if (!accessToken) throw new Error("Nicht mit Google Drive verbunden.");
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json();
      detail = data?.error?.message || "";
    } catch {
      /* Antwort war kein JSON */
    }
    throw new Error(
      response.status === 401
        ? "Die Google-Verbindung ist abgelaufen. Bitte erneut verbinden."
        : `Google Drive meldet einen Fehler (${response.status})${detail ? `: ${detail}` : "."}`
    );
  }
  return response.json();
}

async function findFile() {
  const query = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
  const data = await apiFetch(
    `${API_BASE}/files?q=${query}&spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=10`
  );
  return Array.isArray(data?.files) ? data.files[0] || null : null;
}

/** Baut die Cloud-Datei aus allen lokalen Profilen. */
export async function buildPayload() {
  return {
    app: "SpeakUp",
    format: "speakup-cloud",
    schemaVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    profiles: profiles.isReady() ? await profiles.exportCloudProfiles() : [],
  };
}

/** Lädt alle Profile als JSON in den appDataFolder hoch. */
export async function upload() {
  if (!accessToken) throw new Error("Bitte zuerst mit Google Drive verbinden.");
  const payload = await buildPayload();
  const existing = await findFile();
  let data;

  if (existing?.id) {
    data = await apiFetch(`${UPLOAD_BASE}/files/${encodeURIComponent(existing.id)}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(payload),
    });
  } else {
    const boundary = `----speakup-${Date.now().toString(36)}`;
    const metadata = JSON.stringify({
      name: FILE_NAME,
      mimeType: "application/json",
      parents: ["appDataFolder"],
    });
    const body = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(payload)}\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    data = await apiFetch(`${UPLOAD_BASE}/files?uploadType=multipart`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  const info = {
    fileId: data?.id || existing?.id || null,
    uploadedAt: payload.exportedAt,
    profileCount: payload.profiles.length,
  };
  await db.kvSet(SYNC_KEY, info);
  return info;
}

/** Akzeptiert das neue Format und alte speakup-backup-Dateien. */
function normalizePayload(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Die Cloud-Datei ist leer oder ungültig.");
  if (raw.format === "speakup-cloud" && Array.isArray(raw.profiles)) return raw;
  if (raw.format === "speakup-backup" && raw.data?.library) {
    return {
      app: "SpeakUp",
      format: "speakup-cloud",
      schemaVersion: 1,
      appVersion: raw.appVersion || APP_VERSION,
      exportedAt: raw.exportedAt || new Date().toISOString(),
      profiles: [
        {
          id: "cloud-import",
          name: "Aus der Cloud",
          emoji: "☁️",
          updatedAt: Date.now(),
          snapshot: {
            library: raw.data.library,
            profile: raw.data.profile,
            settings: raw.data.settings,
            progress: raw.data.progress,
            sessions: raw.data.sessions,
          },
        },
      ],
    };
  }
  throw new Error("Die Cloud-Datei ist keine SpeakUp-Datei.");
}

/** Liest die Cloud-Datei, ohne lokale Daten zu verändern. */
export async function download() {
  if (!accessToken) throw new Error("Bitte zuerst mit Google Drive verbinden.");
  const file = await findFile();
  if (!file?.id) return null;
  const data = await apiFetch(`${API_BASE}/files/${encodeURIComponent(file.id)}?alt=media`);
  const payload = normalizePayload(data);
  return { payload, file };
}

/** Übernimmt eine zuvor heruntergeladene Cloud-Datei lokal. */
export async function applyDownloaded(payload) {
  const normalized = normalizePayload(payload);
  return profiles.importCloudProfiles(normalized.profiles);
}

export default {
  getClientId,
  setClientId,
  isConnected,
  getSyncInfo,
  getStatus,
  connect,
  disconnect,
  buildPayload,
  upload,
  download,
  applyDownloaded,
};

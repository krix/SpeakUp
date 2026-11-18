/**
 * Benutzerprofile für SpeakUp.
 *
 * Die aktive Runde nutzt weiterhin die bewährten Speicher-Schlüssel
 * (library, profile, settings, progress, sessions). Für jedes Profil wird
 * zusätzlich ein vollständiger Schnappschuss in `kv:profiles` abgelegt.
 * Beim Wechseln wird der aktive Stand gesichert und der des Zielprofils
 * zurückgespielt. So hat jede Person ihre eigene Vokabelliste, ihren
 * Lernstand und ihre Einstellungen – ohne SpeakUp-Konto und ohne Server.
 *
 * Einwilligungen bleiben bewusst lokal pro Profil und werden nicht in
 * Cloud-Schnappschüsse aufgenommen. API-Schlüssel liegen ohnehin getrennt
 * in secrets.js und wandern nie in ein Backup oder in die Cloud.
 */
import db from "./db.js";
import bus from "./bus.js";
import * as library from "./library.js";
import * as learner from "./learner.js";

const REGISTRY_KEY = "profiles";
const SCHEMA_VERSION = 1;
const DEFAULT_NAME = "Mein Profil";
const EMOJIS = ["🦊", "🐻", "🐼", "🦉", "🐝", "🐢", "🐨", "🦁"];

let registry = null;

const clone = (value) => structuredClone(value);

function makeId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cleanName(value, fallback = DEFAULT_NAME) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 32);
  return name || fallback;
}

/** Normalisiert einen Schnappschuss und verwirft ungültige Teile. */
function normalizeSnapshot(raw) {
  const lib = raw?.library;
  return {
    library: lib && Array.isArray(lib.themes) && Array.isArray(lib.words) ? clone(lib) : null,
    profile: raw?.profile && typeof raw.profile === "object" ? clone(raw.profile) : null,
    settings: raw?.settings && typeof raw.settings === "object" ? clone(raw.settings) : null,
    consent: raw?.consent && typeof raw.consent === "object" ? clone(raw.consent) : null,
    progress: Array.isArray(raw?.progress)
      ? raw.progress.filter((record) => record && typeof record.id === "string").map(clone)
      : [],
    sessions: Array.isArray(raw?.sessions)
      ? raw.sessions.filter((session) => session && typeof session === "object").map((session) => {
          const { id, ...rest } = session;
          return rest;
        })
      : [],
  };
}

/** Schnappschuss für die Cloud: ohne Einwilligung und ohne interne Sessions-IDs. */
function withoutConsent(snapshot) {
  const clean = normalizeSnapshot(snapshot);
  delete clean.consent;
  return clean;
}

function normalizeUser(raw, index = 0) {
  const id = String(raw?.id ?? "").trim() || makeId();
  return {
    id,
    name: cleanName(raw?.name, `${DEFAULT_NAME} ${index + 1}`),
    emoji: String(raw?.emoji ?? EMOJIS[index % EMOJIS.length]).slice(0, 8) || EMOJIS[index % EMOJIS.length],
    createdAt: Number(raw?.createdAt) || Date.now(),
    updatedAt: Number(raw?.updatedAt) || Date.now(),
    snapshot: normalizeSnapshot(raw?.snapshot),
  };
}

function normalizeRegistry(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.users) || !raw.users.length) return null;
  const users = raw.users.map(normalizeUser);
  const used = new Set();
  for (const user of users) {
    while (used.has(user.id)) user.id = makeId();
    used.add(user.id);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    activeId: used.has(raw.activeId) ? raw.activeId : users[0].id,
    users,
  };
}

async function persist() {
  await db.kvSet(REGISTRY_KEY, registry);
}

function requireRegistry() {
  if (!registry) throw new Error("Profile sind noch nicht geladen.");
  return registry;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    emoji: user.emoji,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    wordCount: user.snapshot.library?.words?.length || 0,
    active: user.id === registry.activeId,
  };
}

function emitChange() {
  bus.emit("profile:change", { active: getActiveProfile(), profiles: listProfiles() });
}

/** Liest den aktuellen Stand aus den aktiven Speicher-Schlüsseln. */
async function captureActive() {
  const [libraryData, profile, settings, consent, progress, sessions] = await Promise.all([
    db.kvGet("library"),
    db.kvGet("profile"),
    db.kvGet("settings"),
    db.kvGet("consent"),
    db.progressAll(),
    db.sessionsAll(),
  ]);
  return normalizeSnapshot({ library: libraryData, profile, settings, consent, progress, sessions });
}

/** Schreibt einen Schnappschuss in die aktiven Speicher-Schlüsseln. */
async function applySnapshot(snapshot) {
  const data = normalizeSnapshot(snapshot);
  if (data.library) await db.kvSet("library", data.library);
  else await db.kvDelete("library");

  if (data.profile) await db.kvSet("profile", data.profile);
  else await db.kvDelete("profile");

  if (data.settings) await db.kvSet("settings", data.settings);
  else await db.kvDelete("settings");

  if (data.consent) await db.kvSet("consent", data.consent);
  else await db.kvDelete("consent");

  await db.progressClear();
  for (const record of data.progress) {
    if (record?.id) await db.progressPut(record);
  }

  await db.sessionsClear();
  for (const session of data.sessions) await db.sessionAdd(session);
}

/** Lässt die Module den gerade wiederhergestellten Stand neu einlesen. */
async function reloadModules() {
  await learner.init();
  await library.init();
}

async function saveActiveSnapshot() {
  const state = requireRegistry();
  const active = state.users.find((user) => user.id === state.activeId);
  if (!active) return;
  active.snapshot = await captureActive();
  active.updatedAt = Date.now();
  await persist();
}

/**
 * Initialisiert die Profile. Beim ersten Start wird der vorhandene Stand
 * als „Mein Profil“ übernommen, damit nichts verloren geht.
 */
export async function init() {
  registry = normalizeRegistry(await db.kvGet(REGISTRY_KEY));
  if (!registry) {
    const now = Date.now();
    registry = {
      schemaVersion: SCHEMA_VERSION,
      activeId: makeId(),
      users: [
        {
          id: makeId(),
          name: DEFAULT_NAME,
          emoji: EMOJIS[0],
          createdAt: now,
          updatedAt: now,
          snapshot: await captureActive(),
        },
      ],
    };
    registry.activeId = registry.users[0].id;
    await persist();
    return getActiveProfile();
  }
  await persist();
  return getActiveProfile();
}

export function isReady() {
  return Boolean(registry);
}

export function listProfiles() {
  const state = requireRegistry();
  return state.users.map(publicUser);
}

export function getActiveProfile() {
  const state = requireRegistry();
  return publicUser(state.users.find((user) => user.id === state.activeId) || state.users[0]);
}

export function getProfileCount() {
  return requireRegistry().users.length;
}

/** Legt ein Profil mit den Standardwörtern an und aktiviert es sofort. */
export async function createProfile(name) {
  const state = requireRegistry();
  await saveActiveSnapshot();

  let words = null;
  try {
    const defaults = await library.loadDefaults();
    words = {
      schemaVersion: 1,
      dataVersion: defaults.dataVersion,
      themes: clone(defaults.themes),
      words: clone(defaults.words),
      deletedWords: [],
      deletedThemes: [],
      updatedAt: Date.now(),
    };
  } catch {
    // Offline: die vorhandenen Standardwörter sind ein brauchbarer Start.
    words = state.users.find((user) => user.id === state.activeId)?.snapshot.library || null;
  }

  const now = Date.now();
  const user = normalizeUser(
    {
      id: makeId(),
      name: cleanName(name, `${DEFAULT_NAME} ${state.users.length + 1}`),
      emoji: EMOJIS[state.users.length % EMOJIS.length],
      createdAt: now,
      updatedAt: now,
      snapshot: { library: words, progress: [], sessions: [] },
    },
    state.users.length
  );
  state.users.push(user);
  state.activeId = user.id;
  await applySnapshot(user.snapshot);
  await persist();
  await reloadModules();
  emitChange();
  return publicUser(user);
}

export async function switchProfile(id) {
  const state = requireRegistry();
  if (id === state.activeId) return getActiveProfile();
  const target = state.users.find((user) => user.id === id);
  if (!target) throw new Error("Dieses Profil gibt es nicht mehr.");
  await saveActiveSnapshot();
  await applySnapshot(target.snapshot);
  state.activeId = target.id;
  target.updatedAt = Date.now();
  await persist();
  await reloadModules();
  emitChange();
  return publicUser(target);
}

export async function renameProfile(id, name) {
  const state = requireRegistry();
  const user = state.users.find((item) => item.id === id);
  if (!user) throw new Error("Dieses Profil gibt es nicht mehr.");
  user.name = cleanName(name);
  user.updatedAt = Date.now();
  await persist();
  emitChange();
  return publicUser(user);
}

export async function deleteProfile(id) {
  const state = requireRegistry();
  if (state.users.length <= 1) throw new Error("Das letzte Profil kann nicht gelöscht werden.");
  const index = state.users.findIndex((user) => user.id === id);
  if (index < 0) throw new Error("Dieses Profil gibt es nicht mehr.");
  const wasActive = id === state.activeId;
  state.users.splice(index, 1);
  if (wasActive) {
    const next = state.users[0];
    await applySnapshot(next.snapshot);
    state.activeId = next.id;
    await reloadModules();
  }
  await persist();
  emitChange();
  return getActiveProfile();
}

/**
 * Erzeugt die Cloud-Darstellung aller Profile. Einwilligung und
 * API-Schlüssel sind ausdrücklich nicht enthalten.
 */
export async function exportCloudProfiles() {
  const state = requireRegistry();
  await saveActiveSnapshot();
  return state.users.map((user) => ({
    id: user.id,
    name: user.name,
    emoji: user.emoji,
    updatedAt: user.updatedAt,
    snapshot: withoutConsent(user.snapshot),
  }));
}

/**
 * Übernimmt den gerade aktiven Stand in den Registry-Eintrag. Das wird
 * gebraucht, wenn ein Backup die aktiven Speicher-Schlüssel ersetzt hat und
 * danach alle Profile aus demselben Backup importiert werden.
 */
export async function refreshActiveSnapshot() {
  await saveActiveSnapshot();
}

/**
 * Übernimmt Profile aus der Cloud. Gleiche IDs oder Namen werden
 * aktualisiert, neue Profile angelegt. Die lokale Einwilligung bleibt
 * unangetastet.
 */
export async function importCloudProfiles(list) {
  const state = requireRegistry();
  if (!Array.isArray(list) || !list.length) throw new Error("In der Cloud sind keine Profile gespeichert.");

  let added = 0;
  let updated = 0;
  for (const [index, raw] of list.entries()) {
    const incoming = normalizeUser(
      { ...raw, snapshot: { ...(raw?.snapshot || {}), consent: null } },
      index
    );
    if (!incoming.snapshot.library) continue;
    const existing =
      state.users.find((user) => user.id === incoming.id) ||
      state.users.find((user) => user.name.toLowerCase() === incoming.name.toLowerCase());
    if (existing) {
      const consent = existing.snapshot.consent || null;
      existing.name = incoming.name;
      existing.emoji = incoming.emoji;
      existing.updatedAt = Date.now();
      existing.snapshot = { ...incoming.snapshot, consent };
      updated += 1;
    } else {
      state.users.push(incoming);
      added += 1;
    }
  }

  if (!added && !updated) throw new Error("Die Cloud-Datei enthält keine gültigen Profile.");

  const active = state.users.find((user) => user.id === state.activeId) || state.users[0];
  state.activeId = active.id;
  await applySnapshot(active.snapshot);
  await persist();
  await reloadModules();
  emitChange();
  return { added, updated, active: publicUser(active) };
}

export default {
  init,
  isReady,
  listProfiles,
  getActiveProfile,
  getProfileCount,
  createProfile,
  switchProfile,
  renameProfile,
  deleteProfile,
  exportCloudProfiles,
  importCloudProfiles,
  refreshActiveSnapshot,
};

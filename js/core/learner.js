/**
 * Lernlogik: Leitner-System (5 Boxen), Punkte, Level, Tages-Serie,
 * Abzeichen sowie Profil-/Einstellungsverwaltung.
 *
 * Der Fortschritt hängt ausschließlich an der stabilen Wort-ID.
 */
import db from "./db.js";
import bus from "./bus.js";
import { makeWordId } from "./hash.js";

const DAY = 24 * 60 * 60 * 1000;
/* Box 1 → morgen, Box 2 → in 2 Tagen, ... Box 5 → in 14 Tagen */
export const LEITNER_INTERVALS = [0, 1, 2, 4, 7, 14];
export const LEITNER_LABELS = {
  1: "Neu / schwer",
  2: "Am Lernen",
  3: "Gut im Kopf",
  4: "Fast sicher",
  5: "Gemeistert",
};

export const LEVEL_THRESHOLDS = [0, 80, 200, 360, 560, 800, 1100, 1450, 1850, 2300, 2800, 3400, 4100, 4900, 5800];
const LEVEL_TITLES = [
  "Wortstarter",
  "Wortfuchs",
  "Sprachspürnase",
  "Satzbauer",
  "Englisch-Profi",
  "Vokabelheld",
  "Sprachmagier",
  "Wortzauberer",
  "Sprachlegende",
  "SpeakUp-Star",
];

const DEFAULT_SETTINGS = {
  effects: true,
  autoSpeak: true,
  speechRate: 0.9,
  mode: "mix",
  lastThemeId: "tiere",
  handwriting: true,
};

const DEFAULT_PROFILE = {
  schemaVersion: 1,
  points: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  sessions: 0,
  perfectSessions: 0,
  bestSessionStreak: 0,
  speakCorrect: 0,
  writeCorrect: 0,
  mixSessions: 0,
  streak: { count: 0, best: 0, lastDay: null },
  daily: { date: null, points: 0, words: 0 },
  badges: [],
  createdAt: null,
};

let profile = null;
let settings = null;
let consent = null;
let sessions = [];
const progress = new Map();

const clone = (value) => structuredClone(value);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function localDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDayKey(d);
}

function normalizeProfile(raw) {
  const merged = {
    ...clone(DEFAULT_PROFILE),
    ...(raw && typeof raw === "object" ? raw : {}),
  };
  merged.streak = { ...DEFAULT_PROFILE.streak, ...(raw?.streak || {}) };
  merged.daily = { ...DEFAULT_PROFILE.daily, ...(raw?.daily || {}) };
  merged.badges = Array.isArray(raw?.badges)
    ? raw.badges.filter((badge) => badge && typeof badge.id === "string").map((badge) => ({ id: badge.id, at: badge.at || Date.now() }))
    : [];
  merged.points = Math.max(0, Number(merged.points) || 0);
  merged.totalCorrect = Math.max(0, Number(merged.totalCorrect) || 0);
  merged.totalAnswered = Math.max(0, Number(merged.totalAnswered) || 0);
  merged.sessions = Math.max(0, Number(merged.sessions) || 0);
  merged.perfectSessions = Math.max(0, Number(merged.perfectSessions) || 0);
  merged.bestSessionStreak = Math.max(0, Number(merged.bestSessionStreak) || 0);
  merged.speakCorrect = Math.max(0, Number(merged.speakCorrect) || 0);
  merged.writeCorrect = Math.max(0, Number(merged.writeCorrect) || 0);
  merged.mixSessions = Math.max(0, Number(merged.mixSessions) || 0);
  merged.createdAt = merged.createdAt || new Date().toISOString();
  return merged;
}

function normalizeProgress(raw) {
  return {
    id: String(raw.id),
    box: clamp(Number(raw.box) || 1, 1, 5),
    seen: Math.max(0, Number(raw.seen) || 0),
    correct: Math.max(0, Number(raw.correct) || 0),
    wrong: Math.max(0, Number(raw.wrong) || 0),
    streak: Math.max(0, Number(raw.streak) || 0),
    lastSeen: Number(raw.lastSeen) || 0,
    lastCorrectAt: Number(raw.lastCorrectAt) || 0,
    dueAt: Number(raw.dueAt) || 0,
    masteredAt: Number(raw.masteredAt) || 0,
  };
}

export async function init() {
  profile = normalizeProfile(await db.kvGet("profile"));
  const storedSettings = await db.kvGet("settings");
  settings = { ...DEFAULT_SETTINGS, ...(storedSettings && typeof storedSettings === "object" ? storedSettings : {}) };
  consent = (await db.kvGet("consent")) || null;
  const allProgress = await db.progressAll();
  progress.clear();
  for (const record of allProgress) {
    if (record?.id) progress.set(record.id, normalizeProgress(record));
  }
  sessions = await db.sessionsAll();
  return { profile, settings, consent };
}

async function persistProfile() {
  await db.kvSet("profile", profile);
  bus.emit("learner:change", { profile, progress });
}

export function getProfile() {
  return profile;
}

export function getSettings() {
  return settings;
}

export function getConsent() {
  return consent;
}

export function needsConsent() {
  return !consent;
}

export function canUseOnlineFeatures() {
  return Boolean(consent?.allowOnline);
}

export async function setConsent(allowOnline) {
  consent = {
    version: 1,
    allowOnline: Boolean(allowOnline),
    acceptedAt: new Date().toISOString(),
  };
  await db.kvSet("consent", consent);
  bus.emit("consent:change", consent);
  return consent;
}

export async function clearConsent() {
  consent = null;
  await db.kvDelete("consent");
  bus.emit("consent:change", null);
}

export async function updateSettings(patch) {
  settings = { ...settings, ...patch };
  await db.kvSet("settings", settings);
  bus.emit("settings:change", settings);
  return settings;
}

export function getProgressMap() {
  return progress;
}

export function getProgress(wordId) {
  return progress.get(wordId) || null;
}

export function getDisplayStreak() {
  if (!profile) return 0;
  const { lastDay, count } = profile.streak;
  if (lastDay === localDayKey() || lastDay === yesterdayKey()) return count;
  return 0;
}

export function getDailyGoal(goal = 50) {
  if (!profile) return { points: 0, percent: 0, goal };
  const points = profile.daily.date === localDayKey() ? profile.daily.points : 0;
  return { points, goal, percent: clamp(Math.round((points / goal) * 100), 0, 100) };
}

export function levelForPoints(points) {
  let index = 0;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (points >= LEVEL_THRESHOLDS[i]) index = i;
  }
  return index + 1;
}

export function getLevelInfo(points = profile?.points || 0) {
  const level = levelForPoints(points);
  const index = Math.min(level - 1, LEVEL_THRESHOLDS.length - 1);
  const currentFloor = LEVEL_THRESHOLDS[index];
  const nextFloor = LEVEL_THRESHOLDS[index + 1] ?? null;
  const title = LEVEL_TITLES[Math.min(index, LEVEL_TITLES.length - 1)];
  const nextTitle = nextFloor !== null ? LEVEL_TITLES[Math.min(index + 1, LEVEL_TITLES.length - 1)] : null;
  const progressPercent = nextFloor ? clamp(Math.round(((points - currentFloor) / (nextFloor - currentFloor)) * 100), 0, 100) : 100;
  return {
    level,
    title,
    points,
    currentFloor,
    nextFloor,
    nextTitle,
    progressPercent,
    pointsToNext: nextFloor ? nextFloor - points : 0,
    isMax: nextFloor === null,
  };
}

/**
 * Wählt Wörter für eine Runde aus:
 * 60 % fällige Wiederholungen, 40 % neue Wörter, Rest aus dem Rest.
 */
export function selectSessionWords(words, count = 10) {
  const now = Date.now();
  const due = [];
  const fresh = [];
  const later = [];

  for (const word of words) {
    const record = progress.get(word.id);
    if (!record || record.seen === 0) fresh.push(word);
    else if (!record.dueAt || record.dueAt <= now) due.push(word);
    else later.push(word);
  }

  const byDue = (a, b) => (progress.get(a.id)?.dueAt || 0) - (progress.get(b.id)?.dueAt || 0);
  const byBox = (a, b) => {
    const pa = progress.get(a.id);
    const pb = progress.get(b.id);
    return (pa?.box || 1) - (pb?.box || 1) || (pa?.correct || 0) - (pb?.correct || 0);
  };
  due.sort(byDue);
  later.sort(byBox);

  const picked = [];
  const dueTarget = Math.min(due.length, Math.ceil(count * 0.6));
  picked.push(...due.slice(0, dueTarget));
  const freshTarget = Math.min(fresh.length, count - picked.length);
  picked.push(...fresh.slice(0, freshTarget));
  const rest = [...due.slice(dueTarget), ...later, ...fresh.slice(freshTarget)];
  while (picked.length < count && rest.length) picked.push(rest.shift());

  // Reihenfolge innerhalb der Runde mischen, damit die Modi variieren.
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked.slice(0, count);
}

/** Eine Antwort innerhalb einer Runde speichern (sofort persistiert). */
export async function recordAttempt(wordId, correct, { promote = true } = {}) {
  const now = Date.now();
  const record = progress.get(wordId) || {
    id: wordId,
    box: 1,
    seen: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    lastSeen: 0,
    lastCorrectAt: 0,
    dueAt: 0,
    masteredAt: 0,
  };

  record.seen += 1;
  record.lastSeen = now;

  if (correct) {
    record.correct += 1;
    record.streak += 1;
    record.lastCorrectAt = now;
    if (promote) {
      record.box = clamp(record.box + 1, 1, 5);
    }
    if (record.box >= 5) {
      record.masteredAt = record.masteredAt || now;
    }
    const days = LEITNER_INTERVALS[record.box] ?? 1;
    record.dueAt = now + days * DAY;
  } else {
    record.wrong += 1;
    record.streak = 0;
    record.box = 1;
    record.dueAt = now + LEITNER_INTERVALS[1] * DAY;
  }

  progress.set(wordId, record);
  await db.progressPut(record);
  bus.emit("progress:change", record);
  return record;
}

/** Fortschritt nach einer Wortänderung auf die neue ID übertragen. */
export async function migrateProgress(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return null;
  const oldRecord = progress.get(oldId);
  if (!oldRecord) return null;
  const existing = progress.get(newId);

  if (existing) {
    existing.seen += oldRecord.seen;
    existing.correct += oldRecord.correct;
    existing.wrong += oldRecord.wrong;
    existing.box = Math.max(existing.box, oldRecord.box);
    existing.streak = Math.max(existing.streak, oldRecord.streak);
    existing.lastSeen = Math.max(existing.lastSeen, oldRecord.lastSeen);
    existing.lastCorrectAt = Math.max(existing.lastCorrectAt, oldRecord.lastCorrectAt);
    existing.dueAt = Math.max(existing.dueAt, oldRecord.dueAt);
    existing.masteredAt = existing.masteredAt || oldRecord.masteredAt;
    await db.progressPut(existing);
    progress.delete(oldId);
  } else {
    const migrated = { ...oldRecord, id: newId };
    progress.set(newId, migrated);
    await db.progressPut(migrated);
    progress.delete(oldId);
  }
  await db.progressDelete(oldId);
  bus.emit("progress:change", null);
  return progress.get(newId) || null;
}

export async function deleteProgress(wordId) {
  progress.delete(wordId);
  await db.progressDelete(wordId);
  bus.emit("progress:change", null);
}

export async function pruneProgress(validIds) {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  let removed = 0;
  for (const id of [...progress.keys()]) {
    if (!valid.has(id)) {
      progress.delete(id);
      await db.progressDelete(id);
      removed++;
    }
  }
  if (removed) bus.emit("progress:change", null);
  return removed;
}

export async function resetProgress() {
  progress.clear();
  profile = normalizeProfile({ createdAt: new Date().toISOString() });
  sessions = [];
  await db.progressClear();
  await db.sessionsClear();
  await persistProfile();
  return profile;
}

/* ---------- Abzeichen ---------- */
export const BADGES = [
  {
    id: "erste-runde",
    icon: "🚀",
    title: "Erste Runde",
    description: "Deine erste Lernrunde abgeschlossen.",
    test: ({ profile: p }) => p.sessions >= 1,
  },
  {
    id: "sprech-profi",
    icon: "🎤",
    title: "Sprich laut!",
    description: "10 Wörter richtig gesprochen.",
    test: ({ profile: p }) => p.speakCorrect >= 10,
  },
  {
    id: "schreibkuenstler",
    icon: "✏️",
    title: "Schreibkünstler",
    description: "10 Wörter richtig geschrieben.",
    test: ({ profile: p }) => p.writeCorrect >= 10,
  },
  {
    id: "feuerkette",
    icon: "🔥",
    title: "Feuerkette",
    description: "10 richtige Antworten in Folge in einer Runde.",
    test: ({ profile: p }) => p.bestSessionStreak >= 10,
  },
  {
    id: "perfekt",
    icon: "🌟",
    title: "Perfekt!",
    description: "Eine Runde ohne einen einzigen Fehler.",
    test: ({ profile: p }) => p.perfectSessions >= 1,
  },
  {
    id: "merker-meister",
    icon: "🏅",
    title: "Merker-Meister",
    description: "5 Wörter in Box 5 gemeistert.",
    test: ({ progress: map }) => [...map.values()].filter((record) => record.seen && record.box >= 5).length >= 5,
  },
  {
    id: "wortschatz-50",
    icon: "📚",
    title: "Großer Wortschatz",
    description: "50 richtige Antworten insgesamt.",
    test: ({ profile: p }) => p.totalCorrect >= 50,
  },
  {
    id: "woche",
    icon: "🗓️",
    title: "Eine Woche dabei",
    description: "7 Tage in Folge gelernt.",
    test: ({ profile: p }) => (p.streak.best || 0) >= 7,
  },
  {
    id: "level-5",
    icon: "🧠",
    title: "Englisch-Profi",
    description: "Level 5 erreicht.",
    test: ({ profile: p }) => levelForPoints(p.points) >= 5,
  },
  {
    id: "thema-komplett",
    icon: "🏆",
    title: "Thema geschafft",
    description: "Alle Wörter eines Themas in Box 5.",
    test: ({ progress: map, words }) => {
      const byTheme = new Map();
      for (const word of words) {
        if (!byTheme.has(word.themeId)) byTheme.set(word.themeId, []);
        byTheme.get(word.themeId).push(word);
      }
      for (const list of byTheme.values()) {
        if (list.length >= 10 && list.every((word) => (map.get(word.id)?.box || 1) >= 5 && map.get(word.id)?.seen)) {
          return true;
        }
      }
      return false;
    },
  },
  {
    id: "mix-meister",
    icon: "🌈",
    title: "Mix-Meister",
    description: "5 Mix-Runden geschafft.",
    test: ({ profile: p }) => p.mixSessions >= 5,
  },
];

export function getBadgeStates() {
  const earned = new Map((profile?.badges || []).map((badge) => [badge.id, badge.at]));
  return BADGES.map((badge) => ({
    ...badge,
    earned: earned.has(badge.id),
    earnedAt: earned.get(badge.id) || null,
  }));
}

function evaluateBadges(words) {
  const earned = new Set((profile.badges || []).map((badge) => badge.id));
  const newlyEarned = [];
  for (const badge of BADGES) {
    if (earned.has(badge.id)) continue;
    if (badge.test({ profile, progress, words })) {
      newlyEarned.push(badge);
      profile.badges.push({ id: badge.id, at: Date.now() });
    }
  }
  return newlyEarned;
}

/**
 * Runde abschließen: Punkte, Serie, Statistik und Abzeichen speichern.
 * @param {object} summary
 */
export async function finishSession(summary) {
  const levelBefore = getLevelInfo().level;
  const pointsEarned = Math.max(0, Math.round(summary.points || 0));
  profile.points += pointsEarned;
  profile.totalAnswered += Math.max(0, summary.attempts || 0);
  profile.totalCorrect += Math.max(0, summary.correctAttempts || 0);
  profile.sessions += 1;
  if (summary.perfect) profile.perfectSessions += 1;
  profile.bestSessionStreak = Math.max(profile.bestSessionStreak, summary.maxStreak || 0);

  const modeCorrect = summary.modeCorrect || {};
  profile.speakCorrect += Math.max(0, modeCorrect.speak || 0);
  profile.writeCorrect += Math.max(0, (modeCorrect.write || 0) + (modeCorrect.listen || 0));
  if (summary.mode === "mix") profile.mixSessions += 1;

  const today = localDayKey();
  if (profile.streak.lastDay !== today) {
    profile.streak.count = profile.streak.lastDay === yesterdayKey() ? profile.streak.count + 1 : 1;
    profile.streak.lastDay = today;
  }
  profile.streak.best = Math.max(profile.streak.best || 0, profile.streak.count);

  if (profile.daily.date !== today) {
    profile.daily = { date: today, points: 0, words: 0 };
  }
  profile.daily.points += pointsEarned;
  profile.daily.words += summary.totalWords || 0;

  const newBadges = evaluateBadges(summary.words || []);
  const levelAfter = getLevelInfo().level;

  const sessionRecord = {
    at: Date.now(),
    themeId: summary.themeId || null,
    mode: summary.mode || "mix",
    stars: summary.stars || 1,
    points: pointsEarned,
    totalWords: summary.totalWords || 0,
    firstTryCorrect: summary.firstTryCorrect || 0,
    attempts: summary.attempts || 0,
    durationMs: summary.durationMs || 0,
  };
  sessions.unshift({ ...sessionRecord, id: `local-${Date.now()}` });
  sessions = sessions.slice(0, 100);
  await db.sessionAdd({ ...sessionRecord, at: sessionRecord.at });
  await persistProfile();

  return {
    pointsEarned,
    levelBefore,
    levelAfter,
    leveledUp: levelAfter > levelBefore,
    newBadges,
    profile,
    level: getLevelInfo(),
  };
}

export async function getSessions() {
  return [...sessions];
}

export async function reloadSessions() {
  sessions = await db.sessionsAll();
  return [...sessions];
}

/** Für den Elternbereich: Wortstatistik sortiert nach Fehlern. */
export function getWordAccuracy(wordId) {
  const record = progress.get(wordId);
  if (!record || !record.seen) return { seen: 0, correct: 0, wrong: 0, accuracy: null, box: 1 };
  return {
    seen: record.seen,
    correct: record.correct,
    wrong: record.wrong,
    accuracy: record.seen ? record.correct / record.seen : null,
    box: record.box,
  };
}

export function getBoxCounts() {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const record of progress.values()) {
    if (!record.seen) continue;
    counts[clamp(record.box, 1, 5)] += 1;
  }
  return counts;
}

export function getWeakWords(words, limit = 6) {
  return words
    .map((word) => ({ word, record: progress.get(word.id) }))
    .filter(({ record }) => record && record.seen > 0 && record.box < 5)
    .sort((a, b) => {
      const aAcc = a.record.correct / Math.max(1, a.record.seen);
      const bAcc = b.record.correct / Math.max(1, b.record.seen);
      return aAcc - bAcc || a.record.box - b.record.box || b.record.wrong - a.record.wrong;
    })
    .slice(0, limit);
}

/** Daten für ein JSON-Backup (ohne Einwilligung – Datenschutz bleibt bewusst). */
export function getLearnerBackup() {
  return {
    profile: clone(profile),
    settings: clone(settings),
    progress: [...progress.values()].map((record) => clone(record)),
  };
}

export function restoreLearnerBackup(data) {
  // Wird nach dem Neuladen der Seite wirksam; hier nur validiert.
  if (!data || typeof data !== "object") return false;
  return Boolean(data.profile || data.progress);
}

export { localDayKey, DEFAULT_SETTINGS, DEFAULT_PROFILE, makeWordId };

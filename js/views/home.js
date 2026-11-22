/** Startseite: Modus wählen, Themenwelten öffnen, Tagesziel sehen. */
import * as library from "../core/library.js";
import * as learner from "../core/learner.js";
import bus from "../core/bus.js";
import { icon, esc, showToast } from "../ui/dom.js";
import { mascot, MASCOT_LINES, randomLine } from "../ui/mascot.js";
import { sfx } from "../ui/sfx.js";
import { themeMedal } from "../ui/medal.js";
import { startSession } from "./session.js";
import { showConsentModal } from "./onboarding.js";

const MODES = [
  { id: "speak", name: "Sprechen", desc: "Sag es laut", iconName: "mic" },
  { id: "listen", name: "Hören & Schreiben", desc: "Hör zu & schreib", iconName: "speaker" },
  { id: "write", name: "Schreiben", desc: "Schreib die Lösung", iconName: "pencil" },
  { id: "mix", name: "Mix-Modus", desc: "Alles im Wechsel", iconName: "refresh" },
];

const THEME_TINTS = ["#EEE9FF", "#E3F1FF", "#FFE8E0", "#FFF3CF", "#DFF8F5", "#FFE5F2", "#E0F6E9"];

function greeting(name = "") {
  const hour = new Date().getHours();
  const base = hour < 11 ? "Guten Morgen" : hour < 18 ? "Hallo" : "Guten Abend";
  const clean = String(name || "").trim();
  return clean ? `${base} ${clean}` : base;
}

function modeLine(mode) {
  return MASCOT_LINES[mode] || MASCOT_LINES.welcome;
}

export function renderHome(main) {
  const profile = learner.getProfile();
  const level = learner.getLevelInfo();
  const settings = learner.getSettings();
  const mode = MODES.some((item) => item.id === settings.mode) ? settings.mode : "mix";
  const themes = library.getThemes();
  const allWords = library.getAllWords();
  const progress = learner.getProgressMap();
  const streak = learner.getDisplayStreak();
  const daily = learner.getDailyGoal(learner.DAILY_GOAL_POINTS);
  const unlocked = themes.filter((theme) => library.isThemeUnlocked(theme, profile.points));
  const nextLocked = themes
    .filter((theme) => !library.isThemeUnlocked(theme, profile.points))
    .sort((a, b) => a.unlockPoints - b.unlockPoints)[0];
  const masteredTotal = [...progress.values()].filter((record) => learner.isMastered(record)).length;
  let practicedTotal = 0;
  let dueNow = 0;
  let accuracyPct = null;
  try {
    const now = Date.now();
    const records = [...progress.values()];
    practicedTotal = records.filter((record) => (record.seen || 0) > 0).length;
    dueNow = allWords.filter((word) => {
      const record = progress.get(word.id);
      return record && (!record.dueAt || record.dueAt <= now) && !learner.isMastered(record);
    }).length;
    const answerSum = records.reduce((sum, r) => sum + (r.seen || 0), 0);
    const correctSum = records.reduce((sum, r) => sum + (r.correct || 0), 0);
    accuracyPct = answerSum ? Math.round((correctSum / answerSum) * 100) : null;
  } catch (e) {
    console.warn("[home] Mini-Statistik konnte nicht berechnet werden", e);
  }

  const modeCards = MODES.map(
    (item) => `
      <button type="button" class="mode-card" data-mode="${item.id}" aria-pressed="${item.id === mode}">
        <span class="mode-icon">${icon(item.iconName)}</span>
        <span>
          <span class="mode-name">${esc(item.name)}</span>
          <span class="mode-desc">${esc(item.desc)}</span>
        </span>
        <span class="mode-check">${icon("check")}</span>
      </button>`
  ).join("");

  const renderThemeCard = (theme, index) => {
    const stats = library.getThemeStats(theme.id, progress);
    const isLocked = !library.isThemeUnlocked(theme, profile.points);
    const practicedPercent = stats.total ? Math.round((stats.started / stats.total) * 100) : 0;
    const percent = stats.total ? Math.round((stats.mastered / stats.total) * 100) : 0;
    return `
      <button type="button" class="theme-card ${isLocked ? "is-locked" : ""}" data-theme="${esc(theme.id)}"
              style="--theme-tint:${THEME_TINTS[index % THEME_TINTS.length]}"
              aria-label="${esc(theme.name)}: ${stats.total} Wörter, ${practicedPercent} Prozent geübt, ${percent} Prozent gemeistert${isLocked ? ", gesperrt" : ""}">
        ${isLocked ? `<span class="lock-chip">${icon("lock")} ${theme.unlockPoints} Punkte</span>` : ""}
        <span class="theme-card-emoji" aria-hidden="true">${esc(theme.emoji)}</span>
        <span class="theme-name">${esc(theme.name)} ${themeMedal(percent) ? `<span class="theme-medal" aria-label="Themen-Medaille" title="Themen-Medaille">${themeMedal(percent)}</span>` : ""}</span>
        <span class="theme-card-meta">${stats.total} ${stats.total === 1 ? "Wort" : "Wörter"} · ${stats.started} geübt · ${stats.mastered} gemeistert</span>
        <span class="theme-progress">
          <span class="theme-progress-top"><span>Geübt</span><span>${practicedPercent} %</span></span>
          <span class="progress-track is-practiced" role="progressbar" aria-valuenow="${practicedPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="Geübt in ${esc(theme.name)}">
            <span class="progress-fill" style="width:${practicedPercent}%"></span>
          </span>
          <span class="theme-progress-top"><span>Gemeistert</span><span>${percent} %</span></span>
          <span class="progress-track" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Gemeistert in ${esc(theme.name)}">
            <span class="progress-fill ${percent >= 100 ? "green" : ""}" style="width:${percent}%"></span>
          </span>
        </span>
        <span class="go">
          ${isLocked ? `${icon("lock")} Noch ${Math.max(0, theme.unlockPoints - profile.points)} Punkte` : `Los geht's ${icon("forward")}`}
        </span>
      </button>`;
  };

  const allUnlockedWords = unlocked.reduce((sum, theme) => sum + library.getWords(theme.id).length, 0);
  const themeGroups = [];
  const bookGroups = new Map();
  themes.forEach((theme, index) => {
    const bookId = theme.source?.type === "westermann-book" ? (theme.source.bookId || theme.source.bookName || theme.id) : "";
    if (bookId) {
      let g = bookGroups.get(bookId);
      if (!g) {
        g = { kind: "book", name: theme.source.bookName || "Westermann-Buch", items: [] };
        bookGroups.set(bookId, g);
        themeGroups.push(g);
      }
      g.items.push({ theme, index });
    } else {
      themeGroups.push({ kind: "theme", theme, index });
    }
  });

  const themeSections = themeGroups.map((group) => {
    if (group.kind === "theme") {
      return `<div class="theme-grid">${renderThemeCard(group.theme, group.index)}</div>`;
    }
    return `
      <section class="home-book-group" aria-label="${esc(group.name)}">
        <div class="home-book-head">
          <h3>${icon("book")} ${esc(group.name)}</h3>
          <span class="tiny muted">${group.items.length} Kapitel</span>
        </div>
        <div class="theme-grid">
          ${group.items.map(({ theme, index }) => renderThemeCard(theme, index)).join("")}
        </div>
      </section>`;
  }).join("");

  main.innerHTML = `
    <div class="home">
      <section class="home-hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <span class="hero-kicker">${icon("star")} ${esc(greeting(profile.name))}</span>
          <h1 class="hero-title" id="hero-title">Bereit für Englisch?</h1>
          <p class="hero-text" id="hero-line">${esc(modeLine(mode))}</p>
          <div class="hero-stats">
            <span class="stat-pill">${icon("chart")} Level ${level.level} · ${esc(level.title)}</span>
            <span class="stat-pill">${icon("star", "icon-star")} ${profile.points} Punkte</span>
            <span class="stat-pill">${icon("flame", "icon-flame")} ${streak} ${streak === 1 ? "Tag" : "Tage"} Serie</span>
          </div>
          <div class="daily-goal">
            <div class="daily-goal-label">
              <span>${daily.percent >= 100 ? "Tagesziel geschafft! 🎉" : "Tagesziel"}</span>
              <span>${daily.points} / ${daily.goal} Punkte</span>
            </div>
            <div class="goal-track" role="progressbar" aria-valuenow="${daily.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Tagesziel">
              <div class="goal-fill" style="width:${daily.percent}%"></div>
            </div>
          </div>
        </div>
        <div class="hero-mascot">${mascot(mode === "speak" ? "cheer" : "happy", { size: 170 })}</div>
      </section>

      <section class="home-mini-stats" aria-label="Mini-Statistik">
        <div class="mini-stat"><strong>${practicedTotal}</strong><span>geübt</span></div>
        <div class="mini-stat"><strong>${masteredTotal}</strong><span>gemeistert</span></div>
        <div class="mini-stat"><strong>${dueNow}</strong><span>fällig</span></div>
        <div class="mini-stat"><strong>${accuracyPct === null ? "–" : `${accuracyPct}%`}</strong><span>Trefferquote</span></div>
      </section>

      ${!learner.canUseOnlineFeatures() ? `
        <div class="callout warn mt-2">
          ${icon("info")}
          <div>
            <p><strong>Mikrofon und Handschrift sind aus.</strong> Du kannst alles mit Tippen lernen.</p>
            <button type="button" class="btn-link" data-action="allow-online">Online-Funktionen erlauben</button>
          </div>
        </div>` : ""}

      <section aria-labelledby="mode-title">
        <div class="section-head">
          <h2 id="mode-title">Wie möchtest du üben?</h2>
          <p>Tippe auf einen Modus, dann auf ein Thema.</p>
        </div>
        <div class="mode-grid" role="group" aria-label="Lernmodus">${modeCards}</div>
      </section>

      <section aria-labelledby="themes-title">
        <div class="section-head">
          <h2 id="themes-title">Deine Themen</h2>
          <p>${masteredTotal} von ${allWords.length} Wörtern gemeistert${nextLocked ? ` · Nächste Welt bei ${nextLocked.unlockPoints} Punkten` : ""}</p>
        </div>
        <div class="home-theme-groups">
          ${themeSections}
          <div class="theme-grid">
            <button type="button" class="theme-card" data-theme="all" style="--theme-tint:#FFF3CF"
                    aria-label="Alle Themen: ${allUnlockedWords} Wörter, Mix-Runde">
              <span class="theme-card-emoji" aria-hidden="true">🌈</span>
              <span class="theme-name">Alle Themen</span>
              <span class="theme-card-meta">${allUnlockedWords} Wörter aus ${unlocked.length} ${unlocked.length === 1 ? "Welt" : "Welten"}</span>
              <span class="theme-progress">
                <span class="theme-progress-top"><span>Überraschungsrunde</span><span>Mix</span></span>
                <span class="progress-track"><span class="progress-fill" style="width:100%"></span></span>
              </span>
              <span class="go">${icon("forward")} Quer durch alle Themen</span>
            </button>
          </div>
        </div>
      </section>

      <div class="mascot-row mt-3">
        ${mascot("happy", { size: 86 })}
        <div class="mascot-bubble">${esc(randomLine([
          "Sammle Punkte und schalte neue Welten frei!",
          "Sprich laut – auch wenn es sich komisch anfühlt. Das hilft!",
          "Fehler sind super: So lernt dein Gehirn am besten.",
        ]))}</div>
      </div>
    </div>
  `;

  const onModeClick = async (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    const selected = button.dataset.mode;
    if (selected === learner.getSettings().mode) return;
    sfx.click();
    await learner.updateSettings({ mode: selected });
    main.querySelectorAll("[data-mode]").forEach((item) => {
      item.setAttribute("aria-pressed", String(item.dataset.mode === selected));
    });
    const line = main.querySelector("#hero-line");
    if (line) line.textContent = modeLine(selected);
  };

  const onThemeClick = (event) => {
    const button = event.target.closest("[data-theme]");
    if (!button) return;
    const themeId = button.dataset.theme;
    const points = learner.getProfile().points;

    if (themeId === "all") {
      const unlockedThemes = library.getThemes().filter((theme) => library.isThemeUnlocked(theme, points));
      const count = unlockedThemes.reduce((sum, theme) => sum + library.getWords(theme.id).length, 0);
      if (!count) {
        showToast("Es sind noch keine Wörter freigeschaltet.", { type: "warn" });
        return;
      }
      sfx.start();
      startSession({ themeId: null, mode: learner.getSettings().mode });
      location.hash = "#/lernen";
      return;
    }

    const theme = library.getTheme(themeId);
    if (!theme) return;
    if (!library.isThemeUnlocked(theme, points)) {
      const missing = Math.max(0, theme.unlockPoints - points);
      showToast(`Sammle noch ${missing} Punkte, dann öffnet sich „${theme.name}“!`, { type: "warn", iconName: "lock" });
      sfx.wrong();
      return;
    }
    if (!library.getWords(theme.id).length) {
      showToast("In diesem Thema sind noch keine Wörter. Eltern können welche hinzufügen.", { type: "warn" });
      return;
    }
    sfx.start();
    startSession({ themeId: theme.id, mode: learner.getSettings().mode });
    location.hash = "#/lernen";
  };

  main.addEventListener("click", onModeClick);
  main.addEventListener("click", onThemeClick);

  const allowButton = main.querySelector('[data-action="allow-online"]');
  allowButton?.addEventListener("click", () =>
    showConsentModal({ onDone: () => bus.emit("route:refresh") })
  );

  return () => {
    main.removeEventListener("click", onModeClick);
    main.removeEventListener("click", onThemeClick);
  };
}

/**
 * Fortschrittsseite: Level, Abzeichen, Themen, Leitner-Boxen,
 * schwache Wörter und die letzten Runden.
 */
import * as library from "../core/library.js";
import * as learner from "../core/learner.js";
import { icon, esc, formatDate, plural, showToast } from "../ui/dom.js";
import { mascot } from "../ui/mascot.js";
import { themeMedal } from "../ui/medal.js";
import { speak, unlockTts } from "../core/tts.js";
import { startSession } from "./session.js";

const MODE_LABELS = {
  speak: "Sprechen",
  listen: "Hören & Schreiben",
  write: "Schreiben",
  mix: "Mix",
};

function starsMarkup(count, size = 16) {
  return `<span class="stars-inline" aria-label="${count} von 3 Sternen">${[1, 2, 3]
    .map(
      (index) =>
        `<svg class="icon icon-star" style="width:${size}px;height:${size}px;color:${
          index <= count ? "#C98A00" : "#DCD3C4"
        }" aria-hidden="true"><use href="#i-star"/></svg>`
    )
    .join("")}</span>`;
}

export function renderProgress(main) {
  const profile = learner.getProfile();
  const level = learner.getLevelInfo();
  const progress = learner.getProgressMap();
  const themes = library.getThemes();
  const allWords = library.getAllWords();
  const boxes = learner.getBoxCounts();
  const streak = learner.getDisplayStreak();
  const daily = learner.getDailyGoal(learner.DAILY_GOAL_POINTS);
  const badges = learner.getBadgeStates();
  const earnedBadges = badges.filter((badge) => badge.earned);
  const milestones = learner.getMilestoneStates();
  const weak = learner.getWeakWords(allWords, 8);
  const mastered = [...progress.values()].filter((record) => record.seen && record.box >= 5).length;
  const started = [...progress.values()].filter((record) => record.seen).length;
  const seenTotal = Object.values(boxes).reduce((sum, value) => sum + value, 0);
  const accuracy =
    profile.totalAnswered > 0 ? Math.round((profile.totalCorrect / profile.totalAnswered) * 100) : null;

  const speakSeen = [...progress.values()].reduce((sum, r) => sum + (r.speakSeen || 0), 0);
  const speakCorrect = [...progress.values()].reduce((sum, r) => sum + (r.speakCorrect || 0), 0);
  const writeSeen = [...progress.values()].reduce((sum, r) => sum + (r.writeSeen || 0), 0);
  const writeCorrect = [...progress.values()].reduce((sum, r) => sum + (r.writeCorrect || 0), 0);
  const speakAcc = speakSeen ? Math.round((speakCorrect / speakSeen) * 100) : null;
  const writeAcc = writeSeen ? Math.round((writeCorrect / writeSeen) * 100) : null;

  const statCards = [
    { iconName: "star", value: profile.points, label: "Punkte gesammelt" },
    { iconName: "check", value: `${mastered} / ${allWords.length}`, label: "Wörter gemeistert" },
    { iconName: "chart", value: started, label: "Wörter angefangen" },
    { iconName: "mic", value: speakAcc === null ? "–" : `${speakAcc} %`, label: `Sprechen (${speakCorrect}/${speakSeen})` },
    { iconName: "pencil", value: writeAcc === null ? "–" : `${writeAcc} %`, label: `Schreiben (${writeCorrect}/${writeSeen})` },
    { iconName: "flame", value: `${streak} ${streak === 1 ? "Tag" : "Tage"}`, label: "Aktuelle Serie" },
  ];

  const themeRows = themes
    .map((theme) => {
      const stats = library.getThemeStats(theme.id, progress);
      const percent = stats.total ? Math.round((stats.mastered / stats.total) * 100) : 0;
      const isLocked = !library.isThemeUnlocked(theme, profile.points);
      const speakPct = stats.speakSeen ? Math.round((stats.speakCorrect / stats.speakSeen) * 100) : null;
      const writePct = stats.writeSeen ? Math.round((stats.writeCorrect / stats.writeSeen) * 100) : null;
      return `
        <div class="theme-progress-row">
          <span class="emoji" aria-hidden="true">${esc(theme.emoji)}</span>
          <div>
            <div class="row-between" style="gap:8px">
              <span class="name">${esc(theme.name)} ${themeMedal(percent) ? `<span class="theme-medal" aria-label="Themen-Medaille" title="Themen-Medaille">${themeMedal(percent)}</span>` : ""} ${isLocked ? `<span class="lock-chip" style="position:static;margin-left:6px">${icon("lock")} ${theme.unlockPoints}</span>` : ""}</span>
              <span class="tiny bold muted">${stats.mastered} / ${stats.total}</span>
            </div>
            <div class="progress-track" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Gemeistert in ${esc(theme.name)}">
              <div class="progress-fill ${percent >= 100 ? "green" : ""}" style="width:${percent}%"></div>
            </div>
            <div class="tiny muted" style="margin-top:4px">
              ${stats.started}/${stats.total} angefangen · ${speakPct === null ? "Sprechen –" : `Sprechen ${speakPct}%`} · ${writePct === null ? "Schreiben –" : `Schreiben ${writePct}%`}
            </div>
          </div>
          <div class="row" style="gap:4px">
            ${
              stats.total && !isLocked
                ? `<button type="button" class="btn btn-soft btn-small" data-practice="${esc(theme.id)}">Üben</button>`
                : ""
            }
          </div>
        </div>`;
    })
    .join("");

  const boxRows = [1, 2, 3, 4, 5]
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
    .join("");

  const badgeCards = badges
    .map(
      (badge) => `
      <div class="badge ${badge.earned ? "is-earned" : ""}">
        <span class="badge-icon" aria-hidden="true">${esc(badge.icon)}</span>
        <strong>${esc(badge.title)}</strong>
        <small>${badge.earned ? `Geschafft am ${esc(formatDate(badge.earnedAt))}` : esc(badge.description)}</small>
      </div>`
    )
    .join("");

  const milestoneCards = milestones
    .map(
      (milestone) => `
      <div class="milestone ${milestone.earned ? "is-earned" : ""}">
        <span class="milestone-icon" aria-hidden="true">${esc(milestone.icon)}</span>
        <span>
          <strong>${milestone.points} Punkte</strong>
          <small>${milestone.earned ? (milestone.earnedAt ? formatDate(milestone.earnedAt) : "Bereits geschafft") : `Noch ${milestone.remaining}`}</small>
        </span>
      </div>`
    )
    .join("");

  const weakRows = weak.length
    ? weak
        .map(
          ({ word, record }) => `
          <div class="weak-row">
            <span class="de">${esc(word.de)}</span>
            <span class="en">→ ${esc(word.en)}</span>
            <span class="meta">Box ${record.box} · ${record.correct}/${record.seen} richtig</span>
            <button type="button" class="icon-btn" data-speak="${esc(word.en)}" aria-label="${esc(word.en)} vorlesen">
              ${icon("speaker")}
            </button>
          </div>`
        )
        .join("")
    : `<div class="table-empty">Noch keine schwachen Wörter – super! 💪</div>`;

  main.innerHTML = `
    <div class="stack-lg">
      <section class="progress-hero" aria-labelledby="level-title">
        <div class="level-line">
          <div class="level-badge" aria-hidden="true"><small>Level</small><strong>${level.level}</strong></div>
          <div class="level-info">
            <h2 id="level-title">${esc(level.title)}</h2>
            <p>${profile.points} Punkte ${level.isMax ? "· höchste Stufe erreicht!" : `· noch ${level.pointsToNext} bis ${esc(level.nextTitle || "")}`}</p>
          </div>
        </div>
        <div class="next-level">
          <div class="row-between" style="gap:8px;margin-bottom:4px">
            <span class="tiny bold" style="color:rgba(255,255,255,.85)">Nächstes Level</span>
            <span class="tiny bold" style="color:rgba(255,255,255,.85)">${level.progressPercent} %</span>
          </div>
          <div class="progress-track" role="progressbar" aria-valuenow="${level.progressPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="Fortschritt zum nächsten Level">
            <div class="progress-fill" style="width:${level.progressPercent}%"></div>
          </div>
          <div class="row-between mt-2" style="gap:8px">
            <span class="tiny bold" style="color:rgba(255,255,255,.85)">Tagesziel ${daily.points}/${daily.goal} Punkte</span>
            <span class="tiny bold" style="color:rgba(255,255,255,.85)">${daily.percent} %</span>
          </div>
          <div class="progress-track" role="progressbar" aria-valuenow="${daily.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Tagesziel">
            <div class="progress-fill" style="width:${daily.percent}%"></div>
          </div>
        </div>
      </section>

      <section aria-labelledby="stats-title">
        <div class="section-head"><h2 id="stats-title">Zahlen &amp; Fakten</h2></div>
        <div class="stat-grid">
          ${statCards
            .map(
              (card) => `
            <div class="stat-card">
              <span class="stat-icon">${icon(card.iconName)}</span>
              <strong>${esc(String(card.value))}</strong>
              <span>${esc(card.label)}</span>
            </div>`
            )
            .join("")}
        </div>
      </section>

      <section aria-labelledby="themes-title">
        <div class="section-head">
          <h2 id="themes-title">Deine Themen</h2>
          <p>Gemeistert = 5-mal richtig in Folge (Box 5)</p>
        </div>
        <div class="theme-progress-list">${themeRows}</div>
      </section>

      <section aria-labelledby="boxes-title">
        <div class="section-head">
          <h2 id="boxes-title">Wiederholungs-Boxen</h2>
          <p>Leitner-System: Box 5 ist sicher im Langzeitgedächtnis</p>
        </div>
        <div class="panel">
          <div class="box-chart">${boxRows}</div>
          <p class="tiny muted mb-0 mt-2">
            Richtig beantwortete Wörter wandern eine Box weiter. Fehler bringen sie zurück in Box 1.
          </p>
        </div>
      </section>

      <section aria-labelledby="weak-title">
        <div class="section-head">
          <h2 id="weak-title">Das braucht noch Übung</h2>
          <p>${weak.length ? "Tippe auf den Lautsprecher, um das Wort zu hören." : ""}</p>
        </div>
        <div class="weak-list">${weakRows}</div>
      </section>

      <section aria-labelledby="badges-title">
        <div class="section-head">
          <h2 id="badges-title">Abzeichen &amp; Meilensteine</h2>
          <p>${earnedBadges.length} von ${badges.length} Abzeichen geschafft</p>
        </div>
        <div class="badge-grid">${badgeCards}</div>
        <h3 class="subhead" id="milestones-title">Punkt-Meilensteine</h3>
        <div class="milestone-grid" aria-labelledby="milestones-title">${milestoneCards}</div>
      </section>

      <section aria-labelledby="history-title">
        <div class="section-head">
          <h2 id="history-title">Letzte Runden</h2>
        </div>
        <div id="history-list" class="history-list">
          <div class="table-empty">Wird geladen …</div>
        </div>
      </section>

      <div class="mascot-row">
        ${mascot(level.level >= 5 ? "cheer" : "happy", { size: 86 })}
        <div class="mascot-bubble">${
          mastered >= allWords.length && allWords.length > 0
            ? "Du hast alle Wörter gemeistert. Unglaublich!"
            : `Noch ${Math.max(0, allWords.length - mastered)} Wörter bis zum großen Wortschatz. Du schaffst das!`
        }</div>
      </div>
    </div>
  `;

  // Lautsprecher für schwache Wörter
  main.querySelectorAll("[data-speak]").forEach((button) => {
    button.addEventListener("click", () => {
      unlockTts();
      speak(button.dataset.speak, { rate: learner.getSettings().speechRate || 0.9 });
    });
  });

  // Direkt ein Thema üben
  main.querySelectorAll("[data-practice]").forEach((button) => {
    button.addEventListener("click", () => {
      startSession({ themeId: button.dataset.practice, mode: learner.getSettings().mode });
      location.hash = "#/lernen";
    });
  });

  // Rundenverlauf nachladen
  let alive = true;
  learner
    .getSessions()
    .then((sessions) => {
      if (!alive) return;
      const list = main.querySelector("#history-list");
      if (!list) return;
      if (!sessions.length) {
        list.innerHTML = `<div class="table-empty">Noch keine Runde abgeschlossen. Los geht's! 🚀</div>`;
        return;
      }
      list.innerHTML = sessions
        .slice(0, 12)
        .map((session) => {
          const theme = session.themeId ? library.getTheme(session.themeId) : null;
          return `
            <div class="history-row">
              <span class="history-emoji" aria-hidden="true">${esc(theme?.emoji || "🌈")}</span>
              <div class="history-main">
                <strong>${esc(theme?.name || "Alle Themen")}</strong>
                <small>${esc(formatDate(session.at))} · ${esc(MODE_LABELS[session.mode] || "Mix")} · ${plural(session.totalWords || 0, "Wort", "Wörter")}</small>
              </div>
              ${starsMarkup(session.stars || 1)}
              <span class="history-points">+${session.points || 0}</span>
            </div>`;
        })
        .join("");
    })
    .catch(() => {
      const list = main.querySelector("#history-list");
      if (list) list.innerHTML = `<div class="table-empty">Der Verlauf konnte nicht geladen werden.</div>`;
      showToast("Der Rundenverlauf konnte nicht geladen werden.", { type: "warn" });
    });

  return () => {
    alive = false;
  };
}

export default renderProgress;

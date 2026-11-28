/**
 * Gemeinsame Darstellung der täglichen Übungszeit.
 * Wird von der Fortschrittsseite und vom Elternbereich genutzt.
 */
import { esc, formatDuration, formatDurationShort } from "./dom.js";

export function practiceSummaryMarkup(days) {
  const today = days.find((day) => day.isToday)?.durationMs || 0;
  const week = days.slice(-7).reduce((sum, day) => sum + day.durationMs, 0);
  const activeDays = days.filter((day) => day.durationMs > 0).length;

  return `
    <div class="practice-summary">
      <div><strong>${esc(formatDurationShort(today))}</strong><span>heute</span></div>
      <div><strong>${esc(formatDurationShort(week))}</strong><span>letzte 7 Tage</span></div>
      <div><strong>${activeDays} / ${days.length}</strong><span>aktive Tage</span></div>
    </div>`;
}

export function practiceChartMarkup(days) {
  const max = Math.max(1, ...days.map((day) => day.durationMs));

  return `
    <div class="practice-chart">
      ${days
        .map((day) => {
          const percent = Math.round((day.durationMs / max) * 100);
          return `
          <div class="practice-day ${day.isToday ? "is-today" : ""}"
               title="${esc(day.fullLabel)}: ${esc(formatDuration(day.durationMs))}"
               aria-label="${esc(day.fullLabel)}: ${esc(formatDuration(day.durationMs))}">
            <span class="practice-date">${esc(day.label)}</span>
            <span class="practice-bar" aria-hidden="true"><span style="width:${percent}%"></span></span>
            <span class="practice-time">${day.durationMs ? esc(formatDurationShort(day.durationMs)) : "–"}</span>
          </div>`;
        })
        .join("")}
    </div>`;
}

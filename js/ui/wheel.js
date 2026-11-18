/**
 * Kleines Glücksrad für die Zeit nach einer Lernrunde.
 *
 * Die Überraschung wird vor dem Speichern der Runde gewählt, damit ein
 * Punktgewinn sofort in Punkte, Tagesziel und Meilensteine einfließt.
 * Das Rad selbst ist nur die sichtbare Drehung: Es zeigt das schon
 * festgelegte Ergebnis an und respektiert "prefers-reduced-motion".
 */
import { openModal } from "./dom.js";
import { sfx } from "./sfx.js";

export const WHEEL_REWARDS = [
  { id: "coins", icon: "🪙", label: "+5 Punkte", points: 5, message: "Ein kleiner Bonus obendrauf!" },
  { id: "star", icon: "⭐", label: "+10 Punkte", points: 10, message: "Stark gedreht!" },
  { id: "gift", icon: "🎁", label: "+15 Punkte", points: 15, message: "Was für ein Gewinn!" },
  { id: "cheer", icon: "🎉", label: "Pip feiert!", points: 0, message: "Pip klatscht für dich!" },
  { id: "line", icon: "💬", label: "Pip-Spruch", points: 0, message: "Pip sagt: „Du schaffst das!“" },
  { id: "stars", icon: "🌟", label: "Sternenregen", points: 0, message: "Nur für dich: ein Sternenregen!" },
];

/** Wählt eine Überraschung aus. Bewusst ohne Gewichtung – alles ist positiv. */
export function pickWheelReward() {
  return WHEEL_REWARDS[Math.floor(Math.random() * WHEEL_REWARDS.length)];
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

/**
 * Zeigt das Glücksrad und löst beim Schließen das übergebene Ergebnis auf.
 * @param {object} reward einer der WHEEL_REWARDS
 */
export function showWheel(reward = pickWheelReward()) {
  return new Promise((resolve) => {
    const content = document.createElement("div");
    content.className = "wheel-stage";
    content.innerHTML = `
      <div class="wheel-wrap">
        <span class="wheel-pointer" aria-hidden="true"></span>
        <div class="wheel-disc" role="img" aria-label="Glücksrad mit sechs Überraschungen">
          ${WHEEL_REWARDS.map(
            (item, index) => `<span class="wheel-label" style="--i:${index}" aria-hidden="true"><span>${item.icon}</span></span>`
          ).join("")}
          <span class="wheel-hub" aria-hidden="true">Pip</span>
        </div>
      </div>
      <p class="wheel-result" aria-live="polite">Das Rad dreht sich …</p>`;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(reward);
    };

    openModal({
      title: "Glücksrad!",
      subtitle: "Mal sehen, was Pip für dich aufgeladen hat.",
      content,
      size: "wheel-modal",
      actions: [{ label: "Super!", grow: true, onClick: finish }],
      onClose: finish,
    });

    const disc = content.querySelector(".wheel-disc");
    const result = content.querySelector(".wheel-result");
    const index = Math.max(0, WHEEL_REWARDS.indexOf(reward));
    const targetAngle = 360 * 4 + (360 - index * 60);

    const reveal = () => {
      if (settled || !result) return;
      result.innerHTML = `<span class="wheel-result-icon" aria-hidden="true">${reward.icon}</span>
        <strong>${reward.label}</strong><small>${reward.message}</small>`;
      sfx.celebrate();
    };

    if (prefersReducedMotion()) {
      if (disc) disc.style.transform = `rotate(${targetAngle}deg)`;
      reveal();
      return;
    }

    requestAnimationFrame(() => {
      if (disc) disc.style.transform = `rotate(${targetAngle}deg)`;
    });
    setTimeout(reveal, 1500);
  });
}

export default { WHEEL_REWARDS, pickWheelReward, showWheel };

/**
 * „Pip“ – das Maskottchen von SpeakUp.
 * Inline-SVG mit Stimmungen: happy, cheer, oops, think.
 * Das SVG ist dekorativ (aria-hidden); Texte stehen daneben im DOM.
 */

const MOUTHS = {
  happy: `<path d="M78 116 Q100 136 122 116" fill="none" stroke="#23304A" stroke-width="5" stroke-linecap="round"/>`,
  cheer: `<path d="M76 112 Q100 150 124 112 Z" fill="#8A2F43"/><path d="M88 132 Q100 143 112 132" fill="#FF8FA8"/>`,
  oops: `<path d="M82 130 Q100 116 118 130" fill="none" stroke="#23304A" stroke-width="5" stroke-linecap="round"/>`,
  think: `<circle cx="108" cy="126" r="6" fill="#23304A"/>`,
  sleepy: `<path d="M84 126 H116" fill="none" stroke="#23304A" stroke-width="5" stroke-linecap="round"/>`,
};

const EYES = {
  happy: `
    <ellipse cx="72" cy="92" rx="14" ry="16" fill="#23304A"/>
    <ellipse cx="128" cy="92" rx="14" ry="16" fill="#23304A"/>
    <circle cx="76" cy="86" r="5" fill="#fff"/>
    <circle cx="132" cy="86" r="5" fill="#fff"/>`,
  cheer: `
    <path d="M58 94 Q72 78 86 94" fill="none" stroke="#23304A" stroke-width="5" stroke-linecap="round"/>
    <path d="M114 94 Q128 78 142 94" fill="none" stroke="#23304A" stroke-width="5" stroke-linecap="round"/>`,
  oops: `
    <circle cx="72" cy="94" r="13" fill="#23304A"/>
    <circle cx="128" cy="94" r="13" fill="#23304A"/>
    <circle cx="75" cy="89" r="4" fill="#fff"/>
    <circle cx="131" cy="89" r="4" fill="#fff"/>`,
  think: `
    <circle cx="72" cy="90" r="13" fill="#23304A"/>
    <circle cx="128" cy="90" r="13" fill="#23304A"/>
    <circle cx="76" cy="85" r="4" fill="#fff"/>
    <circle cx="132" cy="85" r="4" fill="#fff"/>`,
  sleepy: `
    <path d="M58 94 Q72 104 86 94" fill="none" stroke="#23304A" stroke-width="5" stroke-linecap="round"/>
    <path d="M114 94 Q128 104 142 94" fill="none" stroke="#23304A" stroke-width="5" stroke-linecap="round"/>`,
};

const ARMS = {
  normal: `
    <path d="M36 118 C18 124 12 142 20 152" fill="none" stroke="#0E8F84" stroke-width="13" stroke-linecap="round"/>
    <path d="M164 118 C182 124 188 142 180 152" fill="none" stroke="#0E8F84" stroke-width="13" stroke-linecap="round"/>`,
  cheer: `
    <path d="M40 112 C20 98 14 78 22 66" fill="none" stroke="#0E8F84" stroke-width="13" stroke-linecap="round"/>
    <path d="M160 112 C180 98 186 78 178 66" fill="none" stroke="#0E8F84" stroke-width="13" stroke-linecap="round"/>`,
};

export function mascot(mood = "happy", { size = 130, className = "" } = {}) {
  const safeMood = MOUTHS[mood] ? mood : "happy";
  const arms = ARMS[safeMood === "cheer" ? "cheer" : "normal"];
  const sparkles = safeMood === "cheer"
    ? `<g fill="#FFC83D"><path d="M22 48 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z"/><path d="M178 44 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" opacity=".9"/></g>`
    : "";
  return `
  <svg class="mascot ${className}" width="${size}" height="${size}" viewBox="0 0 200 200" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    ${sparkles}
    <ellipse cx="100" cy="185" rx="56" ry="8" fill="#241F45" opacity=".12"/>
    <g class="mascot-body">
      <path d="M100 34 C142 34 168 62 169 104 L170 140 C171 168 145 181 100 181 C55 181 29 168 30 140 L31 104 C32 62 58 34 100 34 Z"
            fill="#23BFAF" stroke="#0E8F84" stroke-width="4" stroke-linejoin="round"/>
      <path d="M100 36 C94 18 104 8 116 16" fill="none" stroke="#0E8F84" stroke-width="5" stroke-linecap="round"/>
      <circle cx="119" cy="14" r="12" fill="#FFC83D" stroke="#D9A300" stroke-width="3"/>
      <ellipse cx="100" cy="138" rx="47" ry="33" fill="#D8F9F4"/>
      ${arms}
      <ellipse cx="72" cy="176" rx="19" ry="10" fill="#0E8F84"/>
      <ellipse cx="128" cy="176" rx="19" ry="10" fill="#0E8F84"/>
      <circle cx="53" cy="119" r="10" fill="#FF9EC4" opacity=".8"/>
      <circle cx="147" cy="119" r="10" fill="#FF9EC4" opacity=".8"/>
      <g class="mascot-eye">${EYES[safeMood]}</g>
      ${MOUTHS[safeMood]}
      <circle cx="55" cy="66" r="6" fill="#7CE3D8" opacity=".75"/>
      <circle cx="146" cy="58" r="4" fill="#7CE3D8" opacity=".75"/>
    </g>
  </svg>`;
}

export const MASCOT_LINES = {
  welcome: "Hi! Ich bin Pip. Sag laut „Speak up!“ und wir lernen zusammen Englisch.",
  speak: "Sprich laut und deutlich. Du schaffst das!",
  listen: "Hör genau hin. Ich sage dir das englische Wort vor.",
  write: "Schreib das Wort mit dem Stift auf. Ganz in Ruhe!",
  mix: "Jetzt wird es bunt: Sprache, Hören und Schreiben im Wechsel!",
  correct: ["Super gemacht!", "Genau so!", "Klasse!", "Das sitzt!"],
  wrong: ["Fast! Schau dir die Lösung an.", "Kopf hoch, weiter geht's!", "Übung macht den Meister."],
  streak: ["Wow, du bist in Form!", "Nicht zu stoppen!", "Was für eine Serie!"],
};

export function randomLine(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export default mascot;

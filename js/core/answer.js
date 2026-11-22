/**
 * Toleranter Antwortvergleich.
 * Akzeptiert Groß-/Kleinschreibung, Leerzeichen, Satzzeichen, Akzente,
 * Artikel ("the/a/an") sowie alle hinterlegten Alternativen.
 */
import { normalizeKey } from "./hash.js";

export function normalizeAnswer(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Akzente entfernen (café → cafe)
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[.,!?;:"“”„()\[\]{}<>]/g, " ")
    .replace(/[-_/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LEADING_FILLERS = [
  /^(?:it is|it s|its|that is|that s|this is)\s+(?:a|an|the)?\s*/,
  /^(?:a|an|the)\s+/,
  /^(?:i say|i think|the answer is)\s+/,
];

function withoutFillers(value) {
  let text = value;
  for (let i = 0; i < 3; i++) {
    const before = text;
    for (const pattern of LEADING_FILLERS) text = text.replace(pattern, "");
    if (text === before) break;
  }
  return text.trim();
}

function compact(value) {
  return value.replace(/\s+/g, "");
}

/**
 * Erkennt einen einzelnen Buchstabendreher an derselben Stelle, z. B.
 * "dgo" statt "dog". Levenshtein zählt dafür zwei Änderungen; für die
 * Erkennung von Hör-/Lesefehlern ist ein Dreher aber ein kleiner Fehler.
 */
function hasAdjacentSwap(a, b) {
  if (a.length !== b.length || a === b) return false;
  let first = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      first = i;
      break;
    }
  }
  if (first < 0 || first + 1 >= a.length) return false;
  if (a[first] !== b[first + 1] || a[first + 1] !== b[first]) return false;
  for (let i = first + 2; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = current;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - levenshtein(a, b) / max;
}

export function acceptedAnswers(word) {
  const list = [word?.en, ...(word?.alternatives || [])]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
  return [...new Set(list)];
}

/* ---------- Erkennungsfehler erkennen ---------- */

/**
 * Ziffern, die bei Handschrift oder OCR leicht mit Buchstaben verwechselt
 * werden (z. B. "d0g" statt "dog"). Wird nur für die Plausibilitätsprüfung
 * verwendet, nicht für die normale Antwortbewertung.
 */
const DIGIT_LOOKALIKES = {
  0: "o",
  1: "l",
  2: "z",
  3: "e",
  4: "a",
  5: "s",
  6: "g",
  7: "t",
  8: "b",
  9: "g",
};

function foldDigitLookalikes(value) {
  return value.replace(/\d/g, (digit) => DIGIT_LOOKALIKES[digit] || digit);
}

/**
 * Alle Schreibvarianten eines Textes, die für einen Erkennungsfehler
 * relevant sind: mit/ohne Füllwörter, mit/ohne Leerzeichen und mit
 * korrigierten Ziffern.
 */
function comparisonVariants(value) {
  const normalized = normalizeAnswer(value);
  if (!normalized) return [];
  const folded = foldDigitLookalikes(normalized);
  return [
    ...new Set(
      [
        normalized,
        withoutFillers(normalized),
        compact(normalized),
        compact(withoutFillers(normalized)),
        folded,
        withoutFillers(folded),
        compact(folded),
        compact(withoutFillers(folded)),
      ].filter(Boolean)
    )
  ];
}

/**
 * Prüft, ob eine falsche Antwort plausibel durch Sprach- oder
 * Schrifterkennung entstanden sein könnte – also nur ein klein wenig von
 * der Lösung abweicht. Nur dann bietet die Lernrunde die manuelle
 * Wertung „dennoch richtig“ an.
 *
 * Beispiele: "dgo" statt "dog", "d0g" statt "dog", "ice,cream" statt
 * "ice cream" oder ein zusätzliches Wort in einem gesprochenen Satz.
 *
 * @returns {boolean}
 */
export function isNearMiss(input, word) {
  const answers = acceptedAnswers(word);
  const inputVariants = comparisonVariants(input);
  if (!answers.length || !inputVariants.length) return false;

  for (const answer of answers) {
    const answerVariants = comparisonVariants(answer);
    for (const a of inputVariants) {
      for (const b of answerVariants) {
        if (a === b) return true;

        const shortest = Math.min(a.length, b.length);
        const longest = Math.max(a.length, b.length);
        // Einzelne Buchstaben und sehr kurze Reste sind zu unsicher.
        if (shortest < 3) continue;

        // Die Lösung steckt als ganzes Wort in der Erkennung (oder umgekehrt),
        // z. B. "I would like a dog please" → "dog", "ice" → "ice cream".
        if (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)) return true;

        // Zusammengeschriebene Varianten mit einem zusätzlichen Zeichen.
        if (longest - shortest <= 2 && (a.includes(b) || b.includes(a))) return true;

        // Einzelner Buchstabendreher (bei kurzen Wörtern zählt Levenshtein
        // dafür bereits zwei Änderungen).
        if (hasAdjacentSwap(a, b)) return true;

        // Kleine Tipp-/Erkennungsfehler: ein Zeichen daneben, bei längeren
        // Wörtern auch zwei oder drei (Buchstabendreher, fehlender Buchstabe).
        const distance = levenshtein(a, b);
        if (distance <= 1) return true;
        if (longest >= 5 && distance <= 2) return true;
        if (longest >= 8 && distance <= 3) return true;
      }
    }
  }

  return false;
}

/**
 * Prüft eine Eingabe gegen ein Wort.
 * @returns {{correct: boolean, matched: string|null, normalized: string}}
 */
export function checkAnswer(input, word) {
  const answers = acceptedAnswers(word);
  const normalizedInput = normalizeAnswer(input);
  if (!normalizedInput) return { correct: false, matched: null, normalized: normalizedInput };

  const inputVariants = new Set([
    normalizedInput,
    withoutFillers(normalizedInput),
    compact(normalizedInput),
    compact(withoutFillers(normalizedInput)),
  ]);

  for (const answer of answers) {
    const normalizedAnswer = normalizeAnswer(answer);
    if (!normalizedAnswer) continue;
    const answerVariants = new Set([
      normalizedAnswer,
      withoutFillers(normalizedAnswer),
      compact(normalizedAnswer),
      compact(withoutFillers(normalizedAnswer)),
    ]);
    for (const variant of answerVariants) {
      if (inputVariants.has(variant)) return { correct: true, matched: answer, normalized: normalizedInput };
    }
    // Ganze Wörter in einem Satz, z. B. "It's a dog!" → "dog"
    // Auch kurze einsilbige Wörter akzeptieren (dog, cat, red, ...).
    const searchVariants = [normalizedAnswer, withoutFillers(normalizedAnswer)].filter(Boolean);
    for (const target of searchVariants) {
      if (target.length >= 2 && inputVariants.has(target)) {
        return { correct: true, matched: answer, normalized: normalizedInput };
      }
      if (target.length >= 2 && ` ${normalizedInput} `.includes(` ${target} `)) {
        return { correct: true, matched: answer, normalized: normalizedInput };
      }
    }
  }

  // Spracherkennung liefert manchmal kleine Abweichungen. Nur bei
  // ausreichend ähnlichen, längeren Wörtern tolerant sein.
  const base = withoutFillers(normalizedInput);
  for (const answer of answers) {
    const target = withoutFillers(normalizeAnswer(answer));
    if (!target) continue;
    if (target.length >= 5 && base.length >= 4 && Math.abs(target.length - base.length) <= 3) {
      if (similarity(target, base) >= 0.84) {
        return { correct: true, matched: answer, normalized: normalizedInput, fuzzy: true };
      }
    }
  }

  return { correct: false, matched: null, normalized: normalizedInput };
}

export default checkAnswer;

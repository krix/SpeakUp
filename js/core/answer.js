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
    const searchVariants = [normalizedAnswer, withoutFillers(normalizedAnswer)].filter(Boolean);
    for (const target of searchVariants) {
      if (target.length >= 3 && inputVariants.has(target)) {
        return { correct: true, matched: answer, normalized: normalizedInput };
      }
      if (target.length >= 4 && ` ${normalizedInput} `.includes(` ${target} `)) {
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

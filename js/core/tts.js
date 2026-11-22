/**
 * Sprachausgabe mit SpeechSynthesis (en-GB/en-US).
 * Die Stimme wird bevorzugt lokal gewählt, damit es auch offline klappt,
 * wenn das Gerät eine englische Stimme installiert hat.
 */

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
let voices = [];
let preferredVoice = null;
let activeUtterance = null;
let activeResolve = null;

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices() || [];
  preferredVoice =
    voices.find((voice) => voice.lang === "en-GB" && /female|samantha|libby|sonia|kate|serena/i.test(voice.name)) ||
    voices.find((voice) => voice.lang === "en-GB" && voice.localService) ||
    voices.find((voice) => voice.lang === "en-US" && /female|samantha|aria|jenny|zira/i.test(voice.name)) ||
    voices.find((voice) => voice.lang === "en-US" && voice.localService) ||
    voices.find((voice) => /^en(-|_)/i.test(voice.lang)) ||
    null;
}

if (synth) {
  loadVoices();
  synth.addEventListener?.("voiceschanged", loadVoices);
}

export function isTtsSupported() {
  return Boolean(synth && typeof window.SpeechSynthesisUtterance === "function");
}

export function getVoiceLabel() {
  if (!preferredVoice) return "Standardstimme des Geräts";
  return `${preferredVoice.name} (${preferredVoice.lang})`;
}

/** Muss ggf. nach einer Nutzer-Geste aufgerufen werden (iOS). */
export function unlockTts() {
  if (!synth) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
    synth.cancel();
    loadVoices();
  } catch {
    /* nicht kritisch */
  }
}

export function stopSpeaking() {
  if (!synth) return;
  try {
    synth.cancel();
  } catch {
    /* ignorieren */
  }
  if (activeResolve) {
    activeResolve(false);
    activeResolve = null;
  }
  activeUtterance = null;
}

/**
 * Spricht englischen (oder deutschen) Text.
 * @returns {Promise<boolean>} true, wenn die Ausgabe beendet wurde.
 */
export function speak(text, { rate = 0.9, lang = null, pitch = 1.03, onEnd = null } = {}) {
  if (!isTtsSupported() || !text) {
    onEnd?.(false);
    return Promise.resolve(false);
  }
  stopSpeaking();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      activeResolve = null;
      activeUtterance = null;
      resolve(ok);
      try { onEnd?.(ok); } catch {}
    };

    const utterance = new SpeechSynthesisUtterance(String(text));
    activeUtterance = utterance;
    activeResolve = finish;

    if (!voices.length) loadVoices();
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.lang = lang || preferredVoice?.lang || "en-GB";
    utterance.rate = Math.min(1.2, Math.max(0.5, Number(rate) || 0.9));
    utterance.pitch = pitch;
    utterance.volume = 1;

    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);

    const timeout = setTimeout(() => finish(false), 12000);
    try {
      synth.speak(utterance);
    } catch {
      finish(false);
    }
  });
}

export function isSpeaking() {
  return Boolean(synth?.speaking);
}

export { preferredVoice, voices };

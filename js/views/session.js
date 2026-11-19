/**
 * Lernsitzung: 10 Wörter pro Runde, vier Modi.
 *
 * Ablauf pro Wort:
 *   1. Frage anzeigen (sprechen / hören / schreiben)
 *   2. Antwort prüfen (Spracherkennung, Handschrift oder Tastatur)
 *   3. Feedback mit Lösung und Beispielsatz
 *   4. Falsche Wörter kommen ans Ende der Runde (ein zweiter Versuch)
 *
 * Der Leitner-Fortschritt wird sofort gespeichert. Ein Wort steigt nur
 * dann eine Box auf, wenn der erste Versuch in dieser Runde stimmt.
 */
import * as library from "../core/library.js";
import * as learner from "../core/learner.js";
import { checkAnswer, isNearMiss } from "../core/answer.js";
import { speak, stopSpeaking, unlockTts } from "../core/tts.js";
import {
  createSpeechRecognizer,
  isSpeechSupported,
  requestMicrophoneStream,
  speechSupportHint,
  stopMicrophoneStream,
} from "../core/speech.js";
import { recognizeHandwriting } from "../core/handwriting.js";
import { DrawingPad } from "../ui/canvas.js";
import {
  icon,
  esc,
  showToast,
  confirmDialog,
  starSvg,
  plural,
} from "../ui/dom.js";
import { mascot, MASCOT_LINES, randomLine } from "../ui/mascot.js";
import { sfx } from "../ui/sfx.js";
import { pickWheelReward, showWheel } from "../ui/wheel.js";
import { confetti } from "../ui/confetti.js";
import { showConsentModal } from "./onboarding.js";

const ROUND_SIZE = 10;
const POINTS_FIRST_TRY = 10;
const POINTS_RETRY = 4;
const MAX_QUEUE = 24;

const MODE_INFO = {
  speak: { label: "Sprechen", iconName: "mic" },
  listen: { label: "Hören & Schreiben", iconName: "speaker" },
  write: { label: "Schreiben", iconName: "pencil" },
};

const MIX_CYCLE = ["speak", "listen", "write"];

/** Sichtbare Lücke für das gesuchte Wort – enthält nie die Lösung. */
const WORD_GAP = `<span class="word-gap" aria-label="Lücke">_____</span>`;

/**
 * Baut aus dem gespeicherten Beispielsatz eine Lückenvariante.
 * Die gesuchte Antwort und alle akzeptierten Alternativen werden maskiert,
 * damit der Satz zwar Kontext gibt, die Lösung aber nicht ablesbar ist.
 * Einfache Flexionen (dog → dogs, paint → painting) werden mit abgedeckt.
 */
function maskExampleWord(word) {
  const example = String(word?.example || "").trim();
  if (!example) return "";

  const terms = [word.en, ...(word.alternatives || [])]
    .flatMap((value) => {
      const term = String(value ?? "").replace(/\s+/g, " ").trim();
      if (!term) return [];
      // „to swim“ soll auch ein einfaches „swim“ im Satz verdecken.
      const bare = term.replace(/^to\s+/i, "").trim();
      return bare && bare !== term ? [term, bare] : [term];
    })
    .map((term) => term.toLocaleLowerCase("en"))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (!terms.length) return esc(example);

  const escaped = [...new Set(terms)]
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
    .map((term) => `${term}(?:s|es|ed|ing)?`)
    .join("|");

  // Der Rand darf kein Buchstabe/Zahl sein – „car“ trifft also nicht „carpet“.
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "giu");

  let html = "";
  let cursor = 0;
  for (const match of example.matchAll(pattern)) {
    html += esc(example.slice(cursor, match.index));
    html += esc(match[1] || ""); // Trennzeichen vor der Lücke bleibt erhalten.
    html += WORD_GAP;
    cursor = match.index + match[0].length;
  }
  html += esc(example.slice(cursor));
  return html;
}

/** Beispielsatz mit Lücke für die Fragekarte. */
function renderExample(word) {
  const masked = maskExampleWord(word);
  if (!masked) return "";
  return `
    <p class="example-sentence">
      ${icon("speaker")}
      <span class="example-label">Beispiel:</span>
      <em>${masked}</em>
    </p>`;
}

/** Wird von der Startseite aufgerufen, bevor die Route gewechselt wird. */
let pendingConfig = null;

export function startSession({ themeId = null, mode = "mix" } = {}) {
  pendingConfig = { themeId, mode };
}

/** Wird vom Router für #/lernen aufgerufen. */
export function renderSession(main) {
  const settings = learner.getSettings();
  const config = pendingConfig || {
    themeId: settings.lastThemeId || null,
    mode: settings.mode || "mix",
  };
  pendingConfig = null;

  const pool = getWordPool(config.themeId);
  if (!pool.length) {
    renderEmpty(main);
    return () => {};
  }

  let roundCleanup = null;
  const restart = () => {
    roundCleanup?.();
    roundCleanup = runRound(main, config, restart);
  };
  restart();

  return () => {
    roundCleanup?.();
    stopSpeaking();
  };
}

/* ---------- Wörter auswählen ---------- */

function getWordPool(themeId) {
  if (themeId) {
    const theme = library.getTheme(themeId);
    if (!theme) return [];
    return library.getWords(themeId);
  }
  // "Alle Themen": nur freigeschaltete Welten, damit gesperrte Wörter
  // nicht versehentlich geübt werden.
  const points = learner.getProfile()?.points || 0;
  const themes = library.getThemes().filter((theme) => library.isThemeUnlocked(theme, points));
  return themes.flatMap((theme) => library.getWords(theme.id));
}

/* ---------- Leere Runde ---------- */

function renderEmpty(main) {
  main.innerHTML = `
    <div class="session">
      <div class="card panel center">
        ${mascot("think", { size: 110 })}
        <h1 class="mt-2">Hier sind noch keine Wörter</h1>
        <p class="muted">Für dieses Thema sind noch keine Vokabeln hinterlegt.
        Ein Erwachsener kann im Elternbereich Wörter hinzufügen.</p>
        <div class="btn-row" style="justify-content:center">
          <a class="btn" href="#/home">${icon("home")} Zur Startseite</a>
          <a class="btn btn-ghost" href="#/eltern">${icon("lock")} Elternbereich</a>
        </div>
      </div>
    </div>`;
}

/* ---------- Eine komplette Runde ---------- */

function runRound(main, config, onRestart) {
  const settings = learner.getSettings();
  const allowOnline = learner.canUseOnlineFeatures();
  const handwritingAllowed =
    allowOnline &&
    settings.handwriting !== false &&
    settings.handwritingProvider !== "off";

  const theme = config.themeId ? library.getTheme(config.themeId) : null;
  const pool = getWordPool(config.themeId);
  const selected = learner.selectSessionWords(pool, ROUND_SIZE);
  const initialWords = [...selected];

  const state = {
    alive: true,
    themeName: theme?.name || "Alle Themen",
    baseMode: config.mode,
    allowOnline,
    handwritingAllowed,
    queue: selected.map((word) => ({ word, mode: null })),
    index: 0,
    total: selected.length,
    answered: false,
    attempts: 0,
    correctAttempts: 0,
    firstTryCorrect: 0,
    maxStreak: 0,
    streak: 0,
    points: 0,
    modeCorrect: { speak: 0, listen: 0, write: 0 },
    attemptsByWord: new Map(),
    wrongByWord: new Map(),
    firstPassDone: new Set(),
    startedAt: Date.now(),
    modeCounter: 0,
    current: null,
    recognizer: null,
    pad: null,
    timer: null,
  };

  main.innerHTML = `
    <div class="session">
      <div class="session-top">
        <button type="button" class="icon-btn" data-action="quit" aria-label="Runde beenden">
          ${icon("close")}
        </button>
        <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
             aria-valuenow="0" aria-label="Fortschritt der Runde" id="session-progressbar">
          <div class="progress-fill" id="session-progress" style="width:0%"></div>
        </div>
        <span class="session-count" id="session-count">1 / ${state.total}</span>
      </div>
      <div id="session-stage"></div>
    </div>`;

  const stage = main.querySelector("#session-stage");

  /* --- Aufräumen pro Frage (Pad, Erkennung, Timer) --- */
  function cleanupQuestion() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.recognizer) {
      try {
        state.recognizer.abort();
      } catch {
        /* ignorieren */
      }
      state.recognizer = null;
    }
    if (state.pad) {
      state.pad.destroy();
      state.pad = null;
    }
    stopSpeaking();
  }

  function cleanup() {
    state.alive = false;
    cleanupQuestion();
  }

  /* --- Fortschritt in der Kopfzeile --- */
  function updateProgress() {
    const done = state.firstPassDone.size;
    const percent = state.total ? Math.round((done / state.total) * 100) : 0;
    const fill = main.querySelector("#session-progress");
    const bar = main.querySelector("#session-progressbar");
    const count = main.querySelector("#session-count");
    if (fill) fill.style.width = `${percent}%`;
    if (bar) bar.setAttribute("aria-valuenow", String(percent));
    if (count) {
      const shown = Math.min(done + 1, state.total);
      count.textContent = `${shown} / ${state.total}`;
    }
  }

  /* --- Modus für das nächste Wort bestimmen --- */
  function pickMode() {
    if (state.baseMode !== "mix") return state.baseMode;
    return MIX_CYCLE[state.modeCounter++ % MIX_CYCLE.length];
  }

  /* --- Nächste Frage --- */
  function showQuestion() {
    if (!state.alive) return;
    cleanupQuestion();
    state.answered = false;

    if (state.index >= state.queue.length) {
      showResults();
      return;
    }

    updateProgress();
    const entry = state.queue[state.index];
    if (!entry.mode) entry.mode = pickMode();
    const word = entry.word;
    // Ohne Online-Einwilligung wird "Sprechen" zur Schreibaufgabe mit Tastatur.
    const mode = entry.mode === "speak" && !state.allowOnline ? "write" : entry.mode;
    state.current = { word, mode, entry };

    stage.innerHTML = renderQuestion(word, mode);

    if (mode === "speak") bindSpeakQuestion(word);
    else bindWritingQuestion(word, mode);

    updateProgress();

    // Höraufgabe automatisch vorsprechen.
    if (mode === "listen" && settings.autoSpeak !== false) {
      state.timer = setTimeout(() => {
        if (state.alive && !state.answered) speakWord(word.en);
      }, 420);
    }

    const card = stage.querySelector(".question-card");
    card?.focus({ preventScroll: true });
  }

  /* --- Fragen-HTML ---------- */

  function renderQuestion(word, mode) {
    const info = MODE_INFO[mode] || MODE_INFO.write;
    const emoji = word.emoji || "💬";
    const badge = `<span class="mode-badge">${icon(info.iconName)} ${esc(info.label)}</span>`;
    const example = renderExample(word);

    if (mode === "speak") {
      return `
        <div class="question-card" tabindex="-1" aria-labelledby="question-title">
          ${badge}
          <div class="question-main">
            <span class="prompt-emoji" aria-hidden="true">${esc(emoji)}</span>
            <div>
              <h1 class="prompt-de" id="question-title">${esc(word.de)}</h1>
              <p class="prompt-sub">Sag das englische Wort laut.</p>
            </div>
          </div>
          ${example}
          <p class="instruction">Tippe auf das Mikrofon und sprich <strong>deutlich</strong>.
            Du kannst auch lieber tippen.</p>

          <div class="speak-area">
            <button type="button" class="mic-btn" data-action="mic" aria-label="Mikrofon starten und Wort sprechen">
              ${icon("mic")}
            </button>
            <span class="mic-label" id="mic-label">Tippe zum Sprechen</span>
            <div class="heard-box" id="heard-box" aria-live="polite">Ich höre zu, sobald du tippst …</div>
          </div>

          <div class="listen-help">
            <button type="button" class="btn-link" data-action="show-typing">
              ${icon("keyboard")} Lieber tippen
            </button>
          </div>
          <div id="typing-slot"></div>
        </div>`;
    }

    // Hören und Schreiben
    if (mode === "listen") {
      return `
        <div class="question-card" tabindex="-1" aria-labelledby="question-title">
          ${badge}
          <div class="question-main">
            <span class="prompt-emoji" aria-hidden="true">🔊</span>
            <div>
              <h1 class="prompt-de" id="question-title">Hör gut zu!</h1>
              <p class="prompt-sub">Schreib das englische Wort auf.</p>
            </div>
          </div>
          ${example}
          <div class="listen-help">
            <button type="button" class="listen-btn" data-action="speak-word">
              ${icon("speaker")} Wort vorsprechen
            </button>
          </div>
          <div class="listen-word-fallback" id="reveal-slot">
            <button type="button" class="btn-link" data-action="reveal">Deutsches Wort anzeigen</button>
          </div>
          ${renderWritingArea(mode)}
        </div>`;
    }

    // Schreiben (deutsch → englisch)
    return `
      <div class="question-card" tabindex="-1" aria-labelledby="question-title">
        ${badge}
        <div class="question-main">
          <span class="prompt-emoji" aria-hidden="true">${esc(emoji)}</span>
          <div>
            <h1 class="prompt-de" id="question-title">${esc(word.de)}</h1>
            <p class="prompt-sub">Wie heißt das auf Englisch?</p>
          </div>
        </div>
        ${example}
        ${renderWritingArea(mode)}
      </div>`;
  }

  function renderWritingArea(mode) {
    const padMarkup = state.handwritingAllowed
      ? `
        <div class="pad-wrap">
          <div class="pad-toolbar">
            <span class="small bold">${icon("pencil")} Schreibe hier</span>
            <span class="spacer"></span>
            <button type="button" class="icon-btn" data-action="pad-undo" aria-label="Letzten Strich löschen">
              ${icon("undo")}
            </button>
            <button type="button" class="icon-btn" data-action="pad-clear" aria-label="Zeichenfläche leeren">
              ${icon("trash")}
            </button>
          </div>
          <canvas class="pad" id="pad"></canvas>
          <div class="pad-hint" id="pad-hint">Mit Stift oder Finger in Druckbuchstaben schreiben</div>
          <div class="pad-status" id="pad-status" role="status" aria-live="polite"></div>
          <div class="btn-row mt-1">
            <button type="button" class="btn" data-action="pad-check">
              ${icon("check")} Prüfen
            </button>
            <button type="button" class="btn-link" data-action="show-typing">
              ${icon("keyboard")} Lieber tippen
            </button>
          </div>
        </div>
        <div id="typing-slot"></div>`
      : `
        <div class="callout mt-2">
          ${icon("keyboard")}
          <div>
            <p class="mb-0"><strong>Tippen ist angesagt.</strong>
            ${mode === "listen" ? "" : "Handschrift ist ausgeschaltet oder nicht erlaubt."}
            Schreibe das englische Wort in das Feld.</p>
          </div>
        </div>
        <div id="typing-slot"></div>`;

    return padMarkup;
  }

  function typingMarkup() {
    return `
      <div class="typing-fallback">
        <h3>${icon("keyboard")} Antwort tippen</h3>
        <form class="typing-row" data-form="typing" autocomplete="off">
          <input class="input" type="text" name="answer" id="typing-answer"
                 aria-label="Englische Antwort eintippen"
                 placeholder="Englisch …" autocomplete="off" autocapitalize="none"
                 autocorrect="off" spellcheck="false" enterkeyhint="done">
          <button class="btn btn-small" type="submit">${icon("check")} Prüfen</button>
        </form>
        <p class="tiny muted mb-0 mt-1">Groß- und Kleinschreibung ist egal.</p>
      </div>`;
  }

  /* --- Sprechen binden ---------- */
  function bindSpeakQuestion(word) {
    const micButton = stage.querySelector('[data-action="mic"]');
    const label = stage.querySelector("#mic-label");
    const heard = stage.querySelector("#heard-box");
    let listening = false;
    let starting = false;

    /** Drei Zustände: bereit, wird vorbereitet, hört wirklich zu. */
    const setMicState = (state) => {
      starting = state === "starting";
      listening = state === "listening";
      const busy = state === "starting";
      micButton?.classList.toggle("is-listening", listening);
      micButton?.classList.toggle("is-starting", busy);
      micButton?.toggleAttribute("disabled", busy);
      micButton?.setAttribute("aria-busy", String(busy));
      micButton?.setAttribute(
        "aria-label",
        busy ? "Mikrofon wird vorbereitet" : listening ? "Aufnahme stoppen" : "Mikrofon starten und Wort sprechen"
      );
      if (label) {
        label.textContent = busy
          ? "Mikrofon wird vorbereitet …"
          : listening
            ? "Ich höre zu … sprich jetzt!"
            : "Tippe zum Sprechen";
      }
      heard?.classList.toggle("is-active", listening);
      if (busy && heard) heard.textContent = "Mikrofon wird bereit …";
      if (listening && heard) heard.textContent = "…";
    };

    const start = async () => {
      if (state.answered || !state.alive || starting) return;
      if (listening) {
        state.recognizer?.stop();
        return;
      }
      if (!state.allowOnline) {
        showConsentModal({
          onDone: (consent) => {
            if (consent?.allowOnline) {
              const latest = learner.getSettings();
              state.allowOnline = true;
              state.handwritingAllowed = latest.handwriting !== false && latest.handwritingProvider !== "off";
            }
          },
        });
        return;
      }
      if (!isSpeechSupported()) {
        const hint = speechSupportHint();
        if (hint) showToast(hint, { type: "warn", iconName: "info" });
        showTyping();
        return;
      }

      // Muss vor dem ersten await passieren – iOS braucht eine Nutzer-Geste.
      unlockTts();
      setMicState("starting");

      let microphone = null;
      let recognizer = null;
      try {
        // Berechtigung und Mikrofon-Track schon jetzt holen, damit die
        // Erkennung nicht auf eine offene Browser-Abfrage wartet.
        microphone = await requestMicrophoneStream();
        if (!state.alive || state.answered) {
          stopMicrophoneStream(microphone);
          return;
        }

        recognizer = createSpeechRecognizer({
          lang: "en-US",
          timeoutMs: 12000,
          stream: microphone,
          onStart: () => {
            if (state.alive && !state.answered) setMicState("listening");
          },
          onInterim: (text) => {
            if (heard && state.alive) heard.textContent = text;
          },
        });
        state.recognizer = recognizer;
        microphone = null; // Der Recognizer gibt den Stream selbst frei.

        const result = await recognizer.promise;
        if (!state.alive || state.answered) return;
        if (heard) heard.textContent = result.transcript || "…";
        // Alle Alternativen prüfen – die Erkennung liefert oft gute Zweitvorschläge.
        const alternatives = result.alternatives?.length ? result.alternatives : [result.transcript];
        let match = null;
        for (const candidate of alternatives) {
          const check = checkAnswer(candidate, word);
          if (check.correct) {
            match = { candidate, check };
            break;
          }
        }
        if (match) {
          submitAnswer(match.candidate, true, { source: "speech" });
        } else {
          submitAnswer(result.transcript || "", false, {
            source: "speech",
            detected: result.transcript,
            candidates: alternatives,
          });
        }
      } catch (error) {
        if (!state.alive || state.answered) return;
        if (error?.code === "aborted") return;
        setMicState("idle");
        if (heard) heard.textContent = error?.message || "Das hat nicht geklappt.";
        showToast(error?.message || "Das hat nicht geklappt.", { type: "warn", iconName: "mic" });
        if (
          ["unsupported", "not-allowed", "service-not-allowed", "insecure", "start-failed", "network", "audio-capture"].includes(
            error?.code
          )
        ) {
          showTyping();
        }
      } finally {
        stopMicrophoneStream(microphone);
        if (state.alive && !state.answered) setMicState("idle");
        if (recognizer && state.recognizer === recognizer) state.recognizer = null;
      }
    };

    micButton?.addEventListener("click", start);

    stage.querySelector('[data-action="show-typing"]')?.addEventListener("click", () => {
      showTyping();
    });

    bindSpeakReplay(word);
  }

  /* --- Schreiben / Hören binden ---------- */
  function bindWritingQuestion(word, mode) {
    const canvas = stage.querySelector("#pad");

    if (canvas && state.handwritingAllowed) {
      const hint = stage.querySelector("#pad-hint");
      state.pad = new DrawingPad(canvas, {
        onChange: (isEmpty) => hint?.classList.toggle("is-hidden", !isEmpty),
      });
    }

    stage.querySelector('[data-action="pad-undo"]')?.addEventListener("click", () => {
      state.pad?.undo();
      setPadStatus("");
    });
    stage.querySelector('[data-action="pad-clear"]')?.addEventListener("click", () => {
      state.pad?.clear();
      setPadStatus("");
    });
    stage.querySelector('[data-action="pad-check"]')?.addEventListener("click", () => {
      checkPad(word);
    });
    stage.querySelector('[data-action="show-typing"]')?.addEventListener("click", () => {
      showTyping();
      if (!state.handwritingAllowed) {
        state.pad?.destroy();
        state.pad = null;
      }
    });

    stage.querySelector('[data-action="speak-word"]')?.addEventListener("click", () => speakWord(word.en));
    stage.querySelector('[data-action="reveal"]')?.addEventListener("click", (event) => {
      const slot = stage.querySelector("#reveal-slot");
      if (!slot) return;
      slot.innerHTML = `<p class="mb-0 small"><strong>${esc(word.de)}</strong>${word.emoji ? ` ${esc(word.emoji)}` : ""}</p>`;
      event.currentTarget.remove();
    });

    // Ohne Pad direkt das Tippfeld anzeigen.
    if (!state.handwritingAllowed) showTyping();
    bindSpeakReplay(word);
  }

  function bindSpeakReplay(word) {
    stage.querySelector('[data-action="speak-word"]')?.addEventListener("click", () => speakWord(word.en));
  }

  function setPadStatus(text, kind = "") {
    const node = stage.querySelector("#pad-status");
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("is-busy", kind === "busy");
    node.classList.toggle("is-error", kind === "error");
  }

  function showTyping() {
    const slot = stage.querySelector("#typing-slot");
    if (!slot || slot.dataset.visible === "true") return;
    slot.dataset.visible = "true";
    slot.innerHTML = typingMarkup();
    slot.querySelector("form")?.addEventListener("submit", handleTypingSubmit);
    const input = slot.querySelector("input");
    input?.focus({ preventScroll: true });
  }

  function handleTypingSubmit(event) {
    event.preventDefault();
    if (state.answered || !state.alive) return;
    const input = event.target.querySelector('input[name="answer"]');
    const value = input?.value?.trim() || "";
    if (!value) {
      input?.focus();
      showToast("Tippe zuerst ein Wort ein.", { type: "warn" });
      return;
    }
    submitAnswer(value, checkAnswer(value, state.current.word).correct, { source: "typing" });
  }

  async function checkPad(word) {
    if (state.answered || !state.alive || !state.pad) return;
    if (state.pad.isEmpty()) {
      setPadStatus("Schreib zuerst ein Wort auf die Fläche.", "error");
      return;
    }
    setPadStatus("Ich lese deine Schrift …", "busy");
    const size = state.pad.getSize();
    const strokes = state.pad.getStrokes();

    try {
      const candidates = await recognizeHandwriting(strokes, {
        width: size.width,
        height: size.height,
        lang: "en",
        model: learner.getSettings().handwritingModel,
      });
      if (!state.alive || state.answered) return;
      setPadStatus("");

      let match = null;
      for (const candidate of candidates) {
        const check = checkAnswer(candidate, word);
        if (check.correct) {
          match = { candidate, check };
          break;
        }
      }
      if (match) {
        submitAnswer(match.candidate, true, { source: "handwriting" });
      } else {
        submitAnswer(candidates[0] || "", false, {
          source: "handwriting",
          detected: candidates.slice(0, 3).join(", "),
          candidates,
        });
      }
    } catch (error) {
      if (!state.alive || state.answered) return;
      setPadStatus(error?.message || "Ich konnte deine Schrift nicht lesen.", "error");
      showToast(error?.message || "Ich konnte deine Schrift nicht lesen.", {
        type: "warn",
        iconName: "pencil",
      });
      showTyping();
    }
  }

  /* --- Antwort auswerten ---------- */
  function submitAnswer(input, correct, meta = {}) {
    if (state.answered || !state.alive) return;
    const current = state.current;
    if (!current) return;
    const word = current.word;

    state.answered = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.recognizer?.abort?.();
    state.recognizer = null;
    stopSpeaking();

    const previousAttempts = state.attemptsByWord.get(word.id) || 0;
    const firstAttempt = previousAttempts === 0;
    state.attemptsByWord.set(word.id, previousAttempts + 1);
    state.attempts += 1;

    // Vor dem falschen Versuch sichern: Wird er nachträglich als richtig
    // gewertet, kann er so vollständig zurückgenommen werden.
    const previousProgress = correct ? null : structuredClone(learner.getProgress(word.id));
    const streakBefore = state.streak;

    let gained = 0;
    const promote = firstAttempt;
    let queuedEntry = null;
    let recordPromise = null;

    if (correct) {
      state.correctAttempts += 1;
      state.streak += 1;
      state.maxStreak = Math.max(state.maxStreak, state.streak);
      state.modeCorrect[current.mode] = (state.modeCorrect[current.mode] || 0) + 1;
      if (firstAttempt) {
        state.firstTryCorrect += 1;
        gained = POINTS_FIRST_TRY;
      } else {
        gained = POINTS_RETRY;
      }
      state.points += gained;
      recordPromise = learner.recordAttempt(word.id, true, { promote }).catch((error) => {
        console.error("[session] Fortschritt konnte nicht gespeichert werden", error);
      });
      sfx.correct();
      if (state.streak === 3 || state.streak === 5) {
        showToast(randomLine(MASCOT_LINES.streak), { type: "success", iconName: "flame" });
      }
    } else {
      state.streak = 0;
      state.wrongByWord.set(word.id, (state.wrongByWord.get(word.id) || 0) + 1);
      recordPromise = learner.recordAttempt(word.id, false, { promote: false }).catch((error) => {
        console.error("[session] Fortschritt konnte nicht gespeichert werden", error);
      });
      sfx.wrong();
      // Zweiter Versuch: Wort kommt ans Ende der Runde (begrenzt).
      if (state.wrongByWord.get(word.id) <= 2 && state.queue.length < MAX_QUEUE) {
        queuedEntry = { word, mode: state.baseMode === "mix" ? null : state.baseMode };
        state.queue.push(queuedEntry);
      }
    }

    if (firstAttempt) state.firstPassDone.add(word.id);
    updateProgress();

    if (gained > 0) floatPoints(gained);
    if (correct && (state.streak === 5 || state.streak === 10)) {
      confetti({ count: 60, originY: 0.35 });
    }

    // Nur bei maschineller Erkennung und nur, wenn die Abweichung klein
    // genug für einen Hör-/Lesefehler ist. Beim Tippen entscheidet das Kind
    // selbst, deshalb gibt es dort keine nachträgliche Wertung.
    const machineRecognized = meta.source === "speech" || meta.source === "handwriting";
    const candidates = [input, ...(meta.candidates || [])].filter(
      (value) => typeof value === "string" && value.trim()
    );
    const canAccept =
      !correct && machineRecognized && candidates.some((candidate) => isNearMiss(candidate, word));

    const acceptance = canAccept
      ? {
          word,
          mode: current.mode,
          firstAttempt,
          gained: firstAttempt ? POINTS_FIRST_TRY : POINTS_RETRY,
          streakBefore,
          queuedEntry,
          previousProgress,
          recordPromise,
          detected: meta.detected || input,
        }
      : null;

    // Bei Spracheingabe darf ein falsch erkannter Versuch sofort wiederholt
    // werden, ohne dass der Erkennungsfehler als Wissensfehler stehen bleibt.
    const speechRetry =
      !correct && meta.source === "speech"
        ? {
            word,
            mode: current.mode,
            firstAttempt,
            streakBefore,
            queuedEntry,
            previousProgress,
            recordPromise,
            previousAttempts,
          }
        : null;

    renderFeedback({
      word,
      correct,
      gained,
      detected: meta.detected || (meta.source === "typing" ? input : ""),
      mode: current.mode,
      acceptance,
      speechRetry,
    });
  }

  /**
   * Macht einen falsch gespeicherten Spracheingabe-Versuch rückgängig, damit
   * das Kind sofort erneut sprechen kann (z. B. bei Erkennungsfehlern).
   */
  async function retrySpeech(attempt, card) {
    if (!attempt || !state.alive) return;
    if (card?.dataset.retrying === "true") return;
    if (card) card.dataset.retrying = "true";
    card?.querySelectorAll('[data-action="retry-speech"], [data-action="retry-speech-inline"]').forEach((button) => {
      button.disabled = true;
    });

    try {
      await attempt.recordPromise;
      await learner.restoreProgress(attempt.word.id, attempt.previousProgress);
    } catch (error) {
      console.error("[session] Sprachversuch konnte nicht zurückgenommen werden", error);
      showToast("Das konnte gerade nicht gespeichert werden. Versuch es noch einmal.", { type: "error" });
      if (card) card.dataset.retrying = "false";
      card?.querySelectorAll('[data-action="retry-speech"], [data-action="retry-speech-inline"]').forEach((button) => {
        button.disabled = false;
      });
      return;
    }

    if (!state.alive) return;

    state.attempts = Math.max(0, state.attempts - 1);
    state.attemptsByWord.set(attempt.word.id, attempt.previousAttempts);
    const wrongCount = state.wrongByWord.get(attempt.word.id) || 0;
    if (wrongCount <= 1) state.wrongByWord.delete(attempt.word.id);
    else state.wrongByWord.set(attempt.word.id, wrongCount - 1);

    if (attempt.queuedEntry) {
      const queuedIndex = state.queue.indexOf(attempt.queuedEntry);
      if (queuedIndex !== -1) state.queue.splice(queuedIndex, 1);
    }

    state.streak = attempt.streakBefore;
    state.answered = false;
    if (attempt.firstAttempt) state.firstPassDone.delete(attempt.word.id);
    updateProgress();

    card?.remove();
    const mic = stage.querySelector('[data-action="mic"]');
    const label = stage.querySelector("#mic-label");
    const heard = stage.querySelector("#heard-box");
    if (label) label.textContent = "Tippe zum Sprechen";
    if (heard) heard.textContent = "Okay, versuch es noch einmal …";
    mic?.focus({ preventScroll: true });
    showToast("Okay, versuch es noch einmal!", { type: "info", iconName: "mic" });
  }

  /**
   * Nimmt einen falsch gewerteten Erkennungsversuch zurück und speichert ihn
   * als richtig. Punkte, Serie und Rundenwarteschlange werden mitkorrigiert.
   */
  async function acceptAnswer(attempt, card) {
    if (!attempt || !state.alive) return;
    if (card?.dataset.accepted === "true") return;
    if (card) card.dataset.accepted = "true";
    const button = card?.querySelector('[data-action="accept-correct"]');
    if (button) button.disabled = true;

    try {
      // Erst den falschen Versuch abschließen, damit die Reihenfolge in der
      // lokalen Datenbank eindeutig bleibt.
      await attempt.recordPromise;
      await learner.restoreProgress(attempt.word.id, attempt.previousProgress);
      await learner.recordAttempt(attempt.word.id, true, { promote: attempt.firstAttempt });
    } catch (error) {
      console.error("[session] Nachträgliche Wertung fehlgeschlagen", error);
      showToast("Das konnte gerade nicht gespeichert werden. Versuch es noch einmal.", {
        type: "error",
      });
      if (card) card.dataset.accepted = "false";
      if (button) button.disabled = false;
      return;
    }

    if (!state.alive) return;

    // Den einen falschen Versuch aus der Rundenwertung entfernen.
    const wrongCount = state.wrongByWord.get(attempt.word.id) || 0;
    if (wrongCount <= 1) state.wrongByWord.delete(attempt.word.id);
    else state.wrongByWord.set(attempt.word.id, wrongCount - 1);

    if (attempt.queuedEntry) {
      const queuedIndex = state.queue.indexOf(attempt.queuedEntry);
      if (queuedIndex !== -1) state.queue.splice(queuedIndex, 1);
    }

    state.streak = attempt.streakBefore + 1;
    state.maxStreak = Math.max(state.maxStreak, state.streak);
    state.correctAttempts += 1;
    state.modeCorrect[attempt.mode] = (state.modeCorrect[attempt.mode] || 0) + 1;
    if (attempt.firstAttempt) state.firstTryCorrect += 1;
    state.points += attempt.gained;
    updateProgress();

    sfx.correct();
    floatPoints(attempt.gained);
    if (state.streak === 3 || state.streak === 5) {
      showToast(randomLine(MASCOT_LINES.streak), { type: "success", iconName: "flame" });
    }
    if (state.streak === 5 || state.streak === 10) {
      confetti({ count: 60, originY: 0.35 });
    }

    card?.remove();
    renderFeedback({
      word: attempt.word,
      correct: true,
      gained: attempt.gained,
      detected: attempt.detected,
      mode: attempt.mode,
      accepted: true,
    });
  }

  function floatPoints(points) {
    const fxRoot = document.getElementById("fx-root");
    if (!fxRoot) return;
    const node = document.createElement("div");
    node.className = "points-float";
    node.textContent = `+${points}`;
    node.style.left = `${window.innerWidth / 2}px`;
    node.style.top = `${Math.max(120, window.innerHeight * 0.32)}px`;
    node.style.transform = "translateX(-50%)";
    fxRoot.append(node);
    setTimeout(() => node.remove(), 1200);
  }

  function renderFeedback({ word, correct, gained, detected, mode, accepted = false, acceptance = null, speechRetry = null }) {
    const title = correct ? randomLine(MASCOT_LINES.correct) : randomLine(MASCOT_LINES.wrong);
    const alternatives = (word.alternatives || []).filter(Boolean);
    const alternativesLine = alternatives.length
      ? `<p class="small muted mb-0 mt-1">Auch richtig: ${alternatives.map((alt) => `„${esc(alt)}“`).join(", ")}</p>`
      : "";

    // Nachträgliche Wertung nur bei Sprach-/Schrifterkennung anbieten.
    const acceptanceBlock = acceptance
      ? `
        <div class="feedback-accept">
          <p class="small mb-1">Die Erkennung lag vielleicht daneben. War deine Antwort richtig?</p>
          <button type="button" class="btn btn-soft btn-small" data-action="accept-correct">
            ${icon("check")} Dennoch als richtig werten
          </button>
        </div>`
      : "";

    // Erkennungsfehler bei Spracheingabe: sofortiger neuer Versuch ohne
    // Fortschritts-Penalty, weil nicht klar ist, ob das Kind falsch lag.
    const speechRetryBlock = speechRetry
      ? `
        <div class="feedback-accept">
          <p class="small mb-1">Nicht richtig erkannt? Du kannst es direkt nochmal sagen.</p>
          <button type="button" class="btn btn-soft btn-small" data-action="retry-speech">
            ${icon("mic")} Nochmal sprechen
          </button>
        </div>`
      : "";

    const acceptedLine = accepted
      ? `<p class="feedback-accepted">${icon("check")} Als richtig gewertet</p>`
      : "";

    const card = document.createElement("div");
    card.className = `feedback-card ${correct ? "" : "is-wrong"}`.trim();
    card.setAttribute("role", "status");
    card.innerHTML = `
      <div class="feedback-head">
        <span class="feedback-icon">${icon(correct ? "check" : "close")}</span>
        <div>
          <h2 class="feedback-title">${esc(title)}</h2>
          <p class="mb-0">${correct ? `${icon("star", "icon-star")} +${gained} Punkte` : "Beim nächsten Mal klappt es!"}</p>
        </div>
      </div>
      <div class="feedback-solution">
        <span class="small muted">${esc(word.de)}</span><br>
        <strong>${esc(word.en)}</strong>
        ${alternativesLine}
        ${word.example ? `<p class="mb-0 mt-2">${icon("speaker")} <em>${esc(word.example)}</em></p>` : ""}
      </div>
      ${detected ? `<p class="detected">Erkannt: „${esc(detected)}“</p>` : ""}
      ${acceptedLine}
      ${speechRetryBlock}
      ${acceptanceBlock}
      <div class="feedback-actions">
        <button type="button" class="btn btn-soft btn-small" data-action="speak-word">
          ${icon("speaker")} Nochmal hören
        </button>
        ${speechRetry ? `<button type="button" class="btn-link" data-action="retry-speech-inline">${icon("mic")} Nochmal sprechen</button>` : ""}
        ${!correct ? `<button type="button" class="btn-link" data-action="show-typing">${icon("keyboard")} Tippen üben</button>` : ""}
        <button type="button" class="btn btn-primary" data-action="next">
          Weiter ${icon("forward")}
        </button>
      </div>`;

    stage.append(card);
    card.querySelector('[data-action="speak-word"]')?.addEventListener("click", () => speakWord(word.en));
    card.querySelector('[data-action="accept-correct"]')?.addEventListener("click", () => {
      acceptAnswer(acceptance, card);
    });
    card.querySelectorAll('[data-action="retry-speech"], [data-action="retry-speech-inline"]').forEach((button) => {
      button.addEventListener("click", () => retrySpeech(speechRetry, card));
    });
    card.querySelector('[data-action="show-typing"]')?.addEventListener("click", () => {
      // Nach einer falschen Antwort direkt noch einmal tippen.
      state.answered = false;
      state.wrongByWord.set(word.id, 0);
      showTyping();
      card.remove();
    });
    card.querySelector('[data-action="next"]')?.addEventListener("click", (event) => {
      event.currentTarget.disabled = true;
      advance();
    });

    // Der Weiter-Button ist der nächste logische Schritt.
    card.querySelector('[data-action="next"]')?.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function advance() {
    if (!state.alive) return;
    state.index += 1;
    state.answered = false;
    if (state.index >= state.queue.length) {
      showResults();
    } else {
      showQuestion();
    }
  }

  /* --- Ergebnisse ---------- */
  function showResults() {
    cleanupQuestion();
    const total = state.total;
    const ratio = total ? state.firstTryCorrect / total : 0;
    const stars = ratio >= 0.9 ? 3 : ratio >= 0.7 ? 2 : 1;
    const perfect = state.wrongByWord.size === 0;
    const durationMs = Date.now() - state.startedAt;
    const missedWords = initialWords.filter((word) => state.wrongByWord.has(word.id));
    const wheelReward = pickWheelReward();
    const totalPoints = state.points + wheelReward.points;

    updateProgress();
    const fill = main.querySelector("#session-progress");
    if (fill) fill.style.width = "100%";

    const summary = {
      points: state.points,
      attempts: state.attempts,
      correctAttempts: state.correctAttempts,
      perfect,
      maxStreak: state.maxStreak,
      modeCorrect: state.modeCorrect,
      mode: state.baseMode,
      themeId: config.themeId,
      words: initialWords,
      stars,
      totalWords: total,
      firstTryCorrect: state.firstTryCorrect,
      durationMs,
      bonusPoints: wheelReward.points,
      wheelReward: {
        id: wheelReward.id,
        icon: wheelReward.icon,
        label: wheelReward.label,
        points: wheelReward.points,
      },
    };

    // Ergebnis-Ansicht sofort zeigen; das Speichern darf kurz dauern.
    stage.innerHTML = `
      <div class="card result-card">
        <div class="result-mascot" id="result-mascot">${mascot(stars === 3 ? "cheer" : stars === 2 ? "happy" : "think", { size: 150 })}</div>
        <div class="result-stars" aria-label="${stars} von 3 Sternen">
          ${[1, 2, 3].map((index) => starSvg(index <= stars ? "is-earned" : "")).join("")}
        </div>
        <h1 class="result-title">${stars === 3 ? "Fantastisch!" : stars === 2 ? "Super gemacht!" : "Gut geübt!"}</h1>
        <p class="muted mb-2">${esc(state.themeName)} · ${plural(total, "Wort", "Wörter")} · ${esc(MODE_INFO[state.baseMode]?.label || "Mix")}</p>
        <span class="result-points">${icon("star", "icon-star")} +${totalPoints} Punkte</span>
        <span class="tiny bold mt-1">inklusive Glücksrad-Überraschung</span>
        <div class="result-stats">
          <div class="result-stat"><strong>${state.firstTryCorrect} / ${total}</strong><span>beim ersten Versuch</span></div>
          <div class="result-stat"><strong>${state.maxStreak}</strong><span>beste Serie</span></div>
          <div class="result-stat"><strong>${Math.round((durationMs / 60000) * 10) / 10 || "0"}</strong><span>Minuten</span></div>
        </div>
        ${missedWords.length ? `
          <div class="result-words">
            <h3>Diese Wörter üben wir nochmal:</h3>
            <div class="result-word-list">
              ${missedWords.map((word) => `
                <span class="result-word is-missed">
                  ${esc(word.de)} = ${esc(word.en)}
                  <button type="button" class="icon-btn" style="width:48px;height:48px" data-speak="${esc(word.en)}" aria-label="${esc(word.en)} vorlesen">
                    ${icon("speaker")}
                  </button>
                </span>`).join("")}
            </div>
          </div>` : `
          <div class="callout success mt-2" style="text-align:left">
            ${icon("check")}
            <p class="mb-0"><strong>Keine Fehler!</strong> Du hast alle Wörter geknackt.</p>
          </div>`}
        <div id="result-extra" aria-live="polite"></div>
        <div class="btn-row mt-3" style="justify-content:center">
          <button type="button" class="btn" data-action="again">${icon("refresh")} Nochmal spielen</button>
          <a class="btn btn-ghost" href="#/home">${icon("home")} Startseite</a>
        </div>
      </div>`;

    stage.querySelectorAll("[data-speak]").forEach((button) => {
      button.addEventListener("click", () => speakWord(button.dataset.speak));
    });
    stage.querySelector('[data-action="again"]')?.addEventListener("click", () => {
      onRestart();
    });

    confetti({ count: stars === 3 ? 150 : 90, originY: 0.3 });
    if (stars === 3) sfx.celebrate();
    else sfx.start();

    // Punkte, Abzeichen und Level speichern.
    learner
      .finishSession(summary)
      .then((result) => {
        if (!state.alive) return;
        const extra = stage.querySelector("#result-extra");
        if (!extra) return;
        const parts = [];
        if (result.dailyGoalReached) {
          parts.push(`
            <div class="callout success mt-2" style="text-align:left">
              ${icon("check")}
              <p class="mb-0"><strong>Tagesziel geschafft!</strong> ${learner.DAILY_GOAL_POINTS} Punkte an einem Tag – stark!</p>
            </div>`);
        }
        if (result.newMilestones?.length) {
          parts.push(`
            <div class="milestone-celebration">
              ${result.newMilestones.map((milestone) => `
                <span class="milestone-burst">
                  <span class="milestone-burst-icon" aria-hidden="true">${esc(milestone.icon)}</span>
                  <strong>${esc(milestone.title)}</strong>
                  <small>${milestone.points} Punkte erreicht</small>
                </span>`).join("")}
            </div>`);
          confetti({ count: 120, originY: 0.35 });
          sfx.celebrate();
        }
        if (result.leveledUp) {
          parts.push(`
            <div class="callout success mt-2" style="text-align:left">
              ${icon("star")}
              <p class="mb-0"><strong>Level ${result.level.level}!</strong> Du bist jetzt „${esc(result.level.title)}“.</p>
            </div>`);
        }
        if (result.newBadges?.length) {
          parts.push(`
            <div class="new-badges">
              ${result.newBadges.map((badge) => `
                <span class="badge is-earned" style="padding:10px 14px">
                  <span class="badge-icon" style="width:44px;height:44px;font-size:1.4rem">${esc(badge.icon)}</span>
                  <strong>${esc(badge.title)}</strong>
                  <small>${esc(badge.description)}</small>
                </span>`).join("")}
            </div>`);
          sfx.badge();
        }
        parts.push(`
          <button type="button" class="wheel-card" data-action="wheel">
            <span class="wheel-card-icon" aria-hidden="true">🎡</span>
            <span><strong>Glücksrad drehen!</strong><small>Deine Überraschung aus dieser Runde ansehen</small></span>
            ${icon("forward")}
          </button>`);
        extra.innerHTML = parts.join("");
        const wheelButton = extra.querySelector('[data-action="wheel"]');
        wheelButton?.addEventListener("click", async () => {
          // Nur einmal pro Runde drehen – der Bonus wurde schon beim Speichern gutgeschrieben.
          if (!wheelButton || wheelButton.disabled) return;
          wheelButton.disabled = true;
          wheelButton.setAttribute("aria-disabled", "true");
          sfx.click();
          try {
            await showWheel(wheelReward);
          } finally {
            if (!state.alive) return;
            wheelButton.classList.add("is-opened");
            wheelButton.innerHTML = `<span class="wheel-card-icon" aria-hidden="true">${esc(wheelReward.icon)}</span>
              <span><strong>Überraschung geöffnet</strong><small>${esc(wheelReward.label)} – ${esc(wheelReward.message)}</small></span>`;
          }
        });
      })
      .catch((error) => {
        console.error("[session] Ergebnisse konnten nicht gespeichert werden", error);
        showToast("Der Fortschritt konnte nicht gespeichert werden.", { type: "error" });
      });
  }

  /* --- Sprachausgabe ---------- */
  function speakWord(text) {
    if (!text || !state.alive) return;
    unlockTts();
    const settingsNow = learner.getSettings();
    speak(text, { rate: settingsNow.speechRate || 0.9, lang: "en-GB" });
  }

  /* --- Beenden ---------- */
  main.querySelector('[data-action="quit"]')?.addEventListener("click", async () => {
    if (state.index === 0 && !state.answered) {
      cleanup();
      location.hash = "#/home";
      return;
    }
    const leave = await confirmDialog({
      title: "Runde beenden?",
      message: "Deine bisherigen Antworten werden gespeichert. Die Runde zählt aber nicht als abgeschlossen.",
      confirmLabel: "Ja, beenden",
      cancelLabel: "Weiter lernen",
      danger: true,
    });
    if (!leave) return;
    cleanup();
    location.hash = "#/home";
  });

  showQuestion();
  return cleanup;
}

/**
 * Spracherkennung über die Web Speech API.
 * Unterstützt wird Chrome/Edge/Safari (webkitSpeechRecognition).
 * Firefox hat keine Implementierung – dann bietet die App die Tastatur an.
 */

const SpeechRecognitionCtor =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export function isSpeechSupported() {
  return Boolean(SpeechRecognitionCtor);
}

export function hasSecureContext() {
  return window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

const ERROR_MESSAGES = {
  "not-allowed": {
    message: "Ich darf dein Mikrofon nicht benutzen. Bitte erlaube das Mikrofon in den Einstellungen deines Browsers.",
    hint: "Eltern: In den Browser-Einstellungen unter „Datenschutz & Sicherheit → Website-Einstellungen → Mikrofon“ die Seite erlauben und neu laden.",
  },
  "service-not-allowed": {
    message: "Die Spracherkennung ist in diesem Browser gerade nicht erlaubt. Du kannst stattdessen tippen.",
    hint: "Auf iOS ist die Spracherkennung nur eingeschränkt verfügbar (Siri/Diktat muss aktiv sein).",
  },
  "audio-capture": {
    message: "Ich habe kein Mikrofon gefunden. Prüfe, ob eines angeschlossen ist, oder tippe dein Wort.",
    hint: "Bitte ein Mikrofon anschließen und die Seite neu laden.",
  },
  "no-speech": {
    message: "Ich habe nichts gehört. Tippe noch einmal auf das Mikrofon und sprich laut!",
    hint: "Näher ans Mikrofon sprechen und Umgebungsgeräusche reduzieren.",
  },
  network: {
    message: "Die Spracherkennung braucht Internet. Du kannst dein Wort auch tippen.",
    hint: "Die Web Speech API sendet Audio an den Browser-Dienst (z. B. Google) zur Erkennung.",
  },
  aborted: {
    message: "Ich habe das Zuhören beendet.",
    hint: "",
  },
  "language-not-supported": {
    message: "Englische Spracherkennung wird hier leider nicht unterstützt. Tippe dein Wort stattdessen.",
    hint: "Die Sprache en-GB/en-US fehlt in diesem Browser/System.",
  },
  timeout: {
    message: "Ich habe zu lange gewartet. Versuch es noch einmal!",
    hint: "Der Erkennungsdienst hat nicht geantwortet.",
  },
  unsupported: {
    message: "Dein Browser kann keine Sprache erkennen. Kein Problem – tippe dein Wort einfach ein.",
    hint: "Firefox unterstützt die Web Speech API nicht. Chrome, Edge oder Safari verwenden.",
  },
};

export class SpeechError extends Error {
  constructor(code) {
    const info = ERROR_MESSAGES[code] || ERROR_MESSAGES.unsupported;
    super(info.message);
    this.name = "SpeechError";
    this.code = code;
    this.hint = info.hint;
  }
}

/**
 * Startet eine einzelne Erkennung.
 * @returns {{promise: Promise<{transcript: string, alternatives: string[], confidence: number}>, stop: Function, abort: Function}}
 */
export function createSpeechRecognizer({ lang = "en-US", onInterim = null, timeoutMs = 12000 } = {}) {
  if (!isSpeechSupported()) {
    return {
      promise: Promise.reject(new SpeechError("unsupported")),
      stop() {},
      abort() {},
    };
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = lang;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 5;

  let settled = false;
  let lastInterim = "";
  let timer = null;
  let resolveFn;
  let rejectFn;

  const cleanup = () => {
    clearTimeout(timer);
    timer = null;
  };

  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    fn(value);
  };

  recognition.onresult = (event) => {
    const result = event.results?.[event.results.length - 1];
    if (!result) return;
    if (result.isFinal) {
      const alternatives = [];
      for (let i = 0; i < result.length; i++) {
        const text = result[i]?.transcript?.trim();
        if (text) alternatives.push(text);
      }
      const transcript = alternatives[0] || lastInterim || "";
      finish(resolveFn, {
        transcript,
        alternatives: [...new Set([transcript, ...alternatives].filter(Boolean))],
        confidence: result[0]?.confidence ?? 0,
      });
    } else {
      lastInterim = result[0]?.transcript?.trim() || lastInterim;
      if (lastInterim && typeof onInterim === "function") onInterim(lastInterim);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted") {
      finish(rejectFn, new SpeechError("aborted"));
      return;
    }
    finish(rejectFn, new SpeechError(event.error || "unsupported"));
  };

  recognition.onend = () => {
    if (settled) return;
    if (lastInterim) {
      finish(resolveFn, { transcript: lastInterim, alternatives: [lastInterim], confidence: 0 });
    } else {
      finish(rejectFn, new SpeechError("no-speech"));
    }
  };

  timer = setTimeout(() => {
    // Erst als Timeout abschließen, dann abbrechen: sonst würde das
    // "aborted"-Event des Abbruchs den aussagekräftigeren Fehler ersetzen.
    finish(rejectFn, new SpeechError("timeout"));
    try {
      recognition.abort();
    } catch {
      /* ignorieren */
    }
  }, timeoutMs);

  try {
    recognition.start();
  } catch {
    finish(rejectFn, new SpeechError("unsupported"));
  }

  return {
    promise,
    stop() {
      try {
        recognition.stop();
      } catch {
        /* ignorieren */
      }
    },
    abort() {
      try {
        recognition.abort();
      } catch {
        /* ignorieren */
      }
      finish(rejectFn, new SpeechError("aborted"));
    },
  };
}

export function speechSupportHint() {
  if (!hasSecureContext()) {
    return "Mikrofon funktioniert nur über HTTPS oder localhost.";
  }
  if (!isSpeechSupported()) {
    return "Dieser Browser unterstützt keine Spracherkennung. Nutze Chrome, Edge oder Safari – oder tippe die Wörter.";
  }
  return "";
}

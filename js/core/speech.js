/**
 * Spracherkennung über die Web Speech API.
 * Unterstützt wird Chrome/Edge/Safari (webkitSpeechRecognition).
 * Firefox hat keine Implementierung – dann bietet die App die Tastatur an.
 *
 * Wichtig: recognition.start() ist asynchron. Das Mikrofon und der
 * Erkennungsdienst sind erst mit dem "start"-Event wirklich bereit. bis
 * dahin werden keine Sprachsignale verarbeitet. Die App holt deshalb vorher
 * mit getUserMedia() die Mikrofonberechtigung und zeigt erst nach onstart
 * „Ich höre zu“ an. Der Antwort-Timeout beginnt ebenfalls erst dann.
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
  insecure: {
    message: "Mikrofon und Spracherkennung brauchen HTTPS oder localhost.",
    hint: "Öffne die App über eine sichere Adresse – nicht per file://.",
  },
  "audio-capture": {
    message: "Ich habe kein Mikrofon gefunden. Prüfe, ob eines angeschlossen ist, oder tippe dein Wort.",
    hint: "Bitte ein Mikrofon anschließen und die Seite neu laden.",
  },
  "start-failed": {
    message: "Das Mikrofon konnte nicht gestartet werden. Versuch es noch einmal oder tippe dein Wort.",
    hint: "Erlaube das Mikrofon und prüfe, ob es nicht von einer anderen App blockiert ist.",
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
  auth: {
    message: "Für die Spracheingabe mit Gemini fehlt ein gültiger Schlüssel. Ein Erwachsener kann ihn im Elternbereich prüfen.",
    hint: "Elternbereich → Einstellungen → Spracheingabe.",
  },
  "rate-limit": {
    message: "Die Spracherkennung ist gerade überlastet oder das Limit ist erreicht. Versuch es später noch einmal oder tippe dein Wort.",
    hint: "Bei kostenlosen Kontingenten kann es Tages- oder Minutenlimits geben.",
  },
  "invalid-response": {
    message: "Die Spracherkennung hat eine unverständliche Antwort geliefert. Versuch es noch einmal.",
    hint: "",
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

/** Wandelt getUserMedia-Fehler in die kindgerechten App-Fehler um. */
function microphoneError(error) {
  if (error instanceof SpeechError) return error;
  const name = error?.name || "";
  if (/NotAllowed|Permission|Security/i.test(name)) return new SpeechError("not-allowed");
  if (/Abort/i.test(name)) return new SpeechError("aborted");
  return new SpeechError("audio-capture");
}

/** Stoppt einen vorab geöffneten Mikrofon-Stream wieder. */
export function stopMicrophoneStream(stream) {
  if (!stream?.getTracks) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignorieren */
    }
  }
}

/**
 * Holt die Mikrofonberechtigung noch innerhalb der Nutzer-Geste und liefert
 * einen bereits laufenden Audio-Track. browsers ohne mediaDevices (z. B.
 * älteres Safari) bekommen null und starten wie zuvor direkt die Erkennung.
 */
export async function requestMicrophoneStream() {
  if (!hasSecureContext()) throw new SpeechError("insecure");
  if (!navigator.mediaDevices?.getUserMedia) return null;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch (error) {
    throw microphoneError(error);
  }

  const liveTrack = stream?.getAudioTracks?.().find((track) => track.readyState === "live");
  if (!liveTrack) {
    stopMicrophoneStream(stream);
    throw new SpeechError("audio-capture");
  }
  return stream;
}

/**
 * Startet eine einzelne Erkennung.
 * @returns {{promise: Promise<{transcript: string, alternatives: string[], confidence: number}>, stop: Function, abort: Function}}
 */
export function createSpeechRecognizer({
  lang = "en-US",
  onInterim = null,
  onStart = null,
  onSpeechStart = null,
  timeoutMs = 12000,
  startTimeoutMs = 15000,
  stream = null,
} = {}) {
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
  let started = false;
  let lastInterim = "";
  let timer = null;
  let startupTimer = null;
  let microphoneStream = stream;
  let resolveFn;
  let rejectFn;

  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const releaseMicrophone = () => {
    if (!microphoneStream) return;
    stopMicrophoneStream(microphoneStream);
    microphoneStream = null;
  };

  const cleanup = () => {
    clearTimeout(timer);
    clearTimeout(startupTimer);
    timer = null;
    startupTimer = null;
    releaseMicrophone();
  };

  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    fn(value);
  };

  const armResultTimer = () => {
    clearTimeout(timer);
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
  };

  recognition.onstart = () => {
    if (settled || started) return;
    started = true;
    clearTimeout(startupTimer);
    startupTimer = null;
    armResultTimer();
    if (typeof onStart === "function") onStart();
  };

  recognition.onspeechstart = () => {
    if (settled) return;
    armResultTimer();
    if (typeof onSpeechStart === "function") onSpeechStart();
  };

  recognition.onaudiostart = () => {
    if (settled) return;
    console.log("[speech] audiostart");
    armResultTimer();
  };

  recognition.onaudioend = () => {
    console.log("[speech] audioend", { lastInterim, settled });
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
      console.log("[speech] final", { transcript, alternatives });
      finish(resolveFn, {
        transcript,
        alternatives: [...new Set([transcript, ...alternatives].filter(Boolean))],
        confidence: result[0]?.confidence ?? 0,
      });
    } else {
      lastInterim = result[0]?.transcript?.trim() || lastInterim;
      if (lastInterim && typeof onInterim === "function") onInterim(lastInterim);
      // Bei Interims Ergebnis Timeout erneuern, damit aktive Sprache nicht abläuft.
      armResultTimer();
    }
  };

  recognition.onnomatch = () => {
    console.log("[speech] nomatch", { lastInterim });
  };

  recognition.onsoundstart = () => {
    if (!settled) armResultTimer();
  };

  recognition.onspeechend = () => {
    // Manche Browser liefern nach Sprachende kein zuverlässiges onend.
    // Nur stoppen, wenn wir bereits Text haben - sonst evtl. zu früh.
    if (settled) return;
    console.log("[speech] speechend", { lastInterim });
    setTimeout(() => {
      if (settled) return;
      try {
        recognition.stop();
      } catch {
        /* ignorieren */
      }
    }, lastInterim ? 900 : 1800);
  };

  recognition.onerror = (event) => {
    console.warn("[speech] error", event.error);
    if (event.error === "aborted") {
      finish(rejectFn, new SpeechError("aborted"));
      return;
    }
    finish(rejectFn, new SpeechError(event.error || "unsupported"));
  };

  recognition.onend = () => {
    if (settled) return;
    console.log("[speech] end", { started, lastInterim });
    if (!started) {
      finish(rejectFn, new SpeechError("start-failed"));
    } else if (lastInterim) {
      finish(resolveFn, { transcript: lastInterim, alternatives: [lastInterim], confidence: 0 });
    } else {
      finish(rejectFn, new SpeechError("no-speech"));
    }
  };

  // Der Start selbst darf nicht ewig hängen (z. B. bei offener
  // Berechtigungsabfrage). Erst nach onstart läuft der Antwort-Timeout.
  startupTimer = setTimeout(() => {
    if (settled || started) return;
    finish(rejectFn, new SpeechError("start-failed"));
    try {
      recognition.abort();
    } catch {
      /* ignorieren */
    }
  }, startTimeoutMs);

  // Die Vorab-Abfrage hat die Mikrofonberechtigung innerhalb der Nutzer-
  // Geste gesichert. Den eigenen Stream wieder freigeben, bevor die
  // Spracherkennung ihren eigenen Audiozugriff öffnet – zwei parallele
  // Aufnahmen können den Start auf manchen Browsern stören.
  if (microphoneStream) {
    stopMicrophoneStream(microphoneStream);
    microphoneStream = null;
  }

  try {
    // Standard-Aufruf ohne Track-Argument: am zuverlässigsten über Browser
    // hinweg.
    recognition.start();
  } catch {
    finish(rejectFn, new SpeechError("start-failed"));
  }

  return {
    promise,
    stop() {
      try {
        recognition.stop();
      } catch {
        finish(rejectFn, new SpeechError("aborted"));
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

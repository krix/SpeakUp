/**
 * Cloud-Anbieter für die Spracheingabe (Alternative zur Browser-Spracherkennung).
 *
 * Das Mikrofon wird lokal aufgenommen (MediaRecorder). Die fertige Audiodatei
 * wird einmalig zur Transkription an Google Gemini gesendet und danach nicht
 * gespeichert. Es gibt kein Live-Zwischenergebnis – erst nach dem Stoppen der
 * Aufnahme kommt die erkannte Antwort zurück.
 *
 * Benötigt einen eigenen Gemini-API-Schlüssel (wie bei der Handschrift/KI) und
 * die Einwilligung zu Online-Funktionen. Der Schlüssel liegt getrennt von den
 * Einstellungen und ist nie Teil eines Backups.
 */
import { SpeechError, stopMicrophoneStream } from "./speech.js";
import { getApiKey } from "./secrets.js";

export const GEMINI_SPEECH_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_SPEECH_MODEL = "gemini-3.5-flash-lite";

export function isGeminiSpeechSupported() {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new SpeechError("invalid-response"));
    reader.readAsDataURL(blob);
  });
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    if (typeof value !== "string") continue;
    const text = value.replace(/\s+/g, " ").trim();
    if (!text || text.length > 60) continue;
    const key = text.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function throwGeminiSpeechError(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body?.error?.message || "";
  } catch {
    /* ignorieren */
  }
  if (response.status === 401 || response.status === 403) {
    throw new SpeechError("auth");
  }
  if (response.status === 429) {
    const err = new SpeechError("rate-limit");
    if (detail) err.message = `Die Spracherkennung ist gerade nicht verfügbar: ${detail}`;
    throw err;
  }
  const err = new SpeechError("network");
  if (detail) err.message = `Die Spracherkennung hat nicht funktioniert: ${detail}`;
  throw err;
}

async function askGeminiToTranscribe(base64, mimeType, { model } = {}) {
  const key = await getApiKey("gemini");
  if (!key) throw new SpeechError("auth");

  const usedModel = model || DEFAULT_SPEECH_MODEL;
  const url = `${GEMINI_SPEECH_ENDPOINT}/${encodeURIComponent(usedModel)}:generateContent?key=${encodeURIComponent(key)}`;
  const prompt = [
    "Transcribe the spoken English word or short phrase in this audio.",
    "Context: a child is answering a vocabulary exercise in an English learning app.",
    'Return JSON only with this exact shape: {"words":["..."]}.',
    "Put the single most likely transcription first, then up to 4 plausible alternatives.",
    "Each entry must be plain English text only (letters, spaces, apostrophes), no punctuation, no explanations.",
    'If nothing understandable is spoken, return {"words":[]}.',
  ].join(" ");

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType || "audio/webm", data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SpeechError("network");
  }
  if (!response.ok) await throwGeminiSpeechError(response);

  const json = await response.json();
  const text = (json?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();
  const parsed = extractJson(text);
  const raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.words) ? parsed.words : [];
  return uniqueStrings(raw).slice(0, 5);
}

/**
 * Sendet eine aufgenommene Sprachdatei an Gemini und liefert Transkript-
 * Kandidaten (bester zuerst). Leere/unklare Aufnahmen ergeben [].
 */
export async function recognizeSpeechGemini(audioBlob, { model, mimeType } = {}) {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new SpeechError("network");
  if (!(audioBlob instanceof Blob) || !audioBlob.size) throw new SpeechError("no-speech");
  const base64 = await blobToBase64(audioBlob);
  if (!base64) throw new SpeechError("invalid-response");
  return askGeminiToTranscribe(base64, mimeType || audioBlob.type || "audio/webm", { model });
}

function pickMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

/**
 * Nimmt Sprache lokal auf und transkribiert sie anschließend mit Gemini.
 * @returns {{promise: Promise<{transcript:string, alternatives:string[], confidence:number}>, stop: Function, abort: Function}}
 */
export function createGeminiSpeechRecognizer({
  stream,
  model,
  timeoutMs = 9000,
  onStart = null,
  onStopRecording = null,
} = {}) {
  if (!isGeminiSpeechSupported()) {
    return {
      promise: Promise.reject(new SpeechError("unsupported")),
      stop() {},
      abort() {},
    };
  }

  let settled = false;
  let started = false;
  let recorder = null;
  let chunks = [];
  let timer = null;
  let resolveFn;
  let rejectFn;
  let micStream = stream || null;

  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const cleanup = () => {
    clearTimeout(timer);
    timer = null;
    if (micStream) {
      stopMicrophoneStream(micStream);
      micStream = null;
    }
  };

  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    fn(value);
  };

  const abort = (code = "aborted") => {
    if (settled) return;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      /* ignorieren */
    }
    finish(rejectFn, new SpeechError(code));
  };

  const stop = () => {
    if (settled) return;
    if (!recorder) {
      abort("aborted");
      return;
    }
    if (recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      abort("aborted");
    }
  };

  try {
    if (!micStream) throw new SpeechError("audio-capture");
    const mimeType = pickMimeType();
    recorder = mimeType ? new MediaRecorder(micStream, { mimeType }) : new MediaRecorder(micStream);
  } catch (error) {
    cleanup();
    return {
      promise: Promise.reject(
        error instanceof SpeechError ? error : new SpeechError("start-failed")
      ),
      stop() {},
      abort() {},
    };
  }

  recorder.onstart = () => {
    if (settled || started) return;
    started = true;
    timer = setTimeout(() => {
      // Aufnahmelimit: stoppen und transkribieren, was gesagt wurde.
      stop();
    }, timeoutMs);
    if (typeof onStart === "function") onStart();
  };

  recorder.ondataavailable = (event) => {
    if (event?.data?.size) chunks.push(event.data);
  };

  recorder.onerror = () => {
    abort("start-failed");
  };

  recorder.onstop = async () => {
    if (settled) return;
    clearTimeout(timer);
    timer = null;
    if (typeof onStopRecording === "function") {
      try {
        onStopRecording();
      } catch {
        /* ignorieren */
      }
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    chunks = [];
    if (!blob.size || blob.size < 1200) {
      finish(rejectFn, new SpeechError("no-speech"));
      return;
    }
    try {
      const alternatives = await recognizeSpeechGemini(blob, {
        model,
        mimeType: blob.type || recorder.mimeType,
      });
      if (!alternatives.length) {
        finish(rejectFn, new SpeechError("no-speech"));
        return;
      }
      const transcript = alternatives[0] || "";
      finish(resolveFn, { transcript, alternatives, confidence: 0 });
    } catch (error) {
      finish(rejectFn, error instanceof SpeechError ? error : new SpeechError("network"));
    }
  };

  try {
    recorder.start();
  } catch {
    cleanup();
    return {
      promise: Promise.reject(new SpeechError("start-failed")),
      stop() {},
      abort() {},
    };
  }

  return { promise, stop, abort };
}


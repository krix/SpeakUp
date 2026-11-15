/** Dezente Soundeffekte über die WebAudio-API (keine Dateien nötig). */

let context = null;
let enabled = true;

function getContext() {
  if (!enabled) return null;
  try {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      context = new AudioContext();
    }
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

export function setSfxEnabled(value) {
  enabled = Boolean(value);
  if (!enabled && context && context.state === "running") {
    context.suspend().catch(() => {});
  }
}

export function isSfxEnabled() {
  return enabled;
}

function tone(ctx, frequency, start, duration, { type = "sine", gain = 0.06 } = {}) {
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + start);
  envelope.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  envelope.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration + 0.02);
}

export const sfx = {
  click() {
    const ctx = getContext();
    if (!ctx) return;
    tone(ctx, 520, 0, 0.06, { type: "triangle", gain: 0.025 });
  },
  correct() {
    const ctx = getContext();
    if (!ctx) return;
    tone(ctx, 659.25, 0, 0.14, { type: "triangle", gain: 0.05 });
    tone(ctx, 880, 0.09, 0.18, { type: "triangle", gain: 0.045 });
  },
  wrong() {
    const ctx = getContext();
    if (!ctx) return;
    tone(ctx, 246.94, 0, 0.16, { type: "sine", gain: 0.04 });
    tone(ctx, 196, 0.12, 0.2, { type: "sine", gain: 0.035 });
  },
  start() {
    const ctx = getContext();
    if (!ctx) return;
    tone(ctx, 523.25, 0, 0.1, { gain: 0.035 });
    tone(ctx, 659.25, 0.08, 0.12, { gain: 0.035 });
  },
  celebrate() {
    const ctx = getContext();
    if (!ctx) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      tone(ctx, frequency, index * 0.11, 0.24, { type: "triangle", gain: 0.05 });
    });
  },
  badge() {
    const ctx = getContext();
    if (!ctx) return;
    [783.99, 987.77, 1174.66].forEach((frequency, index) => {
      tone(ctx, frequency, index * 0.1, 0.3, { type: "sine", gain: 0.04 });
    });
  },
};

export default sfx;

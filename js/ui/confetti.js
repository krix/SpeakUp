/** Leichtgewichtiges Konfetti auf einem Overlay-Canvas. */

const COLORS = ["#6C4CF1", "#FF7A59", "#FFC83D", "#16BFAE", "#38A3FF", "#FF6FB5", "#2FBF71"];

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

let active = 0;

export function confetti({ count = 90, originX = 0.5, originY = 0.25, spread = 1 } = {}) {
  if (prefersReducedMotion() || document.hidden) return;
  if (active > 2) return; // nicht zu viele Partikel gleichzeitig
  active++;

  const root = document.getElementById("fx-root");
  if (!root) {
    active--;
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.className = "fx-canvas";
  root.append(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const startX = width * originX;
  const startY = height * originY;
  const particles = [];

  for (let i = 0; i < count; i++) {
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 0.9 * spread;
    const speed = 5 + Math.random() * 8;
    particles.push({
      x: startX + (Math.random() - 0.5) * 120,
      y: startY + (Math.random() - 0.5) * 30,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      size: 5 + Math.random() * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.35 ? "rect" : "circle",
      wobble: Math.random() * Math.PI * 2,
    });
  }

  let frame = 0;
  const maxFrames = 170;
  const gravity = 0.22;

  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    for (const particle of particles) {
      particle.vy += gravity;
      particle.vx *= 0.995;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.spin;
      particle.wobble += 0.12;

      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = Math.max(0, 1 - frame / maxFrames);
      if (particle.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, particle.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const stretch = 1 + Math.sin(particle.wobble) * 0.35;
        ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size * 0.55 * stretch);
      }
      ctx.restore();
    }
    frame++;
    if (frame < maxFrames) {
      requestAnimationFrame(draw);
    } else {
      canvas.remove();
      active--;
    }
  };

  requestAnimationFrame(draw);
  setTimeout(() => {
    if (canvas.isConnected) {
      canvas.remove();
      active--;
    }
  }, 4500);
}

export default confetti;

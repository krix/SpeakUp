/** PWA-Installation: Prompt (Android/Desktop) und Hinweise (iOS). */

let deferredPrompt = null;
let installed = false;

export function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    document.dispatchEvent(new CustomEvent("speakup:install-available"));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    document.dispatchEvent(new CustomEvent("speakup:installed"));
  });
  if (window.matchMedia?.("(display-mode: standalone)")?.matches) installed = true;
}

export function canInstall() {
  return Boolean(deferredPrompt) && !isStandalone();
}

export function isStandalone() {
  return (
    installed ||
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

export async function promptInstall() {
  if (!deferredPrompt) return { outcome: "unavailable" };
  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  promptEvent.prompt();
  const result = await promptEvent.userChoice;
  return result;
}

export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function installHint() {
  if (isStandalone()) return "SpeakUp ist bereits als App installiert. 🎉";
  if (isIos()) return "Auf iPhone/iPad: Tippe in Safari auf „Teilen“ und dann auf „Zum Home-Bildschirm“.";
  if (canInstall()) return "Tippe auf „App installieren“, um SpeakUp auf dem Gerät abzulegen.";
  return "Im Browser-Menü findest du „App installieren“ oder „Zum Startbildschirm hinzufügen“ (Chrome/Edge).";
}

export default { setupInstallPrompt, canInstall, promptInstall, isStandalone, installHint, isIos };

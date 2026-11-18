/**
 * Gemeinsame Medaillen-Logik für Themenfortschritt.
 * 🥉 ab 50 %, 🥈 ab 75 %, 🏆 bei 100 % – rein dekorativ, der Text daneben
 * nennt die genaue Zahl der gemeisterten Wörter.
 */
export function themeMedal(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  if (value >= 100) return "🏆";
  if (value >= 75) return "🥈";
  if (value >= 50) return "🥉";
  return "";
}

export default themeMedal;
